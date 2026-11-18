import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubscriptionSnapshot } from "../billing-state";
import { checkPayment } from "../checkout";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import type { CheckoutGateway } from "../stripe";
import { NEEDS_LOOK, RESET_REFUSED_CHECKOUT, RESET_REFUSED_LIVE, reconcileSubscription, recordAcceptedPlan, resetVanishedStripeRecord, setStripeCustomer, type AcceptedPlanInput } from "./billing";
import { prisma } from "./client";
import { createPricingVersion } from "./pricing";

/**
 * A subscription that no longer exists in Stripe (audit finding E3), against
 * the database with a stand-in for Stripe.
 *
 * Before: the look at Stripe said "no such subscription, nothing changed",
 * so a clinic whose subscription had vanished (test data deleted, or a
 * different Stripe key, which at go-live is every test-mode clinic) kept
 * whatever its record said for ever, and staff had no way to start it over.
 * Now: the expected subscription missing is its own outcome (the record says
 * it ended, logged, flagged for a person), "Check again" notices it even when
 * Stripe no longer lists it, and Pulse staff have a reset, refused while
 * Stripe still knows a live subscription.
 */

const tag = randomBytes(5).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;
const createdClinicIds: string[] = [];
let pricingVersionId = "";

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest gone-subscription fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

function planInput(): AcceptedPlanInput {
  return {
    pricingVersionId,
    categories: ["KNEE"],
    entitledCategories: ["KNEE"],
    surgeonSeats: 2,
    interval: "MONTH",
    perSeatCents: 5900,
    totalCents: 11800,
    acceptedById: "user_vitest_admin",
    acceptedByName: "Vitest Admin",
  };
}

/** A clinic with a checkout started. `status` says how far its first payment got: "active" (paying) or "incomplete" (under way). */
async function makeClinic(status: "active" | "incomplete") {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest gone ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinic.id, customerId);
  const plan = await recordAcceptedPlan(clinic.id, planInput());
  const snap: SubscriptionSnapshot = {
    subscriptionId,
    customerId,
    status,
    latestInvoicePaid: status === "active",
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    cancelAt: null,
    planId: plan.id,
  };
  await reconcileSubscription({ clinicId: clinic.id, subscriptionId, fetchSubscription: async () => snap });
  // The checkout attempt was made long ago, so its payment page has closed (a recent one refuses the reset: see below).
  await prisma.billingPlan.update({ where: { id: plan.id }, data: { createdAt: new Date(Date.now() - 3 * 60 * 60_000) }, select: { id: true } });
  return { clinicId: clinic.id, customerId, subscriptionId, planId: plan.id };
}

const gone = async () => null;
const rows = async (clinicId: string) => ({
  billing: await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId } }),
  clinic: await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true } }),
  notes: await prisma.clinicNote.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" }, select: { body: true, authorName: true } }),
});

describe("the subscription a clinic expects is gone from Stripe", () => {
  it("a paying clinic's record says it ended, the clinic closes, one log entry, and the outcome is flagged for a person", async () => {
    const f = await makeClinic("active");
    expect((await rows(f.clinicId)).clinic.status).toBe("ACTIVE");
    const notesBefore = (await rows(f.clinicId)).notes.length;

    const result = await reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone });
    expect(result.kind).toBe("processed");
    expect(result.outcome.startsWith(NEEDS_LOOK)).toBe(true);
    const after = await rows(f.clinicId);
    expect(after.billing.status).toBe("CANCELED");
    expect(after.billing.stripeSubscriptionId).toBe(f.subscriptionId); // kept as history until staff reset it
    expect(after.clinic.status).toBe("CANCELED");
    expect(after.notes.length).toBe(notesBefore + 1);
    expect(after.notes.at(-1)?.body).toContain("Stripe no longer has this clinic's subscription");

    // Asked again: nothing more changes and nothing more is logged.
    const again = await reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone });
    expect(again.kind).toBe("ignored");
    expect((await rows(f.clinicId)).notes.length).toBe(notesBefore + 1);
  });

  it("a first payment under way whose subscription vanished goes back to no subscription, so the admin can choose a plan again", async () => {
    const f = await makeClinic("incomplete");
    expect((await rows(f.clinicId)).billing.status).toBe("INCOMPLETE");
    await reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone });
    const after = await rows(f.clinicId);
    expect(after.billing.status).toBe("NONE");
    expect(after.billing.stripeSubscriptionId).toBeNull();
    expect(after.clinic.status).toBe("PENDING");
  });

  it("a missing subscription that is NOT the one expected changes nothing, as before", async () => {
    const f = await makeClinic("active");
    const result = await reconcileSubscription({ clinicId: f.clinicId, subscriptionId: unique("sub"), fetchSubscription: gone });
    expect(result.kind).toBe("ignored");
    expect((await rows(f.clinicId)).billing.status).toBe("ACTIVE");
  });

  it("Check again notices it even when Stripe no longer lists the subscription (the customer is gone too)", async () => {
    const f = await makeClinic("incomplete");
    const gateway = { listSubscriptions: async () => [] } as unknown as CheckoutGateway;
    const result = await checkPayment({ clinicId: f.clinicId, gateway, fetchSubscription: gone });
    expect(result.status).toBe("NONE");
    expect((await rows(f.clinicId)).billing.status).toBe("NONE");
  });

  it("one clinic's vanished subscription never touches another clinic", async () => {
    const a = await makeClinic("active");
    const b = await makeClinic("active");
    await reconcileSubscription({ clinicId: a.clinicId, subscriptionId: a.subscriptionId, fetchSubscription: gone });
    await expect(resetVanishedStripeRecord(a.clinicId, { staffName: "Vitest Staff", checkStripe: async () => "gone" })).resolves.toMatchObject({ ok: true });
    const other = await rows(b.clinicId);
    expect(other.billing.status).toBe("ACTIVE");
    expect(other.billing.stripeCustomerId).toBe(b.customerId);
    expect(other.clinic.status).toBe("ACTIVE");
  });
});

