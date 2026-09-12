import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG, type PricingConfig } from "../pricing";
import { prisma } from "./client";
import {
  PricingError,
  activatePricingVersion,
  createPricingVersion,
  getActivePricing,
  getPricingForClinic,
  getPricingVersion,
  listPricingVersions,
} from "./pricing";

/**
 * The version store, against the real test database.
 *
 * Every version and clinic here is made by the tests and deleted by id
 * afterwards. One thing is unavoidably shared: there is a single active
 * version in the whole table, and activating one of ours takes the mark
 * off whichever row had it. So the version that was active when the file
 * started is remembered and made active again at the end. (The testing
 * database is only ever used by tests, so nothing depends on it in
 * between.)
 */

const STAFF = { userId: "user_vitest_pricing", name: "Vitest Staff" };

const createdVersionIds: string[] = [];
const createdClinicIds: string[] = [];
let activeBefore: string | null = null;

/** A config that is the defaults with one recognisable price, so versions can be told apart. */
function configWithKneeAt(cents: number): PricingConfig {
  return { ...DEFAULT_PRICING_CONFIG, perSeatCents: { ...DEFAULT_PRICING_CONFIG.perSeatCents, KNEE: cents } };
}

async function makeVersion(config: PricingConfig, note = "Vitest version") {
  const row = await createPricingVersion(config, note, STAFF);
  createdVersionIds.push(row.id);
  return row;
}

/** A row written straight into the table with a config that is not a config, the way a hand edit could leave it. */
async function makeCorruptVersion() {
  const row = await prisma.pricingVersion.create({
    data: { config: { nope: true }, note: "Vitest corrupt version", createdBy: STAFF.userId, createdByName: STAFF.name },
    select: { id: true, version: true },
  });
  createdVersionIds.push(row.id);
  return row;
}

