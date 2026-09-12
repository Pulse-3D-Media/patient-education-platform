import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import { PricingError, getActivePricing, getPricingForClinic } from "./pricing";

/**
 * getActivePricing() on an installation that has never saved a version,
 * and on one whose active row has been damaged, against a stand-in for
 * the table.
 *
 * Why not the real test database like lib/db/pricing.test.ts: "no version
 * is active" is a state of the whole table, and the shared testing
 * database may well have an active row from earlier runs. A test cannot
 * clear that without touching rows it did not make. So the Prisma client
 * is replaced with a tiny in-memory table for these two cases.
 */

type Row = { id: string; version: number; config: unknown; note: string; createdAt: Date; createdBy: string; createdByName: string; active: boolean | null };

const table = vi.hoisted(() => ({ rows: [] as Row[], clinics: [] as { id: string; pricingVersionId: string | null }[] }));

vi.mock("./client", () => ({
  prisma: {
    pricingVersion: {
      findFirst: async ({ where }: { where: { active?: boolean } }) =>
        table.rows.find((row) => where.active === undefined || row.active === where.active) ?? null,
    },
    clinic: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const clinic = table.clinics.find((row) => row.id === where.id);
        if (!clinic) return null;
        return {
          id: clinic.id,
          pricingVersionId: clinic.pricingVersionId,
          pricingVersion: table.rows.find((row) => row.id === clinic.pricingVersionId) ?? null,
        };
      },
    },
  },
}));

beforeEach(() => {
  table.rows = [];
  table.clinics = [];
});

describe("an installation with no active version", () => {
  it("quotes from the built-in defaults and says so", async () => {
    expect(await getActivePricing()).toEqual({ source: { kind: "estimate" }, config: DEFAULT_PRICING_CONFIG });
  });

  it("gives an unpinned clinic the same estimate", async () => {
    table.clinics.push({ id: "clinic_1", pricingVersionId: null });
    expect(await getPricingForClinic("clinic_1")).toEqual({ source: { kind: "estimate" }, config: DEFAULT_PRICING_CONFIG });
  });
});

describe("a damaged active version", () => {
  it("is a loud failure, never a quiet fall back to the defaults", async () => {
    table.rows.push({
      id: "v_bad",
      version: 4,
      config: { currency: "usd" },
      note: "hand edited",
      createdAt: new Date(),
      createdBy: "user_x",
      createdByName: "Someone",
      active: true,
    });
    await expect(getActivePricing()).rejects.toThrow(PricingError);
    await expect(getActivePricing()).rejects.toThrow("pricing version 4");
  });

  it("is reported for a pin that points at a version the table does not hold", async () => {
    table.clinics.push({ id: "clinic_2", pricingVersionId: "v_gone" });
    await expect(getPricingForClinic("clinic_2")).rejects.toThrow(PricingError);
    await expect(getPricingForClinic("clinic_2")).rejects.toThrow("v_gone");
  });
});
