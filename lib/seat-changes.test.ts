import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import { setClinicPlan } from "./db/clinics";
import { listNotesForClinic } from "./db/notes";
import * as seatsDb from "./db/seats";
import { changeKind, checkSeats } from "./seat-changes";
import { PENDING_WINDOW_MS } from "./seats";
import { fakeClerk } from "./testing/fake-clerk";

/**
 * Becoming a surgeon or staff, end to end: the real database (the Neon
 * testing branch) and a stand-in for Clerk that can be made to fail, to lose
 * a member, or to have a label changed behind the app's back.
 *
 * What these prove is the part a database transaction cannot: that every way
 * the two-step change can stop halfway leaves something harmless, and that
 * the seat check puts it right. A stand-in is not Clerk; the walkthrough
 * against a real Clerk organization is a separate check (see the PR).
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

// The real database functions, each wrapped so ONE call can be made to fail.
vi.mock("./db/seats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/seats")>();
  return { ...actual, releaseSeat: vi.fn(actual.releaseSeat), confirmSeat: vi.fn(actual.confirmSeat) };
});

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;
const ADMIN = { type: "admin", name: "Vitest Admin" } as const;
const SELF = { type: "self" } as const;

/** A clinic with some seats, and its organization in the stand-in, with these people in it. */
async function makeClinic(surgeonSeats: number, members: Parameters<typeof fakeClerk.addOrg>[2] = []) {
  const orgId = `org_test_${id()}`;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest seat clinic ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest seat clinic", members);
  return { clinicId: clinic.id, orgId };
}

const seatsOf = async (clinicId: string) => (await seatsDb.listSeatRows(clinicId)).map((row) => `${row.clerkUserId}:${row.syncState}`);
const logOf = async (clinicId: string) => (await listNotesForClinic(clinicId)).map((note) => `${note.authorName}: ${note.body}`).reverse();

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined); // failures are logged on purpose; keep the test output readable
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("an office admin marks someone", () => {
  it("as a surgeon: the seat is taken here, the label is written to Clerk, and the log says who and how many", async () => {
    const dr = user();
    const { clinicId, orgId } = await makeClinic(2, [{ userId: dr, firstName: "Sam", lastName: "Lee" }]);

    const result = await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN });

    expect(result).toMatchObject({ ok: true, kind: "surgeon", seat: "held", summary: { inUse: 1, seats: 2 } });
    expect(fakeClerk.kindOf(orgId, dr)).toBe("surgeon");
    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]);
    expect(await logOf(clinicId)).toEqual(["Vitest Admin (clinic admin): Surgeon seat given to Sam Lee. Now 1 of 2 surgeon seats in use."]);
  });

  it("is refused when every seat is taken, and nothing is written anywhere", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [{ userId: a }, { userId: b }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });

    const result = await changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: ADMIN });

    expect(result).toMatchObject({ ok: false, reason: "full" });
    expect(result.ok === false && result.message).toContain("All 1 surgeon seat is in use");
    expect(fakeClerk.kindOf(orgId, b)).toBeUndefined(); // not relabelled
    expect(await seatsOf(clinicId)).toEqual([`${a}:SYNCED`]);
  });

  it("staff never take a seat, however many there are", async () => {
    const people = [user(), user(), user()];
    const { clinicId, orgId } = await makeClinic(1, people.map((userId) => ({ userId })));

    for (const who of people) {
      expect(await changeKind({ clinicId, targetUserId: who, kind: "staff", actor: ADMIN })).toMatchObject({ ok: true, kind: "staff", seat: "none" });
    }
    expect(people.map((who) => fakeClerk.kindOf(orgId, who))).toEqual(["staff", "staff", "staff"]);
    expect(await seatsOf(clinicId)).toEqual([]);
    expect(await logOf(clinicId)).toEqual([]); // no seat moved, so nothing to write up
  });

  it("marking a surgeon as staff frees their seat for someone else", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [{ userId: a, firstName: "Ann", lastName: "Ray" }, { userId: b }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });

    expect(await changeKind({ clinicId, targetUserId: a, kind: "staff", actor: ADMIN })).toMatchObject({ ok: true, seat: "none", summary: { inUse: 0 } });
    expect(await changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held" });

    expect(fakeClerk.kindOf(orgId, a)).toBe("staff");
    expect(await seatsOf(clinicId)).toEqual([`${b}:SYNCED`]);
    expect((await logOf(clinicId))[1]).toBe("Vitest Admin (clinic admin): Ann Ray marked as staff, so their surgeon seat was let go. Now 0 of 1 surgeon seat in use.");
  });

  it("the same request sent three times at once ends with one seat, one label and one log entry", async () => {
    const dr = user();
    const { clinicId } = await makeClinic(3, [{ userId: dr }]);

    const results = await Promise.all([1, 2, 3].map(() => changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN })));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]);
    expect(await logOf(clinicId)).toHaveLength(1);
  });

  it("two admins promoting two people for the last seat at once: at most one gets it, and the other is not relabelled", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [{ userId: a }, { userId: b }]);

    const results = await Promise.all([
      changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN }),
      changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: { type: "admin", name: "Second Admin" } }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "full")).toHaveLength(1);
    expect(await seatsDb.listSeatRows(clinicId)).toHaveLength(1);
    // Exactly one of them is labelled surgeon in Clerk: the one who holds the seat.
    const labelled = [a, b].filter((who) => fakeClerk.kindOf(orgId, who) === "surgeon");
    expect(labelled).toEqual((await seatsDb.listSeatRows(clinicId)).map((row) => row.clerkUserId));
  });

  it("cannot reach a person in another clinic: nothing is reserved, written or logged in either", async () => {
    const [mine, theirs] = [user(), user()];
    const a = await makeClinic(2, [{ userId: mine }]);
    const b = await makeClinic(2, [{ userId: theirs }]);

    const result = await changeKind({ clinicId: a.clinicId, targetUserId: theirs, kind: "surgeon", actor: ADMIN });

    expect(result).toMatchObject({ ok: false, reason: "not-a-member" });
    expect(fakeClerk.writes).toEqual([]);
    expect(fakeClerk.kindOf(b.orgId, theirs)).toBeUndefined();
    expect(await seatsOf(a.clinicId)).toEqual([]);
    expect(await seatsOf(b.clinicId)).toEqual([]);
  });

  it("refuses something that is not a user id before asking Clerk anything", async () => {
    const { clinicId } = await makeClinic(1);
    for (const bad of ["", "org_123", "user_x'; DROP TABLE", "../etc"]) {
      expect(await changeKind({ clinicId, targetUserId: bad, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: false, reason: "not-a-member" });
    }
  });
});

