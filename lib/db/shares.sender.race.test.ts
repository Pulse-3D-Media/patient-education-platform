import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as access from "./access";
import { prisma } from "./client";
import { releaseSeat, setSeatDisplayName } from "./seats";
import { createShare, SenderRefusedError } from "./shares";

/**
 * The forced overlap for WHO A LINK IS FROM: the surgeon's seat is let go,
 * or the name typed for them changes, AFTER createShare() has read their
 * seat and BEFORE it inserts the link. Without the lock the change would
 * commit in that gap, and a link would be written from someone who no
 * longer holds a seat (or with a name already replaced). With the share lock
 * on the seat row (lockSenderSeat in lib/db/access.ts) the change waits
 * until the link is committed, and only then applies.
 *
 * How the gap is forced, as in shares.race.test.ts: lockSenderSeat is the
 * last read before the insert, so it is wrapped for one call. The wrapper
 * does the read, starts the change on another connection, waits long
 * enough for an unblocked change to finish many times over, notes whether
 * it did, and lets createShare() carry on.
 *
 * The change is made two ways. Straight on the seat row (a plain delete or
 * update), which nothing but the seat lock can hold up; its control does the
 * same overlap with a plain, unlocked read, and shows the change getting
 * through: that is what the lock prevents, and it proves the test would
 * catch the lock being removed. And through the app's own writers
 * (releaseSeat, setSeatDisplayName), which also wait because they lock the
 * clinic row first and createShare holds that row too.
 */

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, lockSenderSeat: vi.fn(actual.lockSenderSeat) };
});

const real = await vi.importActual<typeof import("./access")>("./access");

/** How long the wrapper waits for the change to finish. A change that is not blocked finishes in tens of milliseconds. */
const WAIT_MS = 1500;

const createdClinicIds: string[] = [];
let video = "";

const tag = () => randomBytes(6).toString("hex");

beforeAll(async () => {
  const row = await prisma.video.create({
    data: { title: `Vitest sender race video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
    select: { id: true },
  });
  video = row.id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** An open Knee clinic with one surgeon holding a seat, named "Jane Smith, PA-C" for patients. */
async function clinicWithSurgeon() {
  const surgeon = `user_race${tag()}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest sender race clinic ${tag()}`,
      status: "ACTIVE",
      categories: ["KNEE"],
      surgeonSeats: 2,
      seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED", displayName: "Jane Smith, PA-C" } },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return { clinic: clinic.id, surgeon };
}

/** The seat read without any lock: what createShare would do if the lock were taken out. For the controls only. */
async function plainRead(tx: Parameters<typeof real.lockSenderSeat>[0], clinicId: string, clerkUserId: string) {
  return tx.seatAllocation.findUnique({ where: { clinicId_clerkUserId: { clinicId, clerkUserId } }, select: { displayName: true } });
}

/**
 * Make a link from `surgeon` while `change` lands in the middle of
 * createShare(), right after the seat was read. Returns the share, and
 * whether the change had already finished by the time the link was written.
 */
async function createWhile(clinicId: string, surgeon: string, change: () => Promise<unknown>, read: typeof real.lockSenderSeat = real.lockSenderSeat) {
  let changeFinishedDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();

  vi.mocked(access.lockSenderSeat).mockImplementationOnce(async (tx, clinic, user) => {
    const seat = await read(tx, clinic, user);
    let done = false;
    pending = change().then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    changeFinishedDuringWait = done;
    return seat;
  });

  const share = await createShare(clinicId, video, { sender: { clerkUserId: surgeon, fallbackName: "Dr. Jane Smith" } });
  await pending;
  return { share, changeFinishedDuringWait };
}

const seatKey = (clinicId: string, clerkUserId: string) => ({ clinicId_clerkUserId: { clinicId, clerkUserId } });

describe("the surgeon's seat changes while a link from them is being made", () => {
  it("waits when the seat row is deleted: the link is written from a seated surgeon, then the seat goes, then a new link is refused", async () => {
    const { clinic, surgeon } = await clinicWithSurgeon();
    const { share, changeFinishedDuringWait } = await createWhile(clinic, surgeon, () => prisma.seatAllocation.delete({ where: seatKey(clinic, surgeon) }));

    expect(changeFinishedDuringWait).toBe(false);
    expect(share).toMatchObject({ senderUserId: surgeon, senderName: "Jane Smith, PA-C" });
    expect(await prisma.seatAllocation.findUnique({ where: seatKey(clinic, surgeon) })).toBeNull();
    await expect(createShare(clinic, video, { sender: { clerkUserId: surgeon, fallbackName: null } })).rejects.toBeInstanceOf(SenderRefusedError);
  });

  it("control: with a plain read the deletion gets through, and the link is written from someone who no longer holds a seat", async () => {
    const { clinic, surgeon } = await clinicWithSurgeon();
    const { share, changeFinishedDuringWait } = await createWhile(
      clinic,
      surgeon,
      () => prisma.seatAllocation.delete({ where: seatKey(clinic, surgeon) }),
      plainRead,
    );

    expect(changeFinishedDuringWait).toBe(true);
    expect(share.senderUserId).toBe(surgeon);
    expect(await prisma.seatAllocation.findUnique({ where: seatKey(clinic, surgeon) })).toBeNull();
  });

  it("waits when the name typed for them is changed straight on the row: the link carries the name as it was", async () => {
    const { clinic, surgeon } = await clinicWithSurgeon();
    const { share, changeFinishedDuringWait } = await createWhile(clinic, surgeon, () =>
      prisma.seatAllocation.update({ where: seatKey(clinic, surgeon), data: { displayName: "Jane Park, NP" } }),
    );

    expect(changeFinishedDuringWait).toBe(false);
    expect(share.senderName).toBe("Jane Smith, PA-C");
    // The change applied afterwards, for links made from then on.
    const next = await createShare(clinic, video, { sender: { clerkUserId: surgeon, fallbackName: null } });
    expect(next.senderName).toBe("Jane Park, NP");
  });

  it("control: with a plain read the name change gets through while the link is still being written", async () => {
    const { clinic, surgeon } = await clinicWithSurgeon();
    const { changeFinishedDuringWait } = await createWhile(
      clinic,
      surgeon,
      () => prisma.seatAllocation.update({ where: seatKey(clinic, surgeon), data: { displayName: "Jane Park, NP" } }),
      plainRead,
    );
    expect(changeFinishedDuringWait).toBe(true);
  });

  it("waits for the app's own writers too: an admin removing the seat, or saving a new name on People", async () => {
    const first = await clinicWithSurgeon();
    const released = await createWhile(first.clinic, first.surgeon, () => releaseSeat(first.clinic, first.surgeon));
    expect(released.changeFinishedDuringWait).toBe(false);
    expect(released.share.senderUserId).toBe(first.surgeon);

    const second = await clinicWithSurgeon();
    const renamed = await createWhile(second.clinic, second.surgeon, () =>
      setSeatDisplayName(second.clinic, second.surgeon, "Jane Park, NP", { authorName: "Vitest", describe: () => "Vitest renamed a seat." }),
    );
    expect(renamed.changeFinishedDuringWait).toBe(false);
    expect(renamed.share.senderName).toBe("Jane Smith, PA-C");
    expect((await prisma.seatAllocation.findUniqueOrThrow({ where: seatKey(second.clinic, second.surgeon) })).displayName).toBe("Jane Park, NP");
  }, 20_000);
});
