import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getActivePricing } from "@/lib/db/pricing";
import { quote } from "@/lib/pricing";
import { getBillingView } from "./billing";

/**
 * What /admin/billing is given for one clinic, against the real test
 * database. The amounts are checked against the pricing engine itself with
 * whatever prices are active in the test database, so the test does not
 * assume the built-in defaults. Every row is made here and removed by id.
 */

const createdClinicIds: string[] = [];
const createdVersionIds: string[] = [];

async function makeClinic(data: Partial<Parameters<typeof prisma.clinic.create>[0]["data"]> = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest billing clinic ${randomBytes(4).toString("hex")}`, ...data },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

afterAll(async () => {
  // Clinics first: a clinic pinned to a version stops that version being deleted.
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.pricingVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  await prisma.$disconnect();
});

describe("getBillingView", () => {
  it("is null for an unknown clinic", async () => {
    expect(await getBillingView("clinic_that_does_not_exist")).toBeNull();
  });

  it("shows a PENDING clinic its plan and an estimate from the engine, the same as any other status", async () => {
    const clinicId = await makeClinic({ status: "PENDING", categories: ["KNEE", "HIP"], surgeonSeats: 3 });
    const view = await getBillingView(clinicId);
    expect(view?.hasPlan).toBe(true);
    expect(view?.plan).toEqual({ categories: ["KNEE", "HIP"], surgeonSeats: 3, managedByPulse: false });
    expect(view?.problem).toBeNull();

    // The same numbers the engine gives for that plan, from the prices the server is using right now.
    const { config, source } = await getActivePricing();
    const expected = (interval: "month" | "year") =>
      quote(config, { seats: 3, categories: ["KNEE", "HIP"], interval, founding: false, practiceType: "clinic", sellable: ["KNEE", "HIP"] });
    const month = expected("month");
    const year = expected("year");
    if (!month.ok || !year.ok) throw new Error("the engine refused a plain two-category plan");
    expect(view?.estimate).toMatchObject({
      band: "clinic",
      monthlyCents: month.quote.amounts?.totalCents,
      yearlyCents: year.quote.amounts?.totalCents,
      fromDefaults: source.kind === "estimate",
    });
    expect(view?.estimate?.monthlyCents).toBeGreaterThan(0);
  });

  it("has no estimate, and no problem, for a clinic with no plan yet", async () => {
    const clinicId = await makeClinic();
    expect(await getBillingView(clinicId)).toEqual({
      plan: { categories: [], surgeonSeats: 0, managedByPulse: false },
      hasPlan: false,
      estimate: null,
      problem: null,
    });
  });

  it("carries the managed-by-Pulse flag through", async () => {
    const clinicId = await makeClinic({ managedByPulse: true, categories: ["SPINE"], surgeonSeats: 1 });
    const view = await getBillingView(clinicId);
    expect(view?.plan.managedByPulse).toBe(true);
    expect(view?.estimate?.band).toBe("solo");
  });

  it("reports Enterprise with no amount when the seats are above the self-serve limit", async () => {
    const { config } = await getActivePricing();
    const clinicId = await makeClinic({ categories: ["KNEE"], surgeonSeats: config.seats.clinicMax + 1 });
    const view = await getBillingView(clinicId);
    expect(view?.estimate).toMatchObject({ band: "enterprise", monthlyCents: null, yearlyCents: null });
  });

  it("turns a damaged pinned pricing version into a plain problem, not a crash", async () => {
    const version = await prisma.pricingVersion.create({
      data: { config: { currency: "usd", perSeatByCountCents: "not a ladder" }, note: "Vitest damaged version", createdBy: "user_vitest", createdByName: "Vitest" },
      select: { id: true },
    });
    createdVersionIds.push(version.id);
    const clinicId = await makeClinic({ categories: ["KNEE"], surgeonSeats: 2, pricingVersionId: version.id });

    const view = await getBillingView(clinicId);
    expect(view?.hasPlan).toBe(true);
    expect(view?.estimate).toBeNull();
    expect(view?.problem).toMatch(/could not work out an estimate/);
  });
});