describe("the staff reset", () => {
  it("is refused while Stripe still knows a live subscription, with nothing written", async () => {
    const f = await makeClinic("active");
    const before = await rows(f.clinicId);
    const result = await resetVanishedStripeRecord(f.clinicId, { staffName: "Vitest Staff", checkStripe: async () => "live" });
    expect(result).toEqual({ ok: false, message: RESET_REFUSED_LIVE });
    const after = await rows(f.clinicId);
    expect(after.billing).toEqual(before.billing);
    expect(after.notes.length).toBe(before.notes.length);
  });

  it("is refused while the clinic has a payment page open in Stripe, with nothing written, so a payment made on it is never stranded", async () => {
    const clinic = await prisma.clinic.create({ data: { name: `Vitest gone ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    const customerId = unique("cus");
    await setStripeCustomer(clinic.id, customerId);
    const before = await rows(clinic.id);
    const result = await resetVanishedStripeRecord(clinic.id, { staffName: "Vitest Staff", checkStripe: async () => "checkout-open" });
    expect(result).toEqual({ ok: false, message: RESET_REFUSED_CHECKOUT });
    const after = await rows(clinic.id);
    expect(after.billing).toEqual(before.billing);
    expect(after.billing.stripeCustomerId).toBe(customerId);
    expect(after.notes.length).toBe(before.notes.length);
  });

  it("is refused while a checkout attempt made within the hour could still be paid, even when Stripe lists no open page; allowed once it has closed", async () => {
    const clinic = await prisma.clinic.create({ data: { name: `Vitest gone ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    const customerId = unique("cus");
    await setStripeCustomer(clinic.id, customerId);
    const attempt = await recordAcceptedPlan(clinic.id, planInput()); // the admin is on Stripe's payment page right now
    const madeAt = (await prisma.billingPlan.findUniqueOrThrow({ where: { id: attempt.id }, select: { createdAt: true } })).createdAt;

    const now = new Date(madeAt.getTime() + 30 * 60_000);
    const refused = await resetVanishedStripeRecord(clinic.id, { staffName: "Vitest Staff", checkStripe: async () => "gone", now });
    expect(refused).toEqual({ ok: false, message: RESET_REFUSED_CHECKOUT });
    expect((await rows(clinic.id)).billing).toMatchObject({ stripeCustomerId: customerId, pendingPlanId: attempt.id });

    const later = new Date(madeAt.getTime() + 2 * 60 * 60_000);
    await expect(resetVanishedStripeRecord(clinic.id, { staffName: "Vitest Staff", checkStripe: async () => "gone", now: later })).resolves.toMatchObject({ ok: true });
    expect((await rows(clinic.id)).billing).toMatchObject({ stripeCustomerId: null, pendingPlanId: null });
  });

  it("asks Stripe about the ids on record, then clears them, logged under the staff member's name", async () => {
    const f = await makeClinic("active");
    await reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone });
    let asked: unknown = null;
    const result = await resetVanishedStripeRecord(f.clinicId, {
      staffName: "Vitest Staff",
      checkStripe: async (ids) => {
        asked = ids;
        return "gone";
      },
    });
    expect(result.ok).toBe(true);
    expect(asked).toEqual({ customerId: f.customerId, subscriptionId: f.subscriptionId });
    const after = await rows(f.clinicId);
    expect(after.billing).toMatchObject({ status: "CANCELED", stripeCustomerId: null, stripeSubscriptionId: null, pendingPlanId: null, scheduledPlanId: null });
    expect(after.billing.currentPlanId).not.toBeNull(); // the plan it had stays as history
    expect(after.clinic.status).toBe("CANCELED");
    expect(after.notes.at(-1)).toMatchObject({ authorName: "Vitest Staff", body: expect.stringContaining("Billing reset by Vitest Staff") });

    // A new customer can now be attached, which is what lets the clinic start again.
    await expect(setStripeCustomer(f.clinicId, unique("cus"))).resolves.toBeTruthy();
  });

  it("a clinic Stripe never confirmed a payment for goes back to no subscription", async () => {
    const f = await makeClinic("incomplete");
    await expect(resetVanishedStripeRecord(f.clinicId, { staffName: "Vitest Staff", checkStripe: async () => "gone" })).resolves.toMatchObject({ ok: true });
    const after = await rows(f.clinicId);
    expect(after.billing.status).toBe("NONE");
    expect(after.clinic.status).toBe("PENDING");
  });

  it("says there is nothing to reset when there are no ids, and does not ask Stripe", async () => {
    const f = await makeClinic("incomplete");
    await resetVanishedStripeRecord(f.clinicId, { staffName: "Vitest Staff", checkStripe: async () => "gone" });
    let asked = false;
    const result = await resetVanishedStripeRecord(f.clinicId, {
      staffName: "Vitest Staff",
      checkStripe: async () => {
        asked = true;
        return "gone";
      },
    });
    expect(result.ok).toBe(false);
    expect(asked).toBe(false);
  });

  it("when Stripe cannot be asked it throws and nothing is written", async () => {
    const f = await makeClinic("active");
    const before = await rows(f.clinicId);
    await expect(
      resetVanishedStripeRecord(f.clinicId, {
        staffName: "Vitest Staff",
        checkStripe: async () => {
          throw new Error("Stripe unreachable");
        },
      }),
    ).rejects.toThrow();
    expect((await rows(f.clinicId)).billing).toEqual(before.billing);
  });
});
