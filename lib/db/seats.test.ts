import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PENDING_WINDOW_MS, seatCountWords, type SeatCheckPlan } from "../seats";
import { prisma } from "./client";
import { listNotesForClinic } from "./notes";
import {
  applySeatCheck,
  getSeatHoldForInvitation,
  getSeatSummary,
  holdSeatForInvitation,
  linkSeatHold,
  listSeatHolds,
  listSeatRows,
  releaseSeat,
  releaseSeatHold,
  reserveSeat,
} from "./seats";

/**
 * The seat tables (a person's seat, and a seat held by an open invitation)
 * against the real testing database. Every clinic, user id and invitation id
 * here is made up, made by this file and removed by it (seats and holds go
 * with their clinic).
 */

const createdClinicIds: string[] = [];

async function makeClinic(surgeonSeats: number, ownerClerkUserId: string | null = null) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest seats clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", surgeonSeats, ownerClerkUserId },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

/** A made-up Clerk user id, different every time. */
const user = () => `user_vitest${randomBytes(6).toString("hex")}`;
/** A made-up Clerk invitation id, different every time. */
const invitation = () => `orginv_vitest${randomBytes(6).toString("hex")}`;

async function logOf(clinicId: string) {
  return (await listNotesForClinic(clinicId)).map((note) => `${note.authorName}: ${note.body}`).reverse();
}

const EMPTY_PLAN: SeatCheckPlan = { confirm: [], release: [], convert: [], link: [], dropHolds: [], adopt: [], ownerLeft: false };

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("giving a person a seat", () => {
  it("gives seats until the plan is full, then refuses and writes nothing", async () => {
    const clinicId = await makeClinic(2);
    const [a, b, c] = [user(), user(), user()];

    expect(await reserveSeat(clinicId, a)).toMatchObject({ held: true, fresh: true, summary: { inUse: 1, free: 1 } });
    expect(await reserveSeat(clinicId, b)).toMatchObject({ held: true, fresh: true, summary: { inUse: 2, free: 0 } });
    expect(await reserveSeat(clinicId, c)).toMatchObject({ held: false, summary: { inUse: 2, seats: 2 } });

    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId).sort()).toEqual([a, b].sort());
    expect((await listSeatRows(clinicId)).every((row) => row.syncState === "SYNCED")).toBe(true);
  });

  it("refuses everyone at a clinic with no seats, which is every clinic before it has paid", async () => {
    const clinicId = await makeClinic(0);
    expect(await reserveSeat(clinicId, user())).toMatchObject({ held: false, summary: { seats: 0, inUse: 0 } });
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("counts a seat held by an invitation: the last seat cannot go to a person while an invitation holds it", async () => {
    const clinicId = await makeClinic(1);
    expect(await holdSeatForInvitation(clinicId)).toMatchObject({ held: true, summary: { seated: 0, invited: 1, inUse: 1 } });
    expect(await reserveSeat(clinicId, user())).toMatchObject({ held: false, summary: { inUse: 1, free: 0 } });
  });

  it("is safe to repeat: the same person is not counted twice, and logged once", async () => {
    const clinicId = await makeClinic(1);
    const a = user();
    const log = { authorName: "Vitest Admin (clinic admin)", describe: () => "Seat given to Dr. Example." };

    expect(await reserveSeat(clinicId, a, log)).toMatchObject({ held: true, fresh: true });
    expect(await reserveSeat(clinicId, a, log)).toMatchObject({ held: true, fresh: false, summary: { inUse: 1 } });
    expect(await listSeatRows(clinicId)).toHaveLength(1);
    expect(await logOf(clinicId)).toEqual(["Vitest Admin (clinic admin): Seat given to Dr. Example."]);
  });

  it("the same person from several tabs at once ends with one seat", async () => {
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
    expect(await getSeatSummary(clinicId)).toEqual({ seats: 1, seated: 1, invited: 0, inUse: 1, free: 0, overBy: 0 });
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
    expect(await reserveSeat(other, shared)).toMatchObject({ held: true, fresh: true });
    expect(await reserveSeat(full, user())).toMatchObject({ held: false });

    await releaseSeat(other, shared);
    expect(await listSeatRows(full)).toHaveLength(1);
    expect(await listSeatRows(other)).toHaveLength(0);
  });

  it("letting a seat go logs once, and letting go a seat that is not there changes nothing", async () => {
    const clinicId = await makeClinic(2);
    const a = user();
    await reserveSeat(clinicId, a);
    const log = { authorName: "Vitest Admin (clinic admin)", describe: (summary: Parameters<typeof seatCountWords>[0]) => `Seat let go. Now ${seatCountWords(summary)}.` };

    expect(await releaseSeat(clinicId, a, log)).toMatchObject({ released: true, summary: { inUse: 0 } });
    expect(await releaseSeat(clinicId, a, log)).toMatchObject({ released: false });
    expect(await logOf(clinicId)).toEqual(["Vitest Admin (clinic admin): Seat let go. Now 0 of 2 seats in use."]);
  });
});