describe("when Clerk fails halfway", () => {
  it("a failed label write lets the reservation go: no seat is held, nothing is logged, and trying again works", async () => {
    const dr = user();
    const { clinicId, orgId } = await makeClinic(1, [{ userId: dr }]);
    fakeClerk.failNextWrites = 1;

    const failed = await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN });

    expect(failed).toMatchObject({ ok: false, reason: "not-saved" });
    expect(failed.ok === false && failed.message).not.toContain("fake Clerk"); // the technical detail stays in the server log
    expect(await seatsOf(clinicId)).toEqual([]);
    expect(fakeClerk.kindOf(orgId, dr)).toBeUndefined();
    expect(await logOf(clinicId)).toEqual([]);

    expect(await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held" });
  });

  it("when even letting go fails, the seat shows as pending, can be tried again, and otherwise lets itself go", async () => {
    const [dr, other] = [user(), user()];
    const { clinicId } = await makeClinic(1, [{ userId: dr }, { userId: other }]);
    fakeClerk.failNextWrites = 1;
    vi.mocked(seatsDb.releaseSeat).mockRejectedValueOnce(new Error("the database blinked"));

    expect(await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: false, reason: "not-saved" });

    // The reservation is stuck: reserved here, never confirmed by Clerk.
    expect(await seatsOf(clinicId)).toEqual([`${dr}:PENDING`]);
    const board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === dr)?.seat).toBe("pending");
    expect(board.pending).toBe(1);
    expect(await seatsOf(clinicId)).toEqual([`${dr}:PENDING`]); // too young to be let go: it might still be on its way

    // A few minutes later nobody has tried again, so the next check lets it go, and the seat is free.
    const later = new Date(Date.now() + PENDING_WINDOW_MS + 5_000);
    expect((await checkSeats(clinicId, later)).released).toBe(1);
    expect(await seatsOf(clinicId)).toEqual([]);
    expect(await changeKind({ clinicId, targetUserId: other, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held" });
  });

  it("'Try again' on a pending seat finishes the job without taking a second seat", async () => {
    const dr = user();
    const { clinicId, orgId } = await makeClinic(1, [{ userId: dr }]);
    fakeClerk.failNextWrites = 1;
    vi.mocked(seatsDb.releaseSeat).mockRejectedValueOnce(new Error("the database blinked"));
    await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN });
    expect(await seatsOf(clinicId)).toEqual([`${dr}:PENDING`]);

    expect(await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held", summary: { inUse: 1 } });

    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]);
    expect(fakeClerk.kindOf(orgId, dr)).toBe("surgeon");
  });

  it("a label that landed but was never confirmed here is confirmed by the next check", async () => {
    const dr = user();
    const { clinicId } = await makeClinic(1, [{ userId: dr }]);
    vi.mocked(seatsDb.confirmSeat).mockRejectedValueOnce(new Error("the database blinked"));

    // The label is saved and the seat is reserved, so the person is a surgeon holding a seat.
    expect(await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held" });
    expect(await seatsOf(clinicId)).toEqual([`${dr}:PENDING`]);

    const board = await checkSeats(clinicId);
    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]);
    expect(board.people[0].seat).toBe("held");
  });

  it("a failed staff write changes nothing; a failed release after it is put right by the next check", async () => {
    const dr = user();
    const { clinicId, orgId } = await makeClinic(1, [{ userId: dr }]);
    await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN });

    fakeClerk.failNextWrites = 1;
    expect(await changeKind({ clinicId, targetUserId: dr, kind: "staff", actor: ADMIN })).toMatchObject({ ok: false, reason: "not-saved" });
    expect(fakeClerk.kindOf(orgId, dr)).toBe("surgeon");
    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]); // still a surgeon, still seated

    vi.mocked(seatsDb.releaseSeat).mockRejectedValueOnce(new Error("the database blinked"));
    expect(await changeKind({ clinicId, targetUserId: dr, kind: "staff", actor: ADMIN })).toMatchObject({ ok: true, kind: "staff" });
    expect(await seatsOf(clinicId)).toEqual([`${dr}:SYNCED`]); // the label is staff, the seat was left behind

    expect((await checkSeats(clinicId)).released).toBe(1);
    expect(await seatsOf(clinicId)).toEqual([]);
  });

  it("when Clerk cannot be read, the check throws and changes nothing, and a full clinic is still refused calmly", async () => {
    const [a, b] = [user(), user()];
    const { clinicId } = await makeClinic(1, [{ userId: a }, { userId: b }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });

    fakeClerk.failReads = true;
    await expect(checkSeats(clinicId)).rejects.toThrow();
    expect(await seatsOf(clinicId)).toEqual([`${a}:SYNCED`]);
    expect(await changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: false, reason: "not-saved" });
  });
});

