import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { listClinicsForPulse } from "@/lib/db/clinics";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { setOwnerAction } from "./actions";

/**
 * "Make account owner" on a clinic's /pulse page: the backup for an owner who
 * left without handing over, or a clinic made before owners existed. Clerk
 * is the in-memory stand-in (it needs organizations, which the stand-in in
 * actions.test.ts does not have); the database is real (the testing branch).
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.setConfig({ testTimeout: 30_000 });

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;
const STAFF = "user_vitest_pulse_staff";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

async function makeClinic(members: Parameters<typeof fakeClerk.addOrg>[2]) {
  const orgId = `org_test_${id()}`;
  const clinic = await prisma.clinic.create({ data: { name: `Vitest owner clinic ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats: 2 }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest owner clinic", members);
  return { clinicId: clinic.id, orgId };
}

const ownerOf = async (clinicId: string) => (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId;

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("setOwnerAction", () => {
  it("refuses anyone who is not Pulse staff with not-found, the clinic's own admin included, and writes nothing", async () => {
    const admin = user();
    const { clinicId, orgId } = await makeClinic([{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, orgId);

    await expect(setOwnerAction(null, form({ clinicId, ownerUserId: admin }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await ownerOf(clinicId)).toBeNull();
  });

  it("lets Pulse staff make a current member the owner, and the /pulse table stops flagging it", async () => {
    const member = user();
    const { clinicId, orgId } = await makeClinic([{ userId: member, firstName: "Mo", lastName: "Member" }]);
    const flagged = async () => (await listClinicsForPulse({ query: "Vitest owner clinic" })).find((row) => row.id === clinicId)?.hasOwner;
    expect(await flagged()).toBe(false);
    fakeClerk.signIn(STAFF, null);

    expect(await setOwnerAction(null, form({ clinicId, ownerUserId: member }))).toEqual({ ok: "Mo Member is now the account owner." });
    expect(await ownerOf(clinicId)).toBe(member);
    expect(fakeClerk.roleOf(orgId, member)).toBe("org:admin");
    expect(await flagged()).toBe(true);
  });

  it("refuses someone who is not in that clinic, and a missing choice", async () => {
    const outsider = user();
    const { clinicId } = await makeClinic([{ userId: user() }]);
    await makeClinic([{ userId: outsider }]);
    fakeClerk.signIn(STAFF, null);

    expect(await setOwnerAction(null, form({ clinicId, ownerUserId: outsider }))).toEqual({ error: "That person is not a member of this clinic." });
    expect(await setOwnerAction(null, form({ clinicId, ownerUserId: "" }))).toEqual({ error: "Choose a person." });
    expect(await setOwnerAction(null, form({ clinicId: "no-such-clinic", ownerUserId: outsider }))).toEqual({ error: "That clinic no longer exists." });
    expect(await ownerOf(clinicId)).toBeNull();
  });
});