describe("a seat held by an invitation", () => {
  it("holds seats until the plan is full, then refuses and writes nothing", async () => {
    const clinicId = await makeClinic(2);
    await reserveSeat(clinicId, user());

    expect(await holdSeatForInvitation(clinicId)).toMatchObject({ held: true, summary: { seated: 1, invited: 1, free: 0 } });
    expect(await holdSeatForInvitation(clinicId)).toMatchObject({ held: false, summary: { inUse: 2 } });
    expect(await listSeatHolds(clinicId)).toHaveLength(1);
  });

  it("records its Clerk invitation once, logs it once, and is found by it only within its own clinic", async () => {
    const clinicId = await makeClinic(2);
    const other = await makeClinic(2);
    const hold = await holdSeatForInvitation(clinicId);
    if (!hold.held) throw new Error("expected a hold");
    const inv = invitation();
    const log = { authorName: "Vitest Admin (clinic admin)", describe: (summary: Parameters<typeof seatCountWords>[0]) => `Invitation sent. Now ${seatCountWords(summary)}.` };

    expect(await linkSeatHold(clinicId, hold.holdId, inv, log)).toBe(true);
    expect(await linkSeatHold(clinicId, hold.holdId, inv, log)).toBe(false); // already recorded
    expect(await getSeatHoldForInvitation(clinicId, inv)).toEqual({ id: hold.holdId });
    expect(await getSeatHoldForInvitation(other, inv)).toBeNull();
    expect(await linkSeatHold(other, hold.holdId, invitation())).toBe(false); // another clinic cannot touch it
    expect(await logOf(clinicId)).toEqual(["Vitest Admin (clinic admin): Invitation sent. Now 1 of 2 seats in use (1 by an invitation)."]);
  });

  it("revoking frees its seat; another clinic's release changes nothing", async () => {
    const clinicId = await makeClinic(1);
    const other = await makeClinic(1);
    const hold = await holdSeatForInvitation(clinicId);
    if (!hold.held) throw new Error("expected a hold");

    expect(await releaseSeatHold(other, hold.holdId)).toMatchObject({ released: false });
    expect(await listSeatHolds(clinicId)).toHaveLength(1);
    expect(await releaseSeatHold(clinicId, hold.holdId)).toMatchObject({ released: true, summary: { inUse: 0, free: 1 } });
    expect(await reserveSeat(clinicId, user())).toMatchObject({ held: true });
  });

  it("five invitations at once for the last seat: exactly one holds it", async () => {
    const clinicId = await makeClinic(1);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => holdSeatForInvitation(clinicId)));
    expect(results.filter((result) => result.held)).toHaveLength(1);
    expect(await listSeatHolds(clinicId)).toHaveLength(1);
  });
});

