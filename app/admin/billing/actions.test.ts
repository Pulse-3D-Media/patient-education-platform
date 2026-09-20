import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { answerPracticeTypeAction } from "./actions";

/**
 * The one Server Action on /admin/billing, with Clerk replaced by a
 * stand-in and the database real (the Neon testing branch).
 *
 * At the permission boundary: signed out and a member are refused; an admin
 * may answer, for their own clinic only (a clinic id forged into the form is
 * never read), and may answer even when the clinic is NOT open, because
 * Billing is where a closed clinic's admin comes. At the edge: only the two
 * answers are accepted, and only while the question is still unanswered.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function signInAs(orgId: string | null, role: "admin" | "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: orgId ? "user_vitest" : null,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ firstName: "Jane", lastName: "Smith", emailAddresses: [] }) },
  } as never);
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const createdClinicIds: string[] = [];

/** A clinic linked to a made-up organization. PENDING (closed) unless told otherwise. */
async function makeClinic(status: "PENDING" | "ACTIVE" | "PAST_DUE" = "PENDING") {
  const orgId = `org_test_${randomBytes(8).toString("hex")}`;
  const clinic = await prisma.clinic.create({ data: { name: `Vitest billing page ${randomBytes(3).toString("hex")}`, clerkOrgId: orgId, status }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return { clinicId: clinic.id, orgId };
}

const typeOf = async (clinicId: string) => (await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { practiceType: true } })).practiceType;

beforeEach(() => vi.resetAllMocks());

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("answerPracticeTypeAction", () => {
  it("refuses someone signed out, and a member, and writes nothing", async () => {
    const { clinicId, orgId } = await makeClinic();

    signInAs(null, "member");
    expect(await answerPracticeTypeAction(null, form({ practiceType: "CLINIC" }))).toMatchObject({ error: expect.any(String) });
    signInAs(orgId, "member");
    expect(await answerPracticeTypeAction(null, form({ practiceType: "CLINIC" }))).toMatchObject({ error: expect.any(String) });

    expect(await typeOf(clinicId)).toBe("UNKNOWN");
  });

  it("lets an admin answer for a clinic that is NOT open, and logs it under their name", async () => {
    const { clinicId, orgId } = await makeClinic("PENDING");
    signInAs(orgId, "admin");

    expect(await answerPracticeTypeAction(null, form({ practiceType: "CLINIC" }))).toEqual({ ok: "Saved. Thank you." });

    expect(await typeOf(clinicId)).toBe("CLINIC");
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { body: true, authorName: true } });
    expect(notes).toEqual([{ body: 'Practice type changed from "Not answered yet" to "Clinic or private practice".', authorName: "Jane Smith (clinic admin)" }]);
  });

  it("is asked once: a second answer is refused, so a hospital cannot answer again to become a clinic", async () => {
    const { clinicId, orgId } = await makeClinic("ACTIVE");
    signInAs(orgId, "admin");
    await answerPracticeTypeAction(null, form({ practiceType: "HOSPITAL" }));

    const again = await answerPracticeTypeAction(null, form({ practiceType: "CLINIC" }));

    expect(again).toMatchObject({ error: expect.stringContaining("already been answered") });
    expect(await typeOf(clinicId)).toBe("HOSPITAL");
  });

  it("two admins answering at the same moment: one answer stands, and it is logged once", async () => {
    const { clinicId, orgId } = await makeClinic();
    signInAs(orgId, "admin");

    const results = await Promise.all([
      answerPracticeTypeAction(null, form({ practiceType: "CLINIC" })),
      answerPracticeTypeAction(null, form({ practiceType: "HOSPITAL" })),
    ]);

    expect(results.filter((result) => result?.ok)).toHaveLength(1);
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(1);
    expect(["CLINIC", "HOSPITAL"]).toContain(await typeOf(clinicId));
  });

  it("accepts only the two answers: not UNKNOWN, not a made-up word", async () => {
    const { clinicId, orgId } = await makeClinic();
    signInAs(orgId, "admin");
    for (const practiceType of ["UNKNOWN", "", "clinic", "ENTERPRISE", "constructor"]) {
      expect(await answerPracticeTypeAction(null, form({ practiceType }))).toMatchObject({ error: expect.any(String) });
    }
    expect(await typeOf(clinicId)).toBe("UNKNOWN");
  });

  it("never reads a clinic id from the form: an admin of one clinic cannot answer for another", async () => {
    const target = await makeClinic();
    const own = await makeClinic();
    signInAs(own.orgId, "admin");

    await answerPracticeTypeAction(null, form({ practiceType: "HOSPITAL", clinicId: target.clinicId }));

    expect(await typeOf(target.clinicId)).toBe("UNKNOWN");
    expect(await typeOf(own.clinicId)).toBe("HOSPITAL");
  });
});
