import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PENDING_WINDOW_MS } from "../seats";
import { prisma } from "./client";
import { listNotesForClinic } from "./notes";
import { applySeatCheck, confirmSeat, getSeatSummary, listSeatRows, releaseSeat, reserveSeat } from "./seats";

/**
 * The seat table against the real testing database. Every clinic and every
 * user id here is made up, made by this file and removed by it (seats go
 * with their clinic).
 */

const createdClinicIds: string[] = [];

async function makeClinic(surgeonSeats: number) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest seats clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", surgeonSeats },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

/** A made-up Clerk user id, different every time. */
const user = () => `user_vitest${randomBytes(6).toString("hex")}`;

async function logOf(clinicId: string) {
  return (await listNotesForClinic(clinicId)).map((note) => `${note.authorName}: ${note.body}`).reverse();
}

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("reserving a seat", () => {
  it("gives seats until the plan is full, then refuses and writes nothing", async () => {
    const clinicId = await makeClinic(2);
    const [a, b, c] = [user(), user(), user()];

    expect(await reserveSeat(clinicId, a)).toMatchObject({ held: true, fresh: true, summary: { inUse: 1, free: 1 } });
    expect(await reserveSeat(clinicId, b)).toMatchObject({ held: true, fresh: true, summary: { inUse: 2, free: 0 } });
    expect(await reserveSeat(clinicId, c)).toMatchObject({ held: false, summary: { inUse: 2, seats: 2 } });

    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId).sort()).toEqual([a, b].sort());
  });

  it("refuses everyone at a clinic with no seats, which is every clinic before it has paid", async () => {
    const clinicId = await makeClinic(0);
    expect(await reserveSeat(clinicId, user())).toMatchObject({ held: false, summary: { seats: 0, inUse: 0 } });
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("is safe to repeat: the same person is not counted twice", async () => {
    const clinicId = await makeClinic(1);
    const a = user();

    expect(await reserveSeat(clinicId, a)).toMatchObject({ held: true, fresh: true });
    expect(await reserveSeat(clinicId, a)).toMatchObject({ held: true, fresh: false, summary: { inUse: 1 } });
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("the same person reserving from several tabs at once ends with one seat", async () => {
    const clinicId = await makeClinic(3);
    const a = user();

    const results = await Promise.all([reserveSeat(clinicId, a), reserveSeat(clinicId, a), reserveSeat(clinicId, a)]);
    expect(results.every((result) => result.held)).toBe(true);
    expect(results.filter((result) => result.held && result.fresh)).toHaveLength(1);
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("five people reaching for the last seat at once: exactly one gets it", async () => {
    const clinicId = await makeClinic(1);

    const results = await Promise.all([user(), user(), user(), user(), user()].map((who) => reserveSeat(clinicId, who)));
    expect(results.filter((result) => result.held)).toHaveLength(1);
    expect(await listSeatRows(clinicId)).toHaveLength(1);
    expect(await getSeatSummary(clinicId)).toEqual({ seats: 1, inUse: 1, free: 0, overBy: 0 });
  });

  it("resets the clock of a reservation that is tried again, so it is not let go halfway through", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    const longAgo = new Date(Date.now() - PENDING_WINDOW_MS * 2);

    await reserveSeat(clinicId, a, longAgo);
    const retriedAt = new Date();
    await reserveSeat(clinicId, a, retriedAt);

    const [row] = await listSeatRows(clinicId);
    expect(row.reservedAt.getTime()).toBe(retriedAt.getTime());
  });

  it("refuses anything that is not a Clerk user id, and an unknown clinic", async () => {
    const clinicId = await makeClinic(1);
    await expect(reserveSeat(clinicId, "org_notauser")).rejects.toThrow("not a Clerk user id");
    await expect(reserveSeat("no-such-clinic", user())).rejects.toThrow("No clinic");
  });

  it("one clinic's seats are nothing to do with another's", async () => {
    const full = await makeClinic(1);
    const other = await makeClinic(1);
    const shared = user(); // the same person can belong to two clinics

    await reserveSeat(full, shared);
    // The first clinic being full does not stop the second, even for the same person.
    expect(await reserveSeat(other, shared)).toMatchObject({ held: true, fresh: true });
    expect(await reserveSeat(full, user())).toMatchObject({ held: false });

    // Letting the seat go at one clinic leaves the other's alone.
    await releaseSeat(other, shared);
    expect(await listSeatRows(full)).toHaveLength(1);
    expect(await listSeatRows(other)).toHaveLength(0);
  });
});

describe("confirming and letting go", () => {
  it("confirms once, and logs once, however many times it is asked", async () => {
    const clinicId = await makeClinic(2);
    const a = user();
    const log = { authorName: "Vitest Admin (clinic admin)", describe: () => "Surgeon seat given to Dr. Example." };

    await reserveSeat(clinicId, a);
    expect(await confirmSeat(clinicId, a, log)).toMatchObject({ confirmed: true, holdsSeat: true });
    expect(await confirmSeat(clinicId, a, log)).toMatchObject({ confirmed: false, holdsSeat: true });

    expect((await listSeatRows(clinicId))[0].syncState).toBe("SYNCED");
    expect(await logOf(clinicId)).toEqual(["Vitest Admin (clinic admin): Surgeon seat given to Dr. Example."]);
  });

  it("says so when there was no seat to confirm", async () => {
    const clinicId = await makeClinic(1);
    expect(await confirmSeat(clinicId, user())).toMatchObject({ confirmed: false, holdsSeat: false });
  });

  it("builds the log sentence from the count that was there under the lock", async () => {
    const clinicId = await makeClinic(3);
    const [a, b] = [user(), user()];
    await reserveSeat(clinicId, a);
    await reserveSeat(clinicId, b);

    await confirmSeat(clinicId, b, { authorName: "Vitest", describe: (summary) => `${summary.inUse} of ${summary.seats}` });
    expect(await logOf(clinicId)).toEqual(["Vitest: 2 of 3"]);
  });

  it("letting go frees the seat for someone else, and is safe to repeat", async () => {
    const clinicId = await makeClinic(1);
    const [a, b] = [user(), user()];
    const log = { authorName: "Vitest", describe: () => "Seat let go." };

    await reserveSeat(clinicId, a);
    await confirmSeat(clinicId, a);
    expect(await reserveSeat(clinicId, b)).toMatchObject({ held: false });

    expect(await releaseSeat(clinicId, a, log)).toMatchObject({ released: true, summary: { inUse: 0 } });
    expect(await releaseSeat(clinicId, a, log)).toMatchObject({ released: false });
    expect(await reserveSeat(clinicId, b)).toMatchObject({ held: true });

    expect(await logOf(clinicId)).toEqual(["Vitest: Seat let go."]); // once
  });

  it("undoing a reservation that never completed is not news: nothing is logged", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    await reserveSeat(clinicId, a);

    expect(await releaseSeat(clinicId, a, { authorName: "Vitest", describe: () => "should not appear" })).toMatchObject({ released: true });
    expect(await logOf(clinicId)).toEqual([]);
  });
});

describe("applying a seat check", () => {
  it("lets seats go, confirms, and gives free seats, with one log entry saying what happened", async () => {
    const clinicId = await makeClinic(2);
    const [gone, nowStaff, waiting] = [user(), user(), user()];
    for (const who of [gone, nowStaff]) {
      await reserveSeat(clinicId, who);
      await confirmSeat(clinicId, who);
    }

    const result = await applySeatCheck(clinicId, {
      confirm: [],
      release: [
        { userId: gone, reason: "left" },
        { userId: nowStaff, reason: "not-surgeon" },
      ],
      adopt: [waiting],
    });

    expect(result).toMatchObject({ released: 2, adopted: 1, summary: { inUse: 1, free: 1 } });
    expect(await listSeatRows(clinicId)).toMatchObject([{ clerkUserId: waiting, syncState: "SYNCED" }]);
    expect(await logOf(clinicId)).toEqual([
      "seats: Seats checked against the clinic's people: 1 seat let go because the person is no longer in the clinic; 1 seat let go because the person is marked as staff; 1 surgeon who was waiting was given a seat. Now 1 of 2 surgeon seats in use.",
    ]);
  });

  it("never gives more seats than the plan has, whatever the plan it was handed says", async () => {
    const clinicId = await makeClinic(2);
    const everyone = [user(), user(), user(), user()];

    // A plan worked out from a stale snapshot, asking for four seats at a two-seat clinic.
    const result = await applySeatCheck(clinicId, { confirm: [], release: [], adopt: everyone });

    expect(result.adopted).toBe(2);
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual(everyone.slice(0, 2)); // in the order given
  });

  it("skips someone who was given a seat by another request in the meantime", async () => {
    const clinicId = await makeClinic(2);
    const a = user();
    await reserveSeat(clinicId, a);

    const result = await applySeatCheck(clinicId, { confirm: [], release: [], adopt: [a] });
    expect(result.adopted).toBe(0);
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("does not let go of a stale reservation that has just been tried again", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    const now = new Date();
    await reserveSeat(clinicId, a, now); // the snapshot saw it as stale; since then it was retried, so its clock is new

    const result = await applySeatCheck(clinicId, { confirm: [], release: [{ userId: a, reason: "stale" }], adopt: [] }, now);
    expect(result.released).toBe(0);
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("lets a genuinely stale reservation go, without writing it up", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    const now = new Date();
    await reserveSeat(clinicId, a, new Date(now.getTime() - PENDING_WINDOW_MS - 5_000));

    const result = await applySeatCheck(clinicId, { confirm: [], release: [{ userId: a, reason: "stale" }], adopt: [] }, now);
    expect(result.released).toBe(1);
    expect(await logOf(clinicId)).toEqual([]);
  });

  it("does not let go of a seat as 'marked staff' when it has since become a fresh reservation", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    await reserveSeat(clinicId, a); // PENDING: someone is making them a surgeon right now

    const result = await applySeatCheck(clinicId, { confirm: [], release: [{ userId: a, reason: "not-surgeon" }], adopt: [] });
    expect(result.released).toBe(0);
  });

  it("is safe to run twice, and an empty plan writes nothing", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    const plan = { confirm: [], release: [], adopt: [a] };

    expect((await applySeatCheck(clinicId, plan)).adopted).toBe(1);
    expect((await applySeatCheck(clinicId, plan)).adopted).toBe(0);
    await applySeatCheck(clinicId, { confirm: [], release: [], adopt: [] });

    expect(await logOf(clinicId)).toHaveLength(1);
  });

  it("only touches the clinic it was given", async () => {
    const mine = await makeClinic(1);
    const theirs = await makeClinic(1);
    const a = user();
    await reserveSeat(theirs, a);
    await confirmSeat(theirs, a);

    // A plan for MY clinic that names THEIR surgeon lets nothing of theirs go.
    await applySeatCheck(mine, { confirm: [], release: [{ userId: a, reason: "left" }], adopt: [] });
    expect(await listSeatRows(theirs)).toHaveLength(1);
  });
});
