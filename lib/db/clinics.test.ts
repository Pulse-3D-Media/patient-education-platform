import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { getClinicByClerkOrgId, linkClinicToClerkOrg } from "./clinics";

/**
 * The organization-to-clinic lookup, against the real test database.
 *
 * No Clerk here: lib/db never talks to Clerk. These tests make a clinic with
 * a made-up organization id, ask for it back, and clean up after themselves
 * by id. Everything else in the test database is left alone.
 */

/** A made-up organization id that can never clash with a real one. */
function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const linkedOrgId = fakeOrgId();
const createdClinicIds: string[] = [];

beforeAll(async () => {
  const clinic = await prisma.clinic.create({
    data: { name: "Vitest clinic (linked)", clerkOrgId: linkedOrgId },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("getClinicByClerkOrgId", () => {
  it("returns the clinic linked to a known organization id", async () => {
    const clinic = await getClinicByClerkOrgId(linkedOrgId);
    expect(clinic).not.toBeNull();
    expect(clinic?.id).toBe(createdClinicIds[0]);
    expect(clinic?.name).toBe("Vitest clinic (linked)");
  });

  it("returns null for an organization id nothing is linked to", async () => {
    const clinic = await getClinicByClerkOrgId(fakeOrgId());
    expect(clinic).toBeNull();
  });
});

describe("linkClinicToClerkOrg", () => {
  it("links a clinic so the lookup finds it afterwards", async () => {
    const unlinked = await prisma.clinic.create({
      data: { name: "Vitest clinic (unlinked)" },
      select: { id: true },
    });
    createdClinicIds.push(unlinked.id);

    const orgId = fakeOrgId();
    expect(await getClinicByClerkOrgId(orgId)).toBeNull();

    const linked = await linkClinicToClerkOrg(unlinked.id, orgId);
    expect(linked.clerkOrgId).toBe(orgId);

    const found = await getClinicByClerkOrgId(orgId);
    expect(found?.id).toBe(unlinked.id);
  });
});
