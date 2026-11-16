import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminLock from "./db/admin-change-lock";
import { prisma } from "./db/client";
import * as clinicsDb from "./db/clinics";
import { listNotesForClinic } from "./db/notes";
import { removePerson, setAdmin, setOwnerByStaff, type Outcome } from "./seat-changes";
import { fakeClerk } from "./testing/fake-clerk";
import { TimeoutError } from "./timeout";

/**
 * The edges of lib/seat-changes.ts found by the second security audit:
 *
 *   1. Two admins switching each other's admin off, or removing each other,
 *      at the same moment. Each one's checks passed before the other's write
 *      landed, so both went through and the clinic could be left with no
 *      admin. Now the checks and the Clerk write take turns per clinic
 *      (lib/db/admin-change-lock.ts). The forced overlap: the first change is
 *      held just before its Clerk write while the second is started. With the
 *      lock the second waits, checks again, and is refused. The control takes
 *      the lock away and shows both getting through, so the test would catch
 *      the lock's removal.
 *   2. Pulse staff setting the owner is two steps (admin on in Clerk, then the
 *      owner here). When the second failed after the first, staff were told
 *      "Nothing was changed". Now the answer says admin was switched on, and a
 *      Clerk that timed out gets "we cannot be sure".
 *
 * The database is real (the local test database or the testing branch);
 * Clerk is the in-memory stand-in. A stand-in is not Clerk.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 30_000 });

// The real lock and owner write, each wrapped so one test can take the lock away or make the write fail.
vi.mock("./db/admin-change-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/admin-change-lock")>();
  return { ...actual, withAdminChangeLock: vi.fn(actual.withAdminChangeLock) };
});
vi.mock("./db/clinics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/clinics")>();
  return { ...actual, setClinicOwner: vi.fn(actual.setClinicOwner) };
});

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

/** An open clinic with NO account owner and two admins, Ann and Bob: the case where nobody else keeps admin. */
async function twoAdminClinic() {
  const orgId = `org_test_${id()}`;
  const [ann, bob] = [user(), user()];
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest admin race ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats: 3, ownerClerkUserId: null },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest admin race", [
    { userId: ann, firstName: "Ann", lastName: "Admin", role: "org:admin" },
    { userId: bob, firstName: "Bob", lastName: "Admin", role: "org:admin" },
  ]);
  return { clinicId: clinic.id, orgId, ann: { userId: ann, name: "Ann Admin" }, bob: { userId: bob, name: "Bob Admin" } };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start `first`, and at the moment its Clerk write is about to land, start `second` and give it two seconds
 * (many times what an unblocked change takes here) to get as far as it can before the first write lands.
 */
async function overlap(first: () => Promise<Outcome>, second: () => Promise<Outcome>) {
  let secondRun: Promise<Outcome> | null = null;
  fakeClerk.beforeWrite = async () => {
    if (secondRun) return;
    secondRun = second();
    await pause(2_000);
  };
  const firstResult = await first();
  const secondResult = await secondRun!;
  return [firstResult, secondResult] as const;
}

const adminsOf = (orgId: string, ...userIds: string[]) => userIds.filter((userId) => fakeClerk.roleOf(orgId, userId) === "org:admin");

