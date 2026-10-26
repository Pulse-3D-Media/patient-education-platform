import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubscriptionSnapshot } from "../billing-state";
import { readNewCategory } from "../categories";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import { getCheckoutFacts, includedNow, reconcileSubscription, recordAcceptedPlan, setStripeCustomer, type AcceptedPlanInput } from "./billing";
import { addCategory, getCategoryList } from "./category-config";
import { includeInFullLibraries } from "./clinics";
import { prisma } from "./client";
import { createPricingVersion } from "./pricing";

/**
 * OPTION A (decided by Evan on 2026-10-26) against the real test database: a
 * plan bought as the full library includes every category, ones added later
 * too. What these prove: the plan remembers it was the full library; the
 * billing screens read it as including every category there is now; adding
 * a category gives it, with a log entry, to clinics paying for the full
 * library and to nobody else (not a clinic on a smaller plan, not a clinic
 * Pulse manages); doing it twice gives it once; and every look at Stripe gives
 * a full-library clinic every category, so one this missed is put right.
 * Stripe is a stand-in; everything made here is removed at the end.
 */

const tag = randomBytes(4).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;
const clinicIds: string[] = [];
const addedKeys: string[] = [];
let pricingVersionId = "";

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest full library fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.categoryConfig.deleteMany({ where: { category: { in: addedKeys } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

const SIX = ["SPINE", "COMPLEX_SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];

function planInput(fullLibrary: boolean): AcceptedPlanInput {
  return fullLibrary
    ? { pricingVersionId, categories: SIX.slice(0, 5), entitledCategories: SIX, surgeonSeats: 2, interval: "MONTH", perSeatCents: 13_900, totalCents: 27_800, acceptedById: "user_vitest", acceptedByName: "Vitest Admin", fullLibrary: true }
    : { pricingVersionId, categories: ["KNEE", "HIP"], entitledCategories: ["KNEE", "HIP"], surgeonSeats: 2, interval: "MONTH", perSeatCents: 8_900, totalCents: 17_800, acceptedById: "user_vitest", acceptedByName: "Vitest Admin" };
}

/** A clinic paying by card, its plan in force, as the first payment leaves it. */
async function payingClinic(label: string, fullLibrary: boolean, options: { managedByPulse?: boolean } = {}) {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest full library ${label} ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  clinicIds.push(clinic.id);
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinic.id, customerId);
  const plan = await recordAcceptedPlan(clinic.id, planInput(fullLibrary));
  const snapshot: SubscriptionSnapshot = {
    subscriptionId,
    customerId,
    status: "active",
    latestInvoicePaid: true,
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    cancelAt: null,
    planId: plan.id,
  };
  const look = () => reconcileSubscription({ clinicId: clinic.id, subscriptionId, fetchSubscription: async () => snapshot });
  await look();
  if (options.managedByPulse) await prisma.clinic.update({ where: { id: clinic.id }, data: { managedByPulse: true } });
  return { clinicId: clinic.id, planId: plan.id, look };
}

async function addCategoryNamed(what: string) {
  const read = readNewCategory({ label: `Vitest ${what} ${tag}`, slug: `vitest-${what}-${tag}`, imageUrl: "", sortOrder: "" }, await getCategoryList());
  if (!read.ok) throw new Error(read.error);
  const added = await addCategory(read.category);
  addedKeys.push(added.value);
  return added;
}

const categoriesOf = async (clinicId: string) => (await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { categories: true } })).categories;

describe("a plan bought as the full library", () => {
  it("is remembered as the full library, and starts with every category there is", async () => {
    const f = await payingClinic("starts", true);
    expect((await prisma.billingPlan.findUniqueOrThrow({ where: { id: f.planId } })).fullLibrary).toBe(true);
    const all = (await getCategoryList()).map((entry) => entry.value);
    expect([...(await categoriesOf(f.clinicId))].sort()).toEqual([...all].sort());
  });

  it("reads, on the billing screens, as including a category added after it was bought", async () => {
    const f = await payingClinic("reads", true);
    const added = await addCategoryNamed("reads");
    const facts = await getCheckoutFacts(f.clinicId);
    expect(facts?.currentPlan?.entitledCategories).toContain(added.value);
    // The stored row keeps what it included the day it was accepted, as history.
    expect((await prisma.billingPlan.findUniqueOrThrow({ where: { id: f.planId } })).entitledCategories).toEqual(SIX);
    expect(includedNow({ fullLibrary: false, entitledCategories: ["KNEE"] }, ["KNEE", "HIP"]).entitledCategories).toEqual(["KNEE"]);
  });
});

describe("includeInFullLibraries (a category was just added)", () => {
  it("gives it, logged, to clinics on the full library, and to nobody else; twice gives it once", async () => {
    const full = await payingClinic("full", true);
    const smaller = await payingClinic("smaller", false);
    const managed = await payingClinic("managed", true, { managedByPulse: true });
    const added = await addCategoryNamed("give");

    expect(await includeInFullLibraries(added.value, added.label)).toBeGreaterThanOrEqual(1);
    expect(await categoriesOf(full.clinicId)).toContain(added.value);
    expect(await categoriesOf(smaller.clinicId)).not.toContain(added.value);
    expect(await categoriesOf(managed.clinicId)).not.toContain(added.value);
    const note = await prisma.clinicNote.findFirst({ where: { clinicId: full.clinicId, body: { contains: added.label } } });
    expect(note).toMatchObject({ authorName: "billing", body: `${added.label} was added to the library, and is included in this clinic's full library.` });

    const before = await prisma.clinicNote.count({ where: { clinicId: full.clinicId } });
    await includeInFullLibraries(added.value, added.label);
    expect((await categoriesOf(full.clinicId)).filter((category) => category === added.value)).toHaveLength(1);
    expect(await prisma.clinicNote.count({ where: { clinicId: full.clinicId } })).toBe(before);
  });

  it("is caught up by the next look at Stripe when it was missed", async () => {
    const full = await payingClinic("missed", true);
    const added = await addCategoryNamed("missed");
    // Nothing gave it to this clinic (say the server stopped halfway); the next notification does.
    expect(await categoriesOf(full.clinicId)).not.toContain(added.value);
    await full.look();
    expect(await categoriesOf(full.clinicId)).toContain(added.value);
    expect(await prisma.clinicNote.findFirst({ where: { clinicId: full.clinicId, body: { contains: "The full library now includes" } } })).not.toBeNull();
    // A clinic on a smaller plan is not given it by a look at Stripe.
    const smaller = await payingClinic("missed-smaller", false);
    await smaller.look();
    expect(await categoriesOf(smaller.clinicId)).not.toContain(added.value);
  });
});
