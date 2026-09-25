import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentClinic } from "./clinic";
import { prisma } from "./db/client";
import { listNotesForClinic } from "./db/notes";
import * as seatsDb from "./db/seats";
import { checkSeats, giveSeat, handOffOwner, inviteSomeone, releaseOwnSeat, removePerson, revokeInvitation, setAdmin, setOwnerByStaff, setPatientName } from "./seat-changes";
import { PENDING_WINDOW_MS } from "./seats";
import { fakeClerk } from "./testing/fake-clerk";

/**
 * The seat model end to end: the real database (the Neon testing branch)
 * and a stand-in for Clerk that can be made to fail, to lose a member, to
 * accept or revoke an invitation behind the app's back.
 *
 * What these prove is the part a database transaction cannot: that every way
 * a change that also writes to Clerk can stop halfway leaves something
 * harmless, that the seat check puts it right, and that the account owner is
 * protected. A stand-in is not Clerk; the walkthrough against a real Clerk
 * test organization is a separate check (see the PR).
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

// Each invitation is a few short transactions against the remote testing
// database, and several tests here send two or three before checking, which
// can pass the default five seconds when the branch has just woken up.
vi.setConfig({ testTimeout: 30_000 });

// The real database functions, each wrapped so ONE call can be made to fail.
vi.mock("./db/seats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/seats")>();
  return { ...actual, releaseSeatHold: vi.fn(actual.releaseSeatHold), linkSeatHold: vi.fn(actual.linkSeatHold), releaseSeat: vi.fn(actual.releaseSeat) };
});

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

type Members = Parameters<typeof fakeClerk.addOrg>[2];

/** An open clinic with some seats and an owner, and its organization in the stand-in with these people in it. The owner is an admin. */
async function makeClinic(surgeonSeats: number, others: Members = [], options: { owner?: string | null; status?: "ACTIVE" | "PENDING" } = {}) {
  const orgId = `org_test_${id()}`;
  const owner = options.owner === undefined ? user() : options.owner;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest seat clinic ${id()}`, status: options.status ?? "ACTIVE", clerkOrgId: orgId, surgeonSeats, ownerClerkUserId: owner },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const members = [...(owner ? [{ userId: owner, firstName: "Olive", lastName: "Owner", role: "org:admin" as const, joinedAt: 1 }] : []), ...(others ?? [])];
  fakeClerk.addOrg(orgId, "Vitest seat clinic", members, owner);
  return { clinicId: clinic.id, orgId, owner: owner as string, actor: { userId: owner as string, name: "Olive Owner" } };
}

const seatsOf = async (clinicId: string) => (await seatsDb.listSeatRows(clinicId)).map((row) => row.clerkUserId).sort();
const holdsOf = async (clinicId: string) => seatsDb.listSeatHolds(clinicId);
const ownerOf = async (clinicId: string) => (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId;
const logOf = async (clinicId: string) => (await listNotesForClinic(clinicId)).map((note) => `${note.authorName}: ${note.body}`).reverse();

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined); // failures are logged on purpose; keep the test output readable
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("signing up", () => {
  it("the person who creates the clinic is its account owner, with no seat", async () => {
    const orgId = `org_test_${id()}`;
    const creator = user();
    fakeClerk.addOrg(orgId, `Vitest signup ${id()}`, [{ userId: creator, role: "org:admin" }], creator);
    fakeClerk.signIn(creator, orgId);

    const clinic = await getCurrentClinic();
    expect(clinic).toMatchObject({ isOwner: true, isAdmin: true, status: "PENDING" });
    createdClinicIds.push(clinic!.id);
    expect(await ownerOf(clinic!.id)).toBe(creator);
    expect(await seatsOf(clinic!.id)).toEqual([]);

    // Someone who joins later is not the owner, and their visit never moves it.
    const joiner = user();
    fakeClerk.addMember(orgId, { userId: joiner });
    fakeClerk.signIn(joiner, orgId);
    expect(await getCurrentClinic()).toMatchObject({ isOwner: false, id: clinic!.id });
    expect(await ownerOf(clinic!.id)).toBe(creator);
  });
});

describe("inviting", () => {
  it("holds a seat, sends the invitation carrying the hold and our sign-up page as its landing, and logs it", async () => {
    const { clinicId, orgId, actor } = await makeClinic(2);

    expect(await inviteSomeone({ clinicId, email: "New.Person@Example.test", role: "member", actor, acceptUrl: "https://app.example.test/sign-up" })).toMatchObject({ ok: true });

    const [invitation] = fakeClerk.invitations(orgId);
    expect(invitation.redirectUrl).toBe("https://app.example.test/sign-up");
    expect(invitation).toMatchObject({ emailAddress: "new.person@example.test", role: "org:member", status: "pending" });
    const holds = await holdsOf(clinicId);
    expect(holds).toEqual([expect.objectContaining({ clerkInvitationId: invitation.id })]);
    expect(invitation.publicMetadata).toEqual({ seatHold: holds[0].id });
    expect((await logOf(clinicId)).at(-1)).toBe("Olive Owner (clinic admin): Invitation sent as Member, holding a seat until it is accepted, revoked or expires. Now 1 of 2 seats in use (1 by an invitation).");
  });

  it("refuses the next invitation when the seats are full, and sends nothing", async () => {
    const dr = user();
    const { clinicId, orgId, actor } = await makeClinic(2, [{ userId: dr }]);
    await seatsDb.reserveSeat(clinicId, dr);
    await inviteSomeone({ clinicId, email: "one@example.test", role: "member", actor });

    const refused = await inviteSomeone({ clinicId, email: "two@example.test", role: "admin", actor });
    expect(refused).toMatchObject({ ok: false, message: expect.stringContaining("All 2 seats are taken") });
    expect(fakeClerk.invitations(orgId)).toHaveLength(1);
    expect(await holdsOf(clinicId)).toHaveLength(1);
  });

  it("two invitations at once for the last seat: one is sent, the other refused", async () => {
    const { clinicId, orgId, actor } = await makeClinic(1);
    const results = await Promise.all([
      inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor }),
      inviteSomeone({ clinicId, email: "b@example.test", role: "member", actor }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(fakeClerk.invitations(orgId)).toHaveLength(1);
    expect(await holdsOf(clinicId)).toHaveLength(1);
  });

  it("gives the seat back when Clerk does not send the invitation", async () => {
    const { clinicId, orgId, actor } = await makeClinic(1);
    fakeClerk.failNextWrites = 1;

    expect(await inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor })).toMatchObject({ ok: false, message: expect.stringContaining("No seat was used") });
    expect(await holdsOf(clinicId)).toEqual([]);
    expect(fakeClerk.invitations(orgId)).toEqual([]);
  });

  it("if the invitation id could not be recorded, the next check finds the invitation by the hold it carries", async () => {
    const { clinicId, orgId, actor } = await makeClinic(1);
    vi.mocked(seatsDb.linkSeatHold).mockRejectedValueOnce(new Error("database blinked"));

    expect(await inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor })).toMatchObject({ ok: true });
    expect(await holdsOf(clinicId)).toEqual([expect.objectContaining({ clerkInvitationId: null })]);

    await checkSeats(clinicId, new Date(Date.now() + PENDING_WINDOW_MS * 2)); // even long after, it is linked, not let go
    expect(await holdsOf(clinicId)).toEqual([expect.objectContaining({ clerkInvitationId: fakeClerk.invitations(orgId)[0].id })]);
  });

  it("refuses someone already in the clinic or already invited, and a bad address or role", async () => {
    const dr = user();
    const { clinicId, actor } = await makeClinic(5, [{ userId: dr, identifier: "dr@example.test" }]);
    await inviteSomeone({ clinicId, email: "open@example.test", role: "member", actor });

    expect(await inviteSomeone({ clinicId, email: "DR@example.test", role: "member", actor })).toMatchObject({ ok: false, message: expect.stringContaining("already in your clinic") });
    expect(await inviteSomeone({ clinicId, email: "open@example.test", role: "member", actor })).toMatchObject({ ok: false, message: expect.stringContaining("already has an open invitation") });
    expect(await inviteSomeone({ clinicId, email: "not an email", role: "member", actor })).toMatchObject({ ok: false });
    expect(await inviteSomeone({ clinicId, email: "x@example.test", role: "owner", actor })).toMatchObject({ ok: false });
    expect(await holdsOf(clinicId)).toHaveLength(1);
  });
});

describe("an invitation after it is sent", () => {
  it("accepted: the hold becomes the new person's seat, and nobody else waiting takes it", async () => {
    const waiting = user();
    const { clinicId, orgId, actor } = await makeClinic(1, [{ userId: waiting, joinedAt: 2 }]);
    await inviteSomeone({ clinicId, email: "new@example.test", role: "member", actor });
    const newcomer = user();
    fakeClerk.acceptInvitation(orgId, fakeClerk.invitations(orgId)[0].id, newcomer);

    const board = await checkSeats(clinicId);
    expect(await seatsOf(clinicId)).toEqual([newcomer]);
    expect(await holdsOf(clinicId)).toEqual([]);
    expect(board.people.find((person) => person.userId === newcomer)?.seat).toBe("held");
    expect(board.people.find((person) => person.userId === waiting)?.seat).toBe("waiting");
  });

  it("revoked here: the seat is free again, and logged", async () => {
    const { clinicId, orgId, actor } = await makeClinic(1);
    await inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor });
    const invitationId = fakeClerk.invitations(orgId)[0].id;

    expect(await revokeInvitation({ clinicId, invitationId, actor })).toMatchObject({ ok: true });
    expect(fakeClerk.invitations(orgId)[0].status).toBe("revoked");
    expect(await holdsOf(clinicId)).toEqual([]);
    expect((await logOf(clinicId)).at(-1)).toContain("An invitation was revoked, so the seat it held is free. Now 0 of 1 seat in use.");
    expect(await inviteSomeone({ clinicId, email: "b@example.test", role: "member", actor })).toMatchObject({ ok: true });
  });

  it("revoked or expired in Clerk's own panel: the next check frees its seat", async () => {
    const { clinicId, orgId, actor } = await makeClinic(2);
    await inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor });
    await inviteSomeone({ clinicId, email: "b@example.test", role: "member", actor });
    const [first, second] = fakeClerk.invitations(orgId);
    fakeClerk.closeInvitationOutsideTheApp(orgId, first.id, "revoked");
    fakeClerk.closeInvitationOutsideTheApp(orgId, second.id, "expired");

    expect((await checkSeats(clinicId)).summary).toMatchObject({ inUse: 0, free: 2 });
    expect((await logOf(clinicId)).at(-1)).toContain("2 seats let go because their invitations were revoked or expired");
  });

  it("nothing is let go when Clerk cannot be read", async () => {
    const { clinicId, actor } = await makeClinic(1);
    await inviteSomeone({ clinicId, email: "a@example.test", role: "member", actor });
    fakeClerk.failReads = true;
    await expect(checkSeats(clinicId)).rejects.toThrow();
    fakeClerk.failReads = false;
    expect(await holdsOf(clinicId)).toHaveLength(1);
  });

  it("an invitation made in Clerk's own panel holds no seat: its person arrives waiting, and gets a seat when one is free", async () => {
    const { clinicId, orgId } = await makeClinic(1);
    const outside = fakeClerk.inviteOutsideTheApp(orgId, "outside@example.test");
    expect((await checkSeats(clinicId)).invitations).toEqual([expect.objectContaining({ id: outside, holdsSeat: false })]);

    const arrival = user();
    fakeClerk.acceptInvitation(orgId, outside, arrival);
    // The seat was free, so the check seats them. Had it been full, they would be waiting.
    expect((await checkSeats(clinicId)).people.find((person) => person.userId === arrival)?.seat).toBe("held");
  });

  it("another clinic's invitation cannot be revoked from here", async () => {
    const mine = await makeClinic(1);
    const theirs = await makeClinic(1);
    await inviteSomeone({ clinicId: theirs.clinicId, email: "a@example.test", role: "member", actor: theirs.actor });
    const theirInvitation = fakeClerk.invitations(theirs.orgId)[0].id;

    await revokeInvitation({ clinicId: mine.clinicId, invitationId: theirInvitation, actor: mine.actor });
    expect(fakeClerk.invitations(theirs.orgId)[0].status).toBe("pending");
    expect(await holdsOf(theirs.clinicId)).toHaveLength(1);
  });
});

describe("people already in the clinic", () => {
  it("admin on and off never changes the seat count, and is logged", async () => {
    const dr = user();
    const { clinicId, orgId, actor } = await makeClinic(1, [{ userId: dr, firstName: "Sam", lastName: "Lee" }]);
    await seatsDb.reserveSeat(clinicId, dr);

    expect(await setAdmin({ clinicId, targetUserId: dr, admin: true, actor })).toEqual({ ok: true });
    expect(fakeClerk.roleOf(orgId, dr)).toBe("org:admin");
    expect(await setAdmin({ clinicId, targetUserId: dr, admin: false, actor })).toEqual({ ok: true });
    expect(fakeClerk.roleOf(orgId, dr)).toBe("org:member");
    expect(await seatsOf(clinicId)).toEqual([dr]);
    expect((await logOf(clinicId)).slice(-2)).toEqual([
      "Olive Owner (clinic admin): Admin switched on for Sam Lee. Seats were not changed.",
      "Olive Owner (clinic admin): Admin switched off for Sam Lee. Seats were not changed.",
    ]);
  });

  it("the owner cannot have admin switched off, and the last admin cannot be made a member", async () => {
    const { clinicId, orgId, owner } = await makeClinic(2);
    const other = { userId: user(), name: "Other Admin" };
    fakeClerk.addMember(orgId, { userId: other.userId, role: "org:admin" });

    expect(await setAdmin({ clinicId, targetUserId: owner, admin: false, actor: other })).toMatchObject({ ok: false, message: expect.stringContaining("always has admin") });
    expect(fakeClerk.roleOf(orgId, owner)).toBe("org:admin");

    // A clinic with no owner on record, down to one admin.
    const orphan = await makeClinic(2, [], { owner: null });
    const onlyAdmin = user();
    fakeClerk.addMember(orphan.orgId, { userId: onlyAdmin, role: "org:admin" });
    expect(await setAdmin({ clinicId: orphan.clinicId, targetUserId: onlyAdmin, admin: false, actor: { userId: onlyAdmin, name: "Only" } })).toMatchObject({
      ok: false,
      message: expect.stringContaining("at least one admin"),
    });
  });

  it("the owner cannot be removed, and nobody removes themselves here", async () => {
    const { clinicId, orgId, owner, actor } = await makeClinic(2);
    const other = { userId: user(), name: "Other Admin" };
    fakeClerk.addMember(orgId, { userId: other.userId, role: "org:admin" });

    expect(await removePerson({ clinicId, targetUserId: owner, actor: other })).toMatchObject({ ok: false, message: expect.stringContaining("cannot be removed") });
    expect(await removePerson({ clinicId, targetUserId: other.userId, actor: other })).toMatchObject({ ok: false });
    expect(fakeClerk.isMember(orgId, owner)).toBe(true);
    expect(fakeClerk.isMember(orgId, other.userId)).toBe(true);
    expect(await removePerson({ clinicId, targetUserId: other.userId, actor })).toMatchObject({ ok: true });
  });

  it("removing someone frees their seat, and says so in the log", async () => {
    const dr = user();
    const { clinicId, orgId, actor } = await makeClinic(1, [{ userId: dr, firstName: "Sam", lastName: "Lee" }]);
    await seatsDb.reserveSeat(clinicId, dr);

    expect(await removePerson({ clinicId, targetUserId: dr, actor })).toMatchObject({ ok: true });
    expect(fakeClerk.isMember(orgId, dr)).toBe(false);
    expect(await seatsOf(clinicId)).toEqual([]);
    expect((await logOf(clinicId)).at(-1)).toBe("Olive Owner (clinic admin): Sam Lee was removed from the clinic, so their seat is free. Now 0 of 1 seat in use.");
  });

  it("if the seat could not be let go after a removal, the next check does it", async () => {
    const dr = user();
    const { clinicId, actor } = await makeClinic(1, [{ userId: dr }]);
    await seatsDb.reserveSeat(clinicId, dr);
    vi.mocked(seatsDb.releaseSeat).mockRejectedValueOnce(new Error("database blinked"));

    expect(await removePerson({ clinicId, targetUserId: dr, actor })).toMatchObject({ ok: true });
    expect(await seatsOf(clinicId)).toEqual([dr]);
    await checkSeats(clinicId);
    expect(await seatsOf(clinicId)).toEqual([]);
  });

  it("gives a free seat to someone waiting, and refuses when none is free", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, actor } = await makeClinic(1, [{ userId: a }, { userId: b }]);

    expect(await giveSeat({ clinicId, targetUserId: a, actor })).toEqual({ ok: true });
    expect(await giveSeat({ clinicId, targetUserId: b, actor })).toMatchObject({ ok: false, message: expect.stringContaining("All 1 seat is taken") });
    expect(await seatsOf(clinicId)).toEqual([a]);
  });

  it("the owner decides for themselves whether to take a seat, and only the owner may go without one", async () => {
    const dr = user();
    const { clinicId, owner, actor } = await makeClinic(2, [{ userId: dr, role: "org:admin" }]);
    const otherAdmin = { userId: dr, name: "Dr Admin" };

    expect(await giveSeat({ clinicId, targetUserId: owner, actor: otherAdmin })).toMatchObject({ ok: false, message: expect.stringContaining("Only the account owner") });
    expect(await giveSeat({ clinicId, targetUserId: owner, actor })).toEqual({ ok: true });
    expect(await seatsOf(clinicId)).toContain(owner);
    expect(await releaseOwnSeat({ clinicId, actor })).toEqual({ ok: true });
    expect(await seatsOf(clinicId)).not.toContain(owner);

    await seatsDb.reserveSeat(clinicId, dr);
    expect(await releaseOwnSeat({ clinicId, actor: otherAdmin })).toMatchObject({ ok: false });
    expect(await seatsOf(clinicId)).toEqual([dr]);
  });

  it("a person in another clinic cannot be reached from this one", async () => {
    const mine = await makeClinic(2);
    const theirs = await makeClinic(2, [{ userId: user() }]);
    const [theirMember] = (await checkSeats(theirs.clinicId)).people.filter((person) => !person.isOwner);

    for (const change of [
      () => setAdmin({ clinicId: mine.clinicId, targetUserId: theirMember.userId, admin: true, actor: mine.actor }),
      () => removePerson({ clinicId: mine.clinicId, targetUserId: theirMember.userId, actor: mine.actor }),
      () => giveSeat({ clinicId: mine.clinicId, targetUserId: theirMember.userId, actor: mine.actor }),
      () => handOffOwner({ clinicId: mine.clinicId, toUserId: theirMember.userId, actor: mine.actor }),
    ]) {
      expect(await change()).toMatchObject({ ok: false, message: expect.stringContaining("not in your clinic") });
    }
    expect(fakeClerk.isMember(theirs.orgId, theirMember.userId)).toBe(true);
    expect(await seatsOf(mine.clinicId)).toEqual([]);
    expect(await ownerOf(mine.clinicId)).toBe(mine.owner);
  });
});

describe("the name patients see", () => {
  it("is Dr. First Last by default; an admin can type another, it is logged, and clearing it goes back to the default", async () => {
    const dr = user();
    const { clinicId, orgId, actor } = await makeClinic(2, [{ userId: dr, firstName: "Jane", lastName: "Smith" }]);
    await seatsDb.reserveSeat(clinicId, dr);

    let board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === dr)).toMatchObject({ patientName: "Dr. Jane Smith", typedPatientName: null, defaultPatientName: "Dr. Jane Smith" });

    expect(await setPatientName({ clinicId, targetUserId: dr, name: "  Jane Smith,  PA-C ", actor })).toEqual({
      ok: true,
      message: `Patients will see "Jane Smith, PA-C" on links from Jane Smith from now on.`,
    });
    board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === dr)).toMatchObject({ patientName: "Jane Smith, PA-C", typedPatientName: "Jane Smith, PA-C" });
    expect((await logOf(clinicId)).at(-1)).toBe(
      `Olive Owner (clinic admin): Name patients see for Jane Smith changed from the default, "Dr. Jane Smith" to "Jane Smith, PA-C". Links already sent keep the old name.`,
    );

    // Saving the same name again writes nothing.
    const entries = (await logOf(clinicId)).length;
    expect(await setPatientName({ clinicId, targetUserId: dr, name: "Jane Smith, PA-C", actor })).toMatchObject({ ok: true });
    expect(await logOf(clinicId)).toHaveLength(entries);

    expect(await setPatientName({ clinicId, targetUserId: dr, name: "", actor })).toMatchObject({ ok: true });
    expect((await checkSeats(clinicId)).people.find((person) => person.userId === dr)).toMatchObject({ patientName: "Dr. Jane Smith", typedPatientName: null });
    // Nothing was written to Clerk.
    expect(fakeClerk.writes.filter((write) => write.orgId === orgId)).toEqual([]);
  });

  it("refuses a bad name, someone without a seat, and someone in another clinic, changing nothing", async () => {
    const dr = user();
    const waiting = user();
    const { clinicId, actor } = await makeClinic(1, [{ userId: dr, firstName: "Jane", lastName: "Smith" }, { userId: waiting, firstName: "Wait", lastName: "Ing" }]);
    await seatsDb.reserveSeat(clinicId, dr);
    const elsewhere = await makeClinic(2, [{ userId: user() }]);
    const entries = (await logOf(clinicId)).length;

    expect(await setPatientName({ clinicId, targetUserId: dr, name: "<b>Jane</b>", actor })).toMatchObject({ ok: false, message: expect.stringContaining("letters") });
    expect(await setPatientName({ clinicId, targetUserId: waiting, name: "Wait Ing, NP", actor })).toMatchObject({
      ok: false,
      message: expect.stringContaining("does not hold a seat"),
    });
    expect(await setPatientName({ clinicId, targetUserId: elsewhere.owner, name: "Olive", actor })).toEqual({ ok: false, message: "That person is not in your clinic." });
    expect(await setPatientName({ clinicId: elsewhere.clinicId, targetUserId: dr, name: "Jane", actor: elsewhere.actor })).toEqual({ ok: false, message: "That person is not in your clinic." });

    expect((await seatsDb.listSeatNames(clinicId)).map((seat) => seat.displayName)).toEqual([null]);
    expect(await logOf(clinicId)).toHaveLength(entries);
  });

  it("has no default for someone Clerk has no name for, and never uses their email", async () => {
    const dr = user();
    const { clinicId } = await makeClinic(1, [{ userId: dr, firstName: "", lastName: "", identifier: "private@example.test" }]);
    await seatsDb.reserveSeat(clinicId, dr);
    expect((await checkSeats(clinicId)).people.find((person) => person.userId === dr)).toMatchObject({ patientName: null, defaultPatientName: null });
  });
});

describe("handing over the account owner", () => {
  it("moves the free spot: the new owner's seat passes to the old owner in the same save, even with no seat free", async () => {
    const next = user();
    const { clinicId, owner, actor } = await makeClinic(1, [{ userId: next, firstName: "Nia", lastName: "Next", role: "org:admin" }]);
    await seatsDb.reserveSeat(clinicId, next);

    expect(await handOffOwner({ clinicId, toUserId: next, actor })).toMatchObject({ ok: true, message: "Nia Next is now the account owner." });
    expect(await ownerOf(clinicId)).toBe(next);
    expect(await seatsOf(clinicId)).toEqual([owner]);
    const board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === owner)?.seat).toBe("held");
    expect(board.people.find((person) => person.userId === next)?.seat).toBe("none");
    expect(await logOf(clinicId)).toContainEqual(
      "Olive Owner (clinic admin): Account owner changed from Olive Owner to Nia Next (handed over by Olive Owner). Nia Next's seat passed to Olive Owner, so the seat count did not change.",
    );
  });

  it("an old owner who already has a seat keeps it, and so does the new owner", async () => {
    const next = user();
    const { clinicId, owner, actor } = await makeClinic(2, [{ userId: next, role: "org:admin" }]);
    await seatsDb.reserveSeat(clinicId, next);
    await seatsDb.reserveSeat(clinicId, owner);

    expect(await handOffOwner({ clinicId, toUserId: next, actor })).toMatchObject({ ok: true });
    expect(await seatsOf(clinicId)).toEqual([next, owner].sort());
    expect((await logOf(clinicId)).at(-1)).toContain("Seats were not changed.");
  });

  it("says so when the new owner had no seat to pass on and none is free, so the old owner waits", async () => {
    const [next, dr] = [user(), user()];
    const { clinicId, owner, actor } = await makeClinic(1, [{ userId: next, role: "org:admin" }, { userId: dr }]);
    await seatsDb.reserveSeat(clinicId, dr);

    expect(await handOffOwner({ clinicId, toUserId: next, actor })).toMatchObject({ ok: true, message: expect.stringContaining("you are waiting for one") });
    expect((await checkSeats(clinicId)).people.find((person) => person.userId === owner)?.seat).toBe("waiting");
  });

  it("only to someone with admin on, and only by the owner", async () => {
    const [member, admin] = [user(), user()];
    const { clinicId, actor } = await makeClinic(2, [{ userId: member }, { userId: admin, role: "org:admin" }]);

    expect(await handOffOwner({ clinicId, toUserId: member, actor })).toMatchObject({ ok: false, message: expect.stringContaining("Switch admin on") });
    expect(await handOffOwner({ clinicId, toUserId: member, actor: { userId: admin, name: "Not Owner" } })).toMatchObject({ ok: false, message: expect.stringContaining("Only the account owner") });
    expect(await handOffOwner({ clinicId, toUserId: actor.userId, actor })).toMatchObject({ ok: false });
  });

  it("two handoffs from two tabs at once: one wins, the other is told and changes nothing", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, actor } = await makeClinic(3, [{ userId: a, role: "org:admin" }, { userId: b, role: "org:admin" }]);

    const results = await Promise.all([handOffOwner({ clinicId, toUserId: a, actor }), handOffOwner({ clinicId, toUserId: b, actor })]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ message: expect.stringContaining("no longer the account owner") });
    expect([a, b]).toContain(await ownerOf(clinicId));
    expect((await logOf(clinicId)).filter((line) => line.includes("Account owner changed"))).toHaveLength(1);
  });
});

describe("Pulse staff setting the owner", () => {
  it("makes any current member the owner, switching admin on for them, and logs both", async () => {
    const member = user();
    const { clinicId, orgId } = await makeClinic(2, [{ userId: member, firstName: "Mo", lastName: "Member" }], { owner: null });

    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({ ok: true });
    expect(await ownerOf(clinicId)).toBe(member);
    expect(fakeClerk.roleOf(orgId, member)).toBe("org:admin");
    expect((await logOf(clinicId)).filter((line) => line.startsWith("Evan Miller:"))).toEqual([
      "Evan Miller: Admin switched on for Mo Member, to make them the account owner.",
      "Evan Miller: Account owner changed from nobody to Mo Member (set by Pulse 3D staff). Seats were not changed.",
    ]);
  });

  it("passes the new owner's seat to the old owner when the old owner is still in the clinic", async () => {
    const member = user();
    const { clinicId, owner } = await makeClinic(1, [{ userId: member, firstName: "Mo", lastName: "Member" }]);
    await seatsDb.reserveSeat(clinicId, member);

    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({ ok: true });
    expect(await ownerOf(clinicId)).toBe(member);
    expect(await seatsOf(clinicId)).toEqual([owner]);
  });

  it("refuses someone who is not a member of this clinic, and changes nothing if Clerk will not make them an admin", async () => {
    const member = user();
    const { clinicId, owner } = await makeClinic(2, [{ userId: member }]);
    expect(await setOwnerByStaff({ clinicId, toUserId: user(), staffName: "Evan Miller" })).toMatchObject({ ok: false });

    fakeClerk.failNextWrites = 1;
    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({ ok: false });
    expect(await ownerOf(clinicId)).toBe(owner);
  });
});

describe("the seat check", () => {
  it("notices the owner has left, clears the owner, and logs it", async () => {
    const dr = user();
    const { clinicId, orgId, owner } = await makeClinic(1, [{ userId: dr }]);
    fakeClerk.removeMember(orgId, owner);

    const board = await checkSeats(clinicId);
    expect(board.ownerUserId).toBeNull();
    expect(await ownerOf(clinicId)).toBeNull();
    expect((await logOf(clinicId)).at(-1)).toContain("the account owner is no longer in the clinic");
  });

  it("existing people who were once marked staff are shown waiting, and nobody is removed or relabelled", async () => {
    const [staff, surgeon] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [
      { userId: surgeon, metadata: { kind: "surgeon" }, joinedAt: 2 },
      { userId: staff, metadata: { kind: "staff" }, joinedAt: 3 },
    ]);
    await seatsDb.reserveSeat(clinicId, surgeon);

    const board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === staff)?.seat).toBe("waiting");
    expect(board.waiting).toBe(1);
    expect(fakeClerk.isMember(orgId, staff)).toBe(true);
    expect(fakeClerk.writes).toEqual([]);
  });

  it("an empty answer from Clerk changes nothing", async () => {
    const dr = user();
    const { clinicId, orgId, owner } = await makeClinic(1, [{ userId: dr }]);
    await seatsDb.reserveSeat(clinicId, dr);
    fakeClerk.removeMember(orgId, dr);
    fakeClerk.removeMember(orgId, owner);

    await checkSeats(clinicId);
    expect(await seatsOf(clinicId)).toEqual([dr]);
    expect(await ownerOf(clinicId)).toBe(owner);
  });
});

describe("the only way round the seats", () => {
  it("only lib/seat-changes.ts uses the Clerk writes in lib/people.ts", () => {
    const writers = ["sendInvitationFromClerk", "revokeInvitationInClerk", "setRoleInClerk", "removeFromClerk"];
    const root = process.cwd().replace(/\\/g, "/");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".git"].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(path, "utf8");
          const direct = /updateOrganizationMembership\b|deleteOrganizationMembership|createOrganizationInvitation|revokeOrganizationInvitation/.test(text);
          if (writers.some((writer) => text.includes(writer)) || direct) offenders.push(path.replace(/\\/g, "/").slice(root.length + 1));
        }
      }
    };
    for (const dir of ["app", "lib", "components", "prisma"]) walk(join(process.cwd(), dir));
    // lib/people.ts defines them, lib/seat-changes.ts is the one caller, and the stand-in for Clerk answers them.
    expect(offenders.sort()).toEqual(["lib/people.ts", "lib/seat-changes.ts", "lib/testing/fake-clerk.ts"]);
  });
});