beforeEach(() => {
  fakeClerk.reset();
  vi.mocked(adminLock.withAdminChangeLock).mockClear();
  vi.mocked(clinicsDb.setClinicOwner).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("two admins acting on each other at the same moment", () => {
  it("switching each other's admin off: the second waits, is refused, and the clinic keeps an admin", async () => {
    const { clinicId, orgId, ann, bob } = await twoAdminClinic();
    const [first, second] = await overlap(
      () => setAdmin({ clinicId, targetUserId: bob.userId, admin: false, actor: ann }),
      () => setAdmin({ clinicId, targetUserId: ann.userId, admin: false, actor: bob }),
    );
    expect(first).toEqual({ ok: true });
    expect(second).toMatchObject({ ok: false, message: expect.stringContaining("You are no longer an admin of this clinic") });
    expect(adminsOf(orgId, ann.userId, bob.userId)).toEqual([ann.userId]);
    expect(fakeClerk.writes.filter((write) => !write.failed)).toHaveLength(1);
    expect((await listNotesForClinic(clinicId)).map((note) => note.body)).toEqual(["Admin switched off for Bob Admin. Seats were not changed."]);
  });

  it("removing each other: the second waits, is refused, and the clinic keeps an admin", async () => {
    const { clinicId, orgId, ann, bob } = await twoAdminClinic();
    const [first, second] = await overlap(
      () => removePerson({ clinicId, targetUserId: bob.userId, actor: ann }),
      () => removePerson({ clinicId, targetUserId: ann.userId, actor: bob }),
    );
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, message: expect.stringContaining("You are no longer an admin of this clinic") });
    expect(fakeClerk.isMember(orgId, ann.userId)).toBe(true);
    expect(fakeClerk.isMember(orgId, bob.userId)).toBe(false);
    expect(adminsOf(orgId, ann.userId)).toEqual([ann.userId]);
  });

  it("one switching admin off while the other removes them: still one admin left", async () => {
    const { clinicId, orgId, ann, bob } = await twoAdminClinic();
    const [first, second] = await overlap(
      () => removePerson({ clinicId, targetUserId: bob.userId, actor: ann }),
      () => setAdmin({ clinicId, targetUserId: ann.userId, admin: false, actor: bob }),
    );
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false });
    expect(adminsOf(orgId, ann.userId)).toEqual([ann.userId]);
  });

  it("CONTROL: without the lock, both switch-offs get through and the clinic is left with no admin", async () => {
    vi.mocked(adminLock.withAdminChangeLock).mockImplementation(async (_clinicId, work) => work());
    try {
      const { clinicId, orgId, ann, bob } = await twoAdminClinic();
      const [first, second] = await overlap(
        () => setAdmin({ clinicId, targetUserId: bob.userId, admin: false, actor: ann }),
        () => setAdmin({ clinicId, targetUserId: ann.userId, admin: false, actor: bob }),
      );
      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(adminsOf(orgId, ann.userId, bob.userId)).toEqual([]);
    } finally {
      vi.mocked(adminLock.withAdminChangeLock).mockReset();
      const actual = await vi.importActual<typeof import("./db/admin-change-lock")>("./db/admin-change-lock");
      vi.mocked(adminLock.withAdminChangeLock).mockImplementation(actual.withAdminChangeLock);
    }
  });

  it("changes at two different clinics never wait for each other", async () => {
    const one = await twoAdminClinic();
    const two = await twoAdminClinic();
    const started = Date.now();
    const [first, second] = await overlap(
      () => setAdmin({ clinicId: one.clinicId, targetUserId: one.bob.userId, admin: false, actor: one.ann }),
      async () => {
        const result = await setAdmin({ clinicId: two.clinicId, targetUserId: two.bob.userId, admin: false, actor: two.ann });
        // It finished while the first was still held before its write.
        expect(Date.now() - started).toBeLessThan(2_000);
        return result;
      },
    );
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it("an admin whose own admin was switched off just before is refused, with nothing written", async () => {
    const { clinicId, orgId, ann, bob } = await twoAdminClinic();
    fakeClerk.setRoleOutsideTheApp(orgId, ann.userId, "org:member");
    expect(await removePerson({ clinicId, targetUserId: bob.userId, actor: ann })).toMatchObject({ ok: false });
    expect(await setAdmin({ clinicId, targetUserId: bob.userId, admin: false, actor: ann })).toMatchObject({ ok: false });
    expect(fakeClerk.writes).toEqual([]);
    expect(fakeClerk.isMember(orgId, bob.userId)).toBe(true);
  });

  it("if the lock fails once the Clerk write is under way, the answer is 'we cannot be sure', not 'nothing was changed'", async () => {
    const { clinicId, ann, bob } = await twoAdminClinic();
    vi.mocked(adminLock.withAdminChangeLock).mockImplementationOnce(async (_clinicId, work) => {
      await work();
      throw new Error("the transaction ran out of time");
    });
    expect(await setAdmin({ clinicId, targetUserId: bob.userId, admin: false, actor: ann })).toMatchObject({
      ok: false,
      message: expect.stringContaining("we cannot be sure"),
    });

    // And before any write: honest that nothing was changed.
    vi.mocked(adminLock.withAdminChangeLock).mockImplementationOnce(async () => {
      throw new Error("the database could not be reached");
    });
    expect(await removePerson({ clinicId, targetUserId: bob.userId, actor: ann })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Nothing was changed"),
    });
  });
});

