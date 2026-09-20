import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import { PlanSeatsRefusedError, setClinicPlan } from "./clinics";
import * as seatLock from "./seat-lock";
import { listSeatRows, reserveSeat } from "./seats";

/**
 * The forced overlap for surgeon seats: two people reach for the LAST seat
 * at the same moment, and a plan is lowered while a seat is being given.
 *
 * Counting the seats in use and then writing one more is two steps. If a
 * second request can get in between the first one's COUNT and its WRITE,
 * both have counted "none in use", and both take the one seat: a clinic
 * paying for one surgeon ends with two. reserveSeat() prevents that by
 * locking the clinic's row before it counts (readSeatsLocked in
 * seat-lock.ts), so the second request has to wait until the first has
 * committed, and then counts the seat it took.
 *
 * How the overlap is forced (the same way as clinics.race.test.ts):
 * readSeatsLocked is wrapped for one call, request A's. The wrapper does A's
 * lock-and-count, then starts request B on another connection, waits far
 * longer than an unblocked request needs, notes whether B finished, and only
 * then lets A carry on to its write. So B arrives exactly in the gap between
 * A's count and A's write.
 *
 *   With the lock:  B cannot finish during the wait. It runs after A has
 *                   committed, counts A's seat, and is refused.
 *   The control:    the same overlap with a plain count and no lock. B gets
 *                   through in the gap and takes the seat, and then A, still
 *                   holding its count of "none in use", takes it too. That
 *                   is the bug, shown on purpose: it proves this test would
 *                   notice if the lock were ever removed.
 */

vi.mock("./seat-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seat-lock")>();
  // The real function stays the default; one test at a time swaps in a wrapper.
  return { ...actual, readSeatsLocked: vi.fn(actual.readSeatsLocked) };
});

const real = await vi.importActual<typeof import("./seat-lock")>("./seat-lock");

/** How long request A holds still while B tries to get through. An unblocked reservation finishes in tens of milliseconds. */
const WAIT_MS = 600;

const createdClinicIds: string[] = [];

async function makeClinic(surgeonSeats: number) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest seat race clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", surgeonSeats },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

const user = () => `user_vitest${randomBytes(6).toString("hex")}`;

afterEach(() => {
  vi.mocked(seatLock.readSeatsLocked).mockImplementation(real.readSeatsLocked);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

type Read = typeof real.readSeatsLocked;

/** The same count as readSeatsLocked, without the lock. What the control uses. */
const readSeatsWithoutLock: Read = async (tx: Prisma.TransactionClient, clinicId: string) => {
  const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { surgeonSeats: true } });
  if (!clinic) return null;
  return { surgeonSeats: clinic.surgeonSeats, inUse: await tx.seatAllocation.count({ where: { clinicId } }) };
};

/**
 * Run `first`, and between its count of the seats and its write, start
 * `second`. Returns both results and whether `second` had already finished
 * by the time `first` went on to write.
 */
async function overlap<A, B>(read: Read, first: () => Promise<A>, second: () => Promise<B>) {
  let secondFinishedDuringWait = false;
  let other: Promise<B> | null = null;

  vi.mocked(seatLock.readSeatsLocked).mockImplementationOnce(async (tx, clinicId) => {
    const counted = await read(tx, clinicId);
    let done = false;
    // The second request always uses the real locking read: the wrapper is for one call only.
    other = second().then((result) => {
      done = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    secondFinishedDuringWait = done;
    return counted;
  });

  const a = await first();
  const b = await (other as unknown as Promise<B>);
  return { a, b, secondFinishedDuringWait };
}

describe("two people reaching for the last seat at the same moment", () => {
  it("the second waits for the first, counts the seat it took, and is refused: one seat, one holder", async () => {
    const clinicId = await makeClinic(1);
    const [first, second] = [user(), user()];

    const { a, b, secondFinishedDuringWait } = await overlap(
      real.readSeatsLocked,
      () => reserveSeat(clinicId, first),
      () => reserveSeat(clinicId, second),
    );

    expect(secondFinishedDuringWait).toBe(false); // B could not get through while A held the row
    expect(a).toMatchObject({ held: true, fresh: true });
    expect(b).toMatchObject({ held: false, summary: { seats: 1, inUse: 1 } });
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([first]);
  });

  it("control: without the lock, the second slips into the gap and BOTH take the one seat", async () => {
    const clinicId = await makeClinic(1);
    const [first, second] = [user(), user()];

    const { a, b, secondFinishedDuringWait } = await overlap(
      readSeatsWithoutLock,
      () => reserveSeat(clinicId, first),
      () => reserveSeat(clinicId, second),
    );

    // B got through between A's count and A's write...
    expect(secondFinishedDuringWait).toBe(true);
    expect(b).toMatchObject({ held: true });
    // ...and A, which had counted "none in use" before B wrote, took the seat as well.
    expect(a).toMatchObject({ held: true });
    expect(await listSeatRows(clinicId)).toHaveLength(2); // two holders of one seat: the bug the lock prevents
  });
});

describe("a plan being lowered while a seat is being given", () => {
  it("the plan change waits, then counts the seat that was just given, and is refused", async () => {
    const clinicId = await makeClinic(2);
    const [seated, arriving] = [user(), user()];
    await reserveSeat(clinicId, seated);

    const { a, b, secondFinishedDuringWait } = await overlap(
      real.readSeatsLocked,
      () => reserveSeat(clinicId, arriving),
      // Pulse staff lower the plan to one seat, without the explicit override.
      () => setClinicPlan(clinicId, [], 1, "Vitest Staff").then(() => "saved" as const, (error: unknown) => error),
    );

    expect(secondFinishedDuringWait).toBe(false); // the plan change could not get through while the seat was being given
    expect(a).toMatchObject({ held: true, summary: { inUse: 2 } });
    // It saw BOTH seats in use, not the one that was there when it was sent.
    expect(b).toBeInstanceOf(PlanSeatsRefusedError);
    expect((b as Error).message).toContain("2 people hold a surgeon seat");
    const row = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { surgeonSeats: true } });
    expect(row?.surgeonSeats).toBe(2);
  });
});
