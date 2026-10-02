import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { listSeatHolds, listSeatNames, listSeatRows, reserveSeat } from "@/lib/db/seats";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import {
  giveSeatAction,
  handOffOwnerAction,
  inviteAction,
  releaseMySeatAction,
  removePersonAction,
  revokeInvitationAction,
  setAdminAction,
  setPatientNameAction,
} from "./actions";

/**
 * The Server Actions behind the People page, as each kind of person. Clerk
 * is a stand-in; the database is real (the testing branch).
 *
 * What the browser sends is a person, an invitation, an email and a role,
 * and nothing else is trusted: who is asking, which clinic they belong to,
 * whether they may do this, and whether the clinic is open all come from the
 * session and the database on the server.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The request's Host header, which only picks among the deployment's own addresses (lib/trusted-origin.ts).
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));
// A few round trips to the remote testing database per action.
vi.setConfig({ testTimeout: 30_000 });

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

/** A clinic whose owner is an admin, plus these other people. */
async function makeClinic(surgeonSeats: number, status: "ACTIVE" | "PENDING" | "PAUSED", others: Parameters<typeof fakeClerk.addOrg>[2] = []) {
  const orgId = `org_test_${id()}`;
  const owner = user();
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest people clinic ${id()}`, status, clerkOrgId: orgId, surgeonSeats, ownerClerkUserId: owner },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest people clinic", [{ userId: owner, role: "org:admin" }, ...(others ?? [])], owner);
  return { clinicId: clinic.id, orgId, owner };
}

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("who may use the People actions", () => {
  it("nobody signed out, and no plain member, can change anything", async () => {
    const [member, other] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(3, "ACTIVE", [{ userId: member }, { userId: other }]);

    for (const who of [null, member]) {
      fakeClerk.signIn(who, who ? orgId : null);
      // A member cannot switch admin on, for themselves or anyone else.
      expect((await setAdminAction(member, true)).error).toBe("Only your clinic's office admins can change this.");
      expect((await setAdminAction(other, true)).error).toBe("Only your clinic's office admins can change this.");
      expect((await inviteAction("new@example.test", "admin")).error).toBe("Only your clinic's office admins can change this.");
      expect((await removePersonAction(other)).error).toBe("Only your clinic's office admins can change this.");
      expect((await giveSeatAction(other)).error).toBe("Only your clinic's office admins can change this.");
      expect((await setPatientNameAction(other, "Someone Else, NP")).error).toBe("Only your clinic's office admins can change this.");
    }
    expect(fakeClerk.roleOf(orgId, member)).toBe("org:member");
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("nobody is invited, and nothing changed, before the clinic is paid for", async () => {
    for (const status of ["PENDING", "PAUSED"] as const) {
      const { clinicId, orgId, owner } = await makeClinic(3, status);
      fakeClerk.signIn(owner, orgId);
      expect((await inviteAction("new@example.test", "member")).error).toContain("Choose a plan on the Billing page first");
      expect(fakeClerk.invitations(orgId)).toEqual([]);
      expect(await listSeatHolds(clinicId)).toEqual([]);
    }
  });

  it("an admin of another clinic cannot reach this clinic's people, whatever id they send", async () => {
    const theirMember = user();
    const theirs = await makeClinic(3, "ACTIVE", [{ userId: theirMember }]);
    const mine = await makeClinic(3, "ACTIVE");
    fakeClerk.signIn(mine.owner, mine.orgId);

    expect((await setAdminAction(theirMember, true)).error).toBe("That person is not in your clinic.");
    expect((await removePersonAction(theirMember)).error).toBe("That person is not in your clinic.");
    expect((await giveSeatAction(theirMember)).error).toBe("That person is not in your clinic.");
    expect((await handOffOwnerAction(theirMember)).error).toBe("That person is not in your clinic.");
    await reserveSeat(theirs.clinicId, theirMember);
    expect((await setPatientNameAction(theirMember, "Forged Name")).error).toBe("That person is not in your clinic.");
    expect((await listSeatNames(theirs.clinicId)).map((seat) => seat.displayName)).toEqual([null]);
    await prisma.seatAllocation.deleteMany({ where: { clinicId: theirs.clinicId } });
    expect(fakeClerk.roleOf(theirs.orgId, theirMember)).toBe("org:member");
    expect(await listSeatRows(theirs.clinicId)).toEqual([]);
    expect(await listSeatRows(mine.clinicId)).toEqual([]);
  });

  it("refuses a value that is not true or false for admin", async () => {
    const dr = user();
    const { orgId, owner } = await makeClinic(3, "ACTIVE", [{ userId: dr }]);
    fakeClerk.signIn(owner, orgId);
    expect((await setAdminAction(dr, "yes")).error).toBe("Choose Member or Member with admin.");
    expect(fakeClerk.roleOf(orgId, dr)).toBe("org:member");
  });
});

describe("what an admin can do", () => {
  it("invite, then revoke, and the seat comes back", async () => {
    const { clinicId, orgId, owner } = await makeClinic(1, "ACTIVE");
    fakeClerk.signIn(owner, orgId);

    expect(await inviteAction("new@example.test", "member")).toMatchObject({ message: expect.stringContaining("Invitation sent to new@example.test") });
    // The email's link comes back to our own sign-up page, not Clerk's hosted pages.
    expect(fakeClerk.invitations(orgId)[0].redirectUrl).toBe("http://localhost:3000/sign-up");
    expect((await inviteAction("another@example.test", "member")).error).toContain("All 1 seat is taken");

    expect(await revokeInvitationAction(fakeClerk.invitations(orgId)[0].id)).toEqual({ message: "Invitation revoked." });
    expect(await listSeatHolds(clinicId)).toEqual([]);
    expect(await inviteAction("another@example.test", "member")).toMatchObject({ message: expect.any(String) });
  });

  it("switch admin on and off for a member, and give a waiting person a free seat", async () => {
    const dr = user();
    const { clinicId, orgId, owner } = await makeClinic(1, "ACTIVE", [{ userId: dr }]);
    fakeClerk.signIn(owner, orgId);

    expect(await setAdminAction(dr, true)).toEqual({});
    expect(fakeClerk.roleOf(orgId, dr)).toBe("org:admin");
    expect(await setAdminAction(dr, false)).toEqual({});
    expect(await giveSeatAction(dr)).toEqual({});
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([dr]);
  });

  it("set the name patients see for someone holding a seat, and keep a refused name out with a plain sentence", async () => {
    const dr = user();
    const { clinicId, orgId, owner } = await makeClinic(2, "ACTIVE", [{ userId: dr, firstName: "Jane", lastName: "Smith" }]);
    await reserveSeat(clinicId, dr);
    fakeClerk.signIn(owner, orgId);

    expect(await setPatientNameAction(dr, "Jane Smith, PA-C")).toEqual({ message: `Patients will see "Jane Smith, PA-C" on links from Jane Smith from now on.` });
    expect((await setPatientNameAction(dr, "<script>")).error).toContain("letters");
    expect((await setPatientNameAction(dr, 42)).error).toBe("Type the name as patients should see it.");
    expect((await listSeatNames(clinicId)).map((seat) => seat.displayName)).toEqual(["Jane Smith, PA-C"]);
  });

  it("the owner cannot be removed or made a plain member, by another admin either", async () => {
    const other = user();
    const { orgId, owner } = await makeClinic(2, "ACTIVE", [{ userId: other, role: "org:admin" }]);
    fakeClerk.signIn(other, orgId);

    expect((await removePersonAction(owner)).error).toContain("cannot be removed");
    expect((await setAdminAction(owner, false)).error).toContain("always has admin");
    expect(fakeClerk.isMember(orgId, owner)).toBe(true);
    expect(fakeClerk.roleOf(orgId, owner)).toBe("org:admin");
  });

  it("only the owner can hand the account over, or give up their own seat", async () => {
    const other = user();
    const { clinicId, orgId, owner } = await makeClinic(2, "ACTIVE", [{ userId: other, role: "org:admin" }]);

    fakeClerk.signIn(other, orgId);
    expect((await handOffOwnerAction(other)).error).toContain("Only the account owner");
    expect((await releaseMySeatAction()).error).toContain("Only the account owner can go without a seat");

    fakeClerk.signIn(owner, orgId);
    expect(await giveSeatAction(owner)).toEqual({});
    expect(await releaseMySeatAction()).toEqual({});
    expect(await handOffOwnerAction(other)).toMatchObject({ message: expect.stringContaining("is now the account owner") });
    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId).toBe(other);
  });

  it("answers a failure in a plain sentence, with nothing changed", async () => {
    const dr = user();
    const { clinicId, orgId, owner } = await makeClinic(2, "ACTIVE", [{ userId: dr }]);
    await reserveSeat(clinicId, dr);
    fakeClerk.signIn(owner, orgId);
    fakeClerk.failNextWrites = 1;

    expect((await removePersonAction(dr)).error).toBe("That could not be saved just now. Nothing was changed. Try again in a moment.");
    expect(fakeClerk.isMember(orgId, dr)).toBe(true);
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([dr]);
  });
});