describe("Pulse staff setting the owner, when a step fails", () => {
  async function clinicWithMember() {
    const orgId = `org_test_${id()}`;
    const member = user();
    const clinic = await prisma.clinic.create({
      data: { name: `Vitest staff owner ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats: 2, ownerClerkUserId: null },
      select: { id: true },
    });
    createdClinicIds.push(clinic.id);
    fakeClerk.addOrg(orgId, "Vitest staff owner", [{ userId: member, firstName: "Mo", lastName: "Member" }]);
    return { clinicId: clinic.id, orgId, member };
  }
  const ownerOf = async (clinicId: string) => (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId;

  it("admin switched on, then the owner could not be saved: says admin was switched on, never 'Nothing was changed'", async () => {
    const { clinicId, orgId, member } = await clinicWithMember();
    vi.mocked(clinicsDb.setClinicOwner).mockRejectedValueOnce(new Error("the database could not be reached"));

    const outcome = await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" });
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("Admin was switched on for Mo Member") });
    expect(outcome.ok === false && outcome.message).not.toContain("Nothing was changed");
    expect(fakeClerk.roleOf(orgId, member)).toBe("org:admin");
    expect(await ownerOf(clinicId)).toBeNull();
    // The log records the admin switch that did happen.
    expect((await listNotesForClinic(clinicId)).map((note) => note.body)).toEqual(["Admin switched on for Mo Member, to make them the account owner."]);

    // Trying again finishes the job.
    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({ ok: true });
    expect(await ownerOf(clinicId)).toBe(member);
  });

  it("someone already an admin, and the owner could not be saved: nothing was changed, truthfully", async () => {
    const { clinicId, orgId, member } = await clinicWithMember();
    fakeClerk.setRoleOutsideTheApp(orgId, member, "org:admin");
    vi.mocked(clinicsDb.setClinicOwner).mockRejectedValueOnce(new Error("the database could not be reached"));
    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Nothing was changed"),
    });
    expect(fakeClerk.writes).toEqual([]);
  });

  it("Clerk timing out on the admin switch: 'we cannot be sure', and the owner is not touched", async () => {
    const { clinicId, member } = await clinicWithMember();
    fakeClerk.beforeWrite = () => {
      // What withTimeout throws when Clerk does not answer; askClerk wraps it as it would a real one.
      throw new TimeoutError("Clerk (changing a role)", 5_000);
    };
    const outcome = await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" });
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("we cannot be sure") });
    expect(outcome.ok === false && outcome.message).not.toContain("Nothing was changed");
    expect(vi.mocked(clinicsDb.setClinicOwner)).not.toHaveBeenCalled();
    expect(await ownerOf(clinicId)).toBeNull();
  });

  it("Clerk refusing the admin switch outright: nothing was changed", async () => {
    const { clinicId, member } = await clinicWithMember();
    fakeClerk.failNextWrites = 1;
    expect(await setOwnerByStaff({ clinicId, toUserId: member, staffName: "Evan Miller" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Nothing was changed"),
    });
    expect(await ownerOf(clinicId)).toBeNull();
  });
});