describe("changes made outside the app", () => {
  it("a surgeon removed in Clerk's own panel: the next check lets their seat go and writes it up", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(2, [{ userId: a }, { userId: b }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });
    await changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: ADMIN });

    fakeClerk.removeMember(orgId, a);
    const board = await checkSeats(clinicId);

    expect(board).toMatchObject({ released: 1, summary: { inUse: 1, free: 1 } });
    expect(await seatsOf(clinicId)).toEqual([`${b}:SYNCED`]);
    expect((await logOf(clinicId)).at(-1)).toBe(
      "seats: Seats checked against the clinic's people: 1 seat let go because the person is no longer in the clinic. Now 1 of 2 surgeon seats in use.",
    );
  });

  it("a full clinic is checked against Clerk before anyone is refused, so a seat freed by a removal is found", async () => {
    const [gone, arriving] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [{ userId: gone }, { userId: arriving }]);
    await changeKind({ clinicId, targetUserId: gone, kind: "surgeon", actor: ADMIN });
    fakeClerk.removeMember(orgId, gone); // nobody has opened the People page since

    expect(await changeKind({ clinicId, targetUserId: arriving, kind: "surgeon", actor: ADMIN })).toMatchObject({ ok: true, seat: "held", summary: { inUse: 1 } });
    expect(await seatsOf(clinicId)).toEqual([`${arriving}:SYNCED`]);
  });

  it("an invitation that arrives already labelled surgeon gets a seat only if one is free", async () => {
    const [seated, invitedA, invitedB] = [user(), user(), user()];
    const { clinicId, orgId } = await makeClinic(2, [{ userId: seated, joinedAt: 1 }]);
    await changeKind({ clinicId, targetUserId: seated, kind: "surgeon", actor: ADMIN });

    fakeClerk.addMember(orgId, { userId: invitedA, kind: "surgeon", joinedAt: 2 });
    fakeClerk.addMember(orgId, { userId: invitedB, kind: "surgeon", joinedAt: 3 });
    const board = await checkSeats(clinicId);

    expect(await seatsOf(clinicId)).toEqual([`${seated}:SYNCED`, `${invitedA}:SYNCED`]); // the earlier arrival got the one free seat
    expect(board.people.find((person) => person.userId === invitedB)?.seat).toBe("waiting");
    expect(board).toMatchObject({ waiting: 1, summary: { inUse: 2, seats: 2 } });
    expect(fakeClerk.kindOf(orgId, invitedB)).toBe("surgeon"); // waiting, not relabelled
  });

  it("a label changed to staff in Clerk's dashboard lets the seat go; one changed to surgeon at a full clinic waits", async () => {
    const [a, b] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, [{ userId: a }, { userId: b, kind: "staff" }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });

    fakeClerk.setKindOutsideTheApp(orgId, b, "surgeon");
    let board = await checkSeats(clinicId);
    expect(board.people.find((person) => person.userId === b)?.seat).toBe("waiting");
    expect(await seatsOf(clinicId)).toEqual([`${a}:SYNCED`]); // the limit held

    fakeClerk.setKindOutsideTheApp(orgId, a, "staff");
    board = await checkSeats(clinicId);
    expect(await seatsOf(clinicId)).toEqual([`${b}:SYNCED`]); // a's seat went, and the surgeon who was waiting got it
    expect(board.waiting).toBe(0);
  });

  it("surgeons marked before seats existed are given seats the first time anyone looks, oldest member first", async () => {
    const [first, second, third] = [user(), user(), user()];
    const { clinicId } = await makeClinic(2, [
      { userId: third, kind: "surgeon", joinedAt: 300 },
      { userId: first, kind: "surgeon", joinedAt: 100 },
      { userId: second, kind: "surgeon", joinedAt: 200 },
    ]);

    const board = await checkSeats(clinicId);

    expect(await seatsOf(clinicId)).toEqual([`${first}:SYNCED`, `${second}:SYNCED`]);
    expect(board.people.find((person) => person.userId === third)?.seat).toBe("waiting");
    expect((await logOf(clinicId)).at(-1)).toContain("2 surgeons who were waiting were given a seat. Now 2 of 2 surgeon seats in use.");
  });

  it("a check that finds nothing to do writes nothing", async () => {
    const dr = user();
    const { clinicId } = await makeClinic(1, [{ userId: dr }]);
    await changeKind({ clinicId, targetUserId: dr, kind: "surgeon", actor: ADMIN });
    const before = await logOf(clinicId);

    await checkSeats(clinicId);
    await checkSeats(clinicId);
    expect(await logOf(clinicId)).toEqual(before);
  });
});

