import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db/client";
import { decideSeedClinic, findSeedClinic, seedClinicLines } from "./seed-clinic";

/**
 * How `npm run db:seed` finds the test clinic (audit run 2, lead 14).
 *
 * A clinic's name is copied from its Clerk organization, and anyone who can
 * make an organization can give it any name, the test clinic's included. So
 * the name alone cannot say which row is the test clinic. The seed now:
 * prints which organization the row it found belongs to (or that it belongs
 * to none), and refuses, listing every row, when more than one has the name.
 *
 * The database cases run against the test database with a made-up name no
 * other row has, and delete only the rows they made, by id. No db: script
 * is run.
 */

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

function dummyName() {
  return `Vitest seed ${randomBytes(6).toString("hex")}`;
}

const madeIds: string[] = [];

async function makeClinic(name: string, clerkOrgId: string | null) {
  const clinic = await prisma.clinic.create({ data: { name, clerkOrgId }, select: { id: true } });
  madeIds.push(clinic.id);
  return clinic.id;
}

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: madeIds } } });
});

describe("decideSeedClinic (plain values)", () => {
  it("says to create the clinic when no row has the name", () => {
    expect(decideSeedClinic([])).toEqual({ kind: "none" });
  });

  it("hands back the one row, with its organization, when exactly one has the name", () => {
    const row = { id: "clinic_1", clerkOrgId: "org_abc" };
    expect(decideSeedClinic([row])).toEqual({ kind: "one", clinic: row });
  });

  it("refuses when more than one row has the name, listing every one", () => {
    const rows = [
      { id: "clinic_1", clerkOrgId: "org_abc" },
      { id: "clinic_2", clerkOrgId: null },
    ];
    expect(decideSeedClinic(rows)).toEqual({ kind: "several", clinics: rows });
  });
});

describe("seedClinicLines (what the operator reads)", () => {
  it("names the organization a linked row belongs to", () => {
    const text = seedClinicLines("Pulse 3D Test Clinic", { kind: "one", clinic: { id: "clinic_1", clerkOrgId: "org_abc" } }).join("\n");
    expect(text).toContain("clinic_1");
    expect(text).toContain("org_abc");
  });

  it("says plainly when the row is linked to no organization", () => {
    const text = seedClinicLines("Pulse 3D Test Clinic", { kind: "one", clinic: { id: "clinic_1", clerkOrgId: null } }).join("\n");
    expect(text).toContain("clinic_1");
    expect(text).toMatch(/not linked to any organization/i);
  });

  it("lists every row and its organization when it refuses, and offers no single id to use", () => {
    const lines = seedClinicLines("Pulse 3D Test Clinic", {
      kind: "several",
      clinics: [
        { id: "clinic_1", clerkOrgId: "org_abc" },
        { id: "clinic_2", clerkOrgId: null },
      ],
    });
    const text = lines.join("\n");
    expect(text).toContain("clinic_1");
    expect(text).toContain("org_abc");
    expect(text).toContain("clinic_2");
    expect(text).toMatch(/2 clinics/);
    expect(text).not.toMatch(/^Clinic id:/m);
  });
});

describe("findSeedClinic (against the test database)", () => {
  it("finds nothing for a name no row has, so the seed creates one", async () => {
    expect(await findSeedClinic(dummyName())).toEqual({ kind: "none" });
  });

  it("returns a single linked row together with the organization it belongs to", async () => {
    const name = dummyName();
    const orgId = fakeOrgId();
    const id = await makeClinic(name, orgId);
    expect(await findSeedClinic(name)).toEqual({ kind: "one", clinic: { id, clerkOrgId: orgId } });
  });

  it("returns a single unlinked row marked as linked to nothing", async () => {
    const name = dummyName();
    const id = await makeClinic(name, null);
    expect(await findSeedClinic(name)).toEqual({ kind: "one", clinic: { id, clerkOrgId: null } });
  });

  it("refuses a linked and an unlinked row with the same name, in either order of creation", async () => {
    for (const order of [["linked", "unlinked"], ["unlinked", "linked"]] as const) {
      const name = dummyName();
      const ids: string[] = [];
      for (const kind of order) ids.push(await makeClinic(name, kind === "linked" ? fakeOrgId() : null));
      const result = await findSeedClinic(name);
      expect(result.kind).toBe("several");
      if (result.kind === "several") expect(result.clinics.map((clinic) => clinic.id).sort()).toEqual([...ids].sort());
    }
  });

  it("matches the name exactly: a different case or extra spaces is another name", async () => {
    const name = dummyName();
    await makeClinic(name, null);
    expect(await findSeedClinic(name.toUpperCase())).toEqual({ kind: "none" });
    expect(await findSeedClinic(` ${name}`)).toEqual({ kind: "none" });
  });
});
