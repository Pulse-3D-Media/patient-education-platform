import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { listSeatRows } from "@/lib/db/seats";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { setKindAction } from "./actions";

/**
 * The Server Action behind the Surgeon / Staff control, as each kind of
 * person. Clerk is a stand-in; the database is real (the testing branch).
 *
 * What the browser sends is a user id and a kind, and nothing else is
 * trusted: who is asking, which clinic they belong to and whether they may
 * do this all come from the session on the server.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

async function makeClinic(surgeonSeats: number, status: "ACTIVE" | "PENDING" | "PAUSED", members: Parameters<typeof fakeClerk.addOrg>[2]) {
  const orgId = `org_test_${id()}`;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest people clinic ${id()}`, status, clerkOrgId: orgId, surgeonSeats },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest people clinic", members);
  return { clinicId: clinic.id, orgId };
}

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("setKindAction", () => {
  it("an admin marks a member as a surgeon, within the clinic's seats", async () => {
    const [admin, dr] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, "ACTIVE", [{ userId: admin, role: "org:admin" }, { userId: dr }]);
    fakeClerk.signIn(admin, orgId);

    expect(await setKindAction(dr, "surgeon")).toEqual({});
    expect(fakeClerk.kindOf(orgId, dr)).toBe("surgeon");
    expect(await listSeatRows(clinicId)).toMatchObject([{ clerkUserId: dr, syncState: "SYNCED" }]);
  });

  it("an admin is told plainly when every seat is taken, and the person is not relabelled", async () => {
    const [admin, a, b] = [user(), user(), user()];
    const { clinicId, orgId } = await makeClinic(1, "ACTIVE", [{ userId: admin, role: "org:admin" }, { userId: a }, { userId: b }]);
    fakeClerk.signIn(admin, orgId);
    await setKindAction(a, "surgeon");

    const result = await setKindAction(b, "surgeon");

    expect(result.error).toContain("All 1 surgeon seat is in use");
    expect(fakeClerk.kindOf(orgId, b)).toBeUndefined();
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("an admin may mark themselves, and that goes through the limit too", async () => {
    const [admin, dr] = [user(), user()];
    const { orgId } = await makeClinic(1, "ACTIVE", [{ userId: admin, role: "org:admin" }, { userId: dr }]);
    fakeClerk.signIn(admin, orgId);
    await setKindAction(dr, "surgeon");

    expect((await setKindAction(admin, "surgeon")).error).toContain("in use"); // being an admin is a permission, not a seat
    expect(await setKindAction(admin, "staff")).toEqual({});
  });

  it("a member is refused before anything is read or written", async () => {
    const [member, dr] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(3, "ACTIVE", [{ userId: member }, { userId: dr }]);
    fakeClerk.signIn(member, orgId);

    expect((await setKindAction(dr, "surgeon")).error).toContain("Only your clinic's office admins");
    expect((await setKindAction(member, "surgeon")).error).toContain("Only your clinic's office admins"); // not even about themselves
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("someone signed out is refused", async () => {
    const dr = user();
    const { clinicId } = await makeClinic(3, "ACTIVE", [{ userId: dr }]);
    fakeClerk.signIn(null, null);

    expect((await setKindAction(dr, "surgeon")).error).toBeTruthy();
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("an admin of one clinic cannot change a person in another, whatever user id they send", async () => {
    const [adminA, drB] = [user(), user()];
    const a = await makeClinic(3, "ACTIVE", [{ userId: adminA, role: "org:admin" }]);
    const b = await makeClinic(3, "ACTIVE", [{ userId: drB, kind: "staff" }]);
    fakeClerk.signIn(adminA, a.orgId);

    const result = await setKindAction(drB, "surgeon");

    expect(result.error).toBe("That person is not in your clinic.");
    expect(fakeClerk.kindOf(b.orgId, drB)).toBe("staff"); // untouched
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(a.clinicId)).toEqual([]);
    expect(await listSeatRows(b.clinicId)).toEqual([]);
  });

  it("an admin of a clinic that is not open cannot change kinds", async () => {
    const [admin, dr] = [user(), user()];
    for (const status of ["PENDING", "PAUSED"] as const) {
      const { clinicId, orgId } = await makeClinic(3, status, [{ userId: admin, role: "org:admin" }, { userId: dr }]);
      fakeClerk.signIn(admin, orgId);
      expect((await setKindAction(dr, "surgeon")).error).toContain("not open");
      expect(await listSeatRows(clinicId)).toEqual([]);
    }
  });

  it("refuses a kind it does not know, and a missing person", async () => {
    const admin = user();
    const { orgId } = await makeClinic(3, "ACTIVE", [{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, orgId);

    expect((await setKindAction(admin, "owner")).error).toBe("Choose Surgeon or Staff.");
    expect((await setKindAction(admin, { kind: "surgeon" })).error).toBe("Choose Surgeon or Staff.");
    expect((await setKindAction("", "surgeon")).error).toBe("No person was selected.");
    expect((await setKindAction(42, "surgeon")).error).toBe("No person was selected.");
    expect(fakeClerk.writes).toEqual([]);
  });

  it("when Clerk fails, the admin sees a plain sentence and no seat is left held", async () => {
    const [admin, dr] = [user(), user()];
    const { clinicId, orgId } = await makeClinic(1, "ACTIVE", [{ userId: admin, role: "org:admin" }, { userId: dr }]);
    fakeClerk.signIn(admin, orgId);
    fakeClerk.failNextWrites = 1;

    const result = await setKindAction(dr, "surgeon");

    expect(result.error).toBe("That could not be saved just now. Nothing was changed. Try again in a moment.");
    expect(await listSeatRows(clinicId)).toEqual([]);
    expect(await setKindAction(dr, "surgeon")).toEqual({}); // and trying again works
  });
});