describe("the surgeon question, answered by the person themselves", () => {
  it("'Yes' with a seat free: they get it", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(1, [{ userId: me, firstName: "Kai", lastName: "Moss" }]);

    expect(await changeKind({ clinicId, targetUserId: me, kind: "surgeon", actor: SELF })).toMatchObject({ ok: true, seat: "held" });
    expect(fakeClerk.kindOf(orgId, me)).toBe("surgeon");
    expect(await logOf(clinicId)).toEqual(["Kai Moss: Kai Moss said they are a surgeon and was given a seat. Now 1 of 1 surgeon seat in use."]);
  });

  it("'Yes' before the clinic has paid is kept as a request: let in, waiting, no seat taken", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(0, [{ userId: me, firstName: "Kai", lastName: "Moss" }]);

    const result = await changeKind({ clinicId, targetUserId: me, kind: "surgeon", actor: SELF });

    expect(result).toMatchObject({ ok: true, kind: "surgeon", seat: "waiting", summary: { seats: 0, inUse: 0 } });
    expect(fakeClerk.kindOf(orgId, me)).toBe("surgeon"); // their answer is kept, so they are not asked again
    expect(await seatsOf(clinicId)).toEqual([]);
    expect(await logOf(clinicId)).toEqual([
      "Kai Moss: Kai Moss said they are a surgeon. No seat was free (0 of 0 surgeon seats in use), so they are waiting for one. No seat was taken and no charge was changed.",
    ]);
  });

  it("the request is not a way round the limit once the clinic has paid: the plan's seats are all it ever gets", async () => {
    const [founder, second, third] = [user(), user(), user()];
    const { clinicId } = await makeClinic(0, [
      { userId: founder, joinedAt: 1 },
      { userId: second, joinedAt: 2 },
      { userId: third, joinedAt: 3 },
    ]);
    for (const who of [founder, second, third]) await changeKind({ clinicId, targetUserId: who, kind: "surgeon", actor: SELF });
    expect(await seatsOf(clinicId)).toEqual([]);

    // The clinic's plan starts with two seats (billing writes Clinic.surgeonSeats; the staff writer does the same here).
    await setClinicPlan(clinicId, ["KNEE"], 2, "Vitest Staff");
    const board = await checkSeats(clinicId);

    expect(await seatsOf(clinicId)).toEqual([`${founder}:SYNCED`, `${second}:SYNCED`]);
    expect(board).toMatchObject({ waiting: 1, summary: { inUse: 2, seats: 2, overBy: 0 } });

    // And a fourth person saying "Yes" now waits too: no seat appears for them.
    const fourth = user();
    fakeClerk.addMember((await seatsDb.getSeatClinic(clinicId))!.clerkOrgId!, { userId: fourth, joinedAt: 4 });
    expect(await changeKind({ clinicId, targetUserId: fourth, kind: "surgeon", actor: SELF })).toMatchObject({ ok: true, seat: "waiting" });
    expect(await seatsDb.listSeatRows(clinicId)).toHaveLength(2);
  });

  it("cannot be sent again to change an answer: 'No' stays 'No', and nothing is written", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(5, [{ userId: me }]);
    await changeKind({ clinicId, targetUserId: me, kind: "staff", actor: SELF });
    const writesBefore = fakeClerk.writes.length;

    const replay = await changeKind({ clinicId, targetUserId: me, kind: "surgeon", actor: SELF });

    expect(replay).toMatchObject({ ok: false, reason: "already-answered" });
    expect(fakeClerk.kindOf(orgId, me)).toBe("staff");
    expect(fakeClerk.writes).toHaveLength(writesBefore);
    expect(await seatsOf(clinicId)).toEqual([]); // five free seats, and still no way in
  });

  it("nor to change 'Yes' to 'No' and back, nor to grab a seat a waiting surgeon was refused", async () => {
    const me = user();
    const { clinicId } = await makeClinic(0, [{ userId: me }]);
    await changeKind({ clinicId, targetUserId: me, kind: "surgeon", actor: SELF }); // waiting

    expect(await changeKind({ clinicId, targetUserId: me, kind: "staff", actor: SELF })).toMatchObject({ ok: false, reason: "already-answered" });
    expect(await changeKind({ clinicId, targetUserId: me, kind: "surgeon", actor: SELF })).toMatchObject({ ok: false, reason: "already-answered" });
  });
});