describe("applying a seat check", () => {
  it("turns an accepted invitation into its person's seat in one step, so the count never changes", async () => {
    const clinicId = await makeClinic(1);
    const hold = await holdSeatForInvitation(clinicId);
    if (!hold.held) throw new Error("expected a hold");
    const newcomer = user();

    const result = await applySeatCheck(clinicId, { ...EMPTY_PLAN, convert: [{ holdId: hold.holdId, userId: newcomer }] }, null);
    expect(result).toMatchObject({ converted: 1, summary: { seated: 1, invited: 0, inUse: 1 } });
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([newcomer]);
    expect(await listSeatHolds(clinicId)).toEqual([]);
    expect((await logOf(clinicId)).at(-1)).toContain("1 invitation was accepted and turned into a seat");
  });

  it("never gives more seats than the plan has, whatever the plan it was handed says", async () => {
    const clinicId = await makeClinic(2);
    await reserveSeat(clinicId, user());
    const waiting = [user(), user(), user()];

    const result = await applySeatCheck(clinicId, { ...EMPTY_PLAN, adopt: waiting }, null);
    expect(result).toMatchObject({ adopted: 1, summary: { inUse: 2, free: 0 } });
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toContain(waiting[0]);
  });

  it("never gives the account owner a seat on its own", async () => {
    const owner = user();
    const clinicId = await makeClinic(3, owner);
    const result = await applySeatCheck(clinicId, { ...EMPTY_PLAN, adopt: [owner] }, owner);
    expect(result.adopted).toBe(0);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("lets a never-made hold go only if it is still unlinked and still old", async () => {
    const clinicId = await makeClinic(3);
    const old = new Date(Date.now() - PENDING_WINDOW_MS * 2);
    const stale = await holdSeatForInvitation(clinicId, old);
    const young = await holdSeatForInvitation(clinicId);
    const linked = await holdSeatForInvitation(clinicId, old);
    if (!stale.held || !young.held || !linked.held) throw new Error("expected holds");
    await linkSeatHold(clinicId, linked.holdId, invitation()); // linked since the snapshot

    const dropAll = ([stale, young, linked] as { holdId: string }[]).map(({ holdId }) => ({ holdId, reason: "never-made" as const }));
    const result = await applySeatCheck(clinicId, { ...EMPTY_PLAN, dropHolds: dropAll }, null);
    expect(result.released).toBe(1);
    expect((await listSeatHolds(clinicId)).map((hold) => hold.id).sort()).toEqual([young.holdId, linked.holdId].sort());
    // A hold that never became an invitation was never really anyone's seat: not written up.
    expect(await logOf(clinicId)).not.toContainEqual(expect.stringContaining("let go"));
  });

  it("clears the owner only if the owner is still the person the check saw, and says so in the log", async () => {
    const owner = user();
    const clinicId = await makeClinic(1, owner);

    // Someone set a new owner since the snapshot: nothing is cleared.
    const newer = user();
    await prisma.clinic.update({ where: { id: clinicId }, data: { ownerClerkUserId: newer } });
    expect((await applySeatCheck(clinicId, { ...EMPTY_PLAN, ownerLeft: true }, owner)).ownerCleared).toBe(false);

    expect((await applySeatCheck(clinicId, { ...EMPTY_PLAN, ownerLeft: true }, newer)).ownerCleared).toBe(true);
    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId).toBeNull();
    expect((await logOf(clinicId)).at(-1)).toContain("the account owner is no longer in the clinic");
  });

  it("writes nothing when there is nothing to do, and a second run of the same plan finds nothing", async () => {
    const clinicId = await makeClinic(2);
    const gone = user();
    await reserveSeat(clinicId, gone);

    await applySeatCheck(clinicId, EMPTY_PLAN, null);
    expect(await logOf(clinicId)).toEqual([]);

    const plan = { ...EMPTY_PLAN, release: [gone] };
    expect((await applySeatCheck(clinicId, plan, null)).released).toBe(1);
    expect((await applySeatCheck(clinicId, plan, null)).released).toBe(0);
    expect(await logOf(clinicId)).toHaveLength(1);
  });
});