async function makeClinic(pricingVersionId: string | null) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest pricing clinic ${randomBytes(4).toString("hex")}`, pricingVersionId },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

/** The id of the one active row, or null. Straight from the table, not through the code under test. */
async function activeIdInTable() {
  const rows = await prisma.pricingVersion.findMany({ where: { active: true }, select: { id: true } });
  expect(rows.length).toBeLessThanOrEqual(1);
  return rows[0]?.id ?? null;
}

beforeAll(async () => {
  activeBefore = await activeIdInTable();
});

afterAll(async () => {
  // Clinics first: a clinic pinned to a version stops that version being deleted.
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  // Put the mark back where it was before the file ran, then remove our rows.
  await prisma.pricingVersion.updateMany({ where: { active: true }, data: { active: null } });
  if (activeBefore) {
    await prisma.pricingVersion.updateMany({ where: { id: activeBefore }, data: { active: true } });
  }
  await prisma.pricingVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  await prisma.$disconnect();
});

describe("createPricingVersion", () => {
  it("saves a checked config with the next number, not active, under the staff member's name", async () => {
    const config = configWithKneeAt(6100);
    const row = await makeVersion(config, "  Knee up to $61  ");

    expect(row.version).toBeGreaterThan(0);
    expect(row.config).toEqual(config);
    expect(row.problem).toBeNull();
    expect(row.active).toBe(false);
    expect(row.note).toBe("Knee up to $61");
    expect(row.createdBy).toBe(STAFF.userId);
    expect(row.createdByName).toBe(STAFF.name);
    expect(row.createdAt).toBeInstanceOf(Date);

    expect(await getPricingVersion(row.id)).toEqual(row);
  });

  it("refuses an invalid config and a missing note, and writes nothing", async () => {
    const countBefore = await prisma.pricingVersion.count();
    await expect(createPricingVersion({ ...DEFAULT_PRICING_CONFIG, currency: "eur" }, "Euros", STAFF)).rejects.toBeInstanceOf(PricingError);
    await expect(createPricingVersion(DEFAULT_PRICING_CONFIG, "   ", STAFF)).rejects.toThrow(/note/);
    expect(await prisma.pricingVersion.count()).toBe(countBefore);
  });

  it("gives three versions saved at the same moment three different, increasing numbers", async () => {
    const rows = await Promise.all([6201, 6202, 6203].map((cents) => makeVersion(configWithKneeAt(cents))));
    const numbers = rows.map((row) => row.version);
    expect(new Set(numbers).size).toBe(3);
    expect(Math.max(...numbers) - Math.min(...numbers)).toBeGreaterThanOrEqual(2);
  });

  it("never rewrites an earlier version: saving again is a new row and the old one is unchanged", async () => {
    const first = await makeVersion(configWithKneeAt(6300));
    const second = await makeVersion(configWithKneeAt(6400));
    expect(second.id).not.toBe(first.id);
    expect(second.version).toBeGreaterThan(first.version);
    expect((await getPricingVersion(first.id))?.config?.perSeatCents.KNEE).toBe(6300);
  });
});

describe("activatePricingVersion", () => {
  it("leaves exactly one active version, ours", async () => {
    const a = await makeVersion(configWithKneeAt(6500));
    const b = await makeVersion(configWithKneeAt(6600));

    const activated = await activatePricingVersion(a.id);
    expect(activated.active).toBe(true);
    expect(await activeIdInTable()).toBe(a.id);

    await activatePricingVersion(b.id);
    expect(await activeIdInTable()).toBe(b.id);
    expect((await getPricingVersion(a.id))?.active).toBe(false);
  });

  it("refuses a version whose stored config is invalid, and the active one stays active", async () => {
    const good = await makeVersion(configWithKneeAt(6700));
    await activatePricingVersion(good.id);
    const corrupt = await makeCorruptVersion();

    await expect(activatePricingVersion(corrupt.id)).rejects.toThrow(PricingError);
    await expect(activatePricingVersion(corrupt.id)).rejects.toThrow(`pricing version ${corrupt.version}`);
    expect(await activeIdInTable()).toBe(good.id);

    // The history still lists the corrupt row, marked, rather than breaking.
    const listed = (await listPricingVersions()).find((row) => row.id === corrupt.id);
    expect(listed?.config).toBeNull();
    expect(listed?.problem).toContain("perSeatCents");
  });

  it("refuses an unknown id", async () => {
    await expect(activatePricingVersion("nope")).rejects.toThrow(PricingError);
  });

  it("ends with exactly one active version when two activations run at the same moment", async () => {
    for (let round = 0; round < 3; round++) {
      const x = await makeVersion(configWithKneeAt(7000 + round));
      const y = await makeVersion(configWithKneeAt(7100 + round));

      const results = await Promise.allSettled([activatePricingVersion(x.id), activatePricingVersion(y.id)]);
      for (const result of results) expect(result.status, `round ${round}`).toBe("fulfilled");

      const active = await activeIdInTable();
      expect([x.id, y.id], `round ${round}`).toContain(active);
    }
  });
});

describe("getActivePricing and getPricingForClinic", () => {
  it("quotes from the active version, and a clinic with no pin gets the same", async () => {
    const version = await makeVersion(configWithKneeAt(7500), "Knee at $75");
    await activatePricingVersion(version.id);
    const clinicId = await makeClinic(null);

    const active = await getActivePricing();
    expect(active.source).toEqual({ kind: "version", version: expect.objectContaining({ id: version.id, active: true }), pinned: false });
    expect(active.config.perSeatCents.KNEE).toBe(7500);

    expect(await getPricingForClinic(clinicId)).toEqual(active);
  });

  it("uses the clinic's pin, and activating a newer version leaves the pin where it was", async () => {
    const pinned = await makeVersion(configWithKneeAt(8000), "Pinned prices");
    const clinicId = await makeClinic(pinned.id);
    const newer = await makeVersion(configWithKneeAt(9000), "Newer prices");
    await activatePricingVersion(newer.id);

    const pricing = await getPricingForClinic(clinicId);
    expect(pricing.source).toEqual({ kind: "version", version: expect.objectContaining({ id: pinned.id, active: false }), pinned: true });
    expect(pricing.config.perSeatCents.KNEE).toBe(8000);
    expect((await getActivePricing()).config.perSeatCents.KNEE).toBe(9000);

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { pricingVersionId: true } });
    expect(clinic?.pricingVersionId).toBe(pinned.id);
  });

  it("fails loudly, naming the clinic and the version, when the pinned config is corrupt", async () => {
    const corrupt = await makeCorruptVersion();
    const clinicId = await makeClinic(corrupt.id);

    await expect(getPricingForClinic(clinicId)).rejects.toThrow(PricingError);
    await expect(getPricingForClinic(clinicId)).rejects.toThrow(clinicId);
    await expect(getPricingForClinic(clinicId)).rejects.toThrow(`pricing version ${corrupt.version}`);
  });

  it("fails loudly for a clinic that does not exist", async () => {
    await expect(getPricingForClinic("no-such-clinic")).rejects.toThrow(PricingError);
  });

  it("will not let a pinned version be deleted", async () => {
    const pinned = await makeVersion(configWithKneeAt(8100));
    await makeClinic(pinned.id);
    await expect(prisma.pricingVersion.delete({ where: { id: pinned.id } })).rejects.toThrow();
    expect(await getPricingVersion(pinned.id)).not.toBeNull();
  });
});