describe("a plan Pulse staff deliberately set below the seats in use", () => {
  it("relabels nobody and takes no seat away, shows the gap, and blocks new seats until it is settled", async () => {
    const [a, b, c] = [user(), user(), user()];
    const { clinicId, orgId } = await makeClinic(2, [{ userId: a }, { userId: b }, { userId: c }]);
    await changeKind({ clinicId, targetUserId: a, kind: "surgeon", actor: ADMIN });
    await changeKind({ clinicId, targetUserId: b, kind: "surgeon", actor: ADMIN });

    await setClinicPlan(clinicId, [], 1, "Vitest Staff", { allowFewerSeatsThanInUse: true });
    const board = await checkSeats(clinicId);

    expect(board.summary).toEqual({ seats: 1, inUse: 2, free: 0, overBy: 1 });
    expect(await seatsDb.listSeatRows(clinicId)).toHaveLength(2); // both still seated
    expect([a, b].map((who) => fakeClerk.kindOf(orgId, who))).toEqual(["surgeon", "surgeon"]); // both still surgeons

    const refused = await changeKind({ clinicId, targetUserId: c, kind: "surgeon", actor: ADMIN });
    expect(refused.ok === false && refused.message).toContain("2 people hold a surgeon seat and your plan pays for 1");

    // Marking one as staff settles it; the seat that frees up is NOT handed to anyone, because the plan is now exactly full.
    await changeKind({ clinicId, targetUserId: a, kind: "staff", actor: ADMIN });
    expect((await checkSeats(clinicId)).summary).toEqual({ seats: 1, inUse: 1, free: 0, overBy: 0 });
  });
});

describe("nothing else writes the label", () => {
  it("only lib/seat-changes.ts uses writeKindToClerk, so there is no way round the seat limit", () => {
    const root = process.cwd();
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(path, "utf8").includes("writeKindToClerk")) {
          users.push(path.slice(root.length + 1).replace(/\\/g, "/"));
        }
      }
    };
    for (const dir of ["app", "lib", "components", "prisma"]) walk(join(root, dir));

    // Where it is defined, and the one place allowed to call it.
    expect(users.sort()).toEqual(["lib/people.ts", "lib/seat-changes.ts"]);
  });

  it("and nothing in the app calls Clerk's metadata write directly either", () => {
    const root = process.cwd();
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(path, "utf8").includes("updateOrganizationMembershipMetadata")) {
          users.push(path.slice(root.length + 1).replace(/\\/g, "/"));
        }
      }
    };
    for (const dir of ["app", "lib", "components", "prisma"]) walk(join(root, dir));
    expect(users.sort()).toEqual(["lib/people.ts", "lib/testing/fake-clerk.ts"]);
  });
});
