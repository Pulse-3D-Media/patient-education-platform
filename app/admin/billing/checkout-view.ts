import type { BillingInterval, BillingStatus, Category } from "@prisma/client";
import { selfServeEligibility } from "@/lib/billing-state";
import { CATEGORIES, type CategoryAvailability } from "@/lib/categories";
import { CHECKOUT_CLOSED_MESSAGE } from "@/lib/checkout";
import { getCheckoutFacts } from "@/lib/db/billing";
import { getCategoryAvailability } from "@/lib/db/category-config";
import { getActivePricing } from "@/lib/db/pricing";
import type { PricingConfig } from "@/lib/pricing";
import { checkoutIsOpen } from "@/lib/stripe";

/**
 * What the checkout part of /admin/billing shows for one clinic, worked out
 * on the server. Server only: it reads the database.
 *
 * It decides WHAT to draw (the plan picker, a message, the subscription
 * the clinic already has). It decides nothing about money:
 * when the picker is drawn, the numbers it shows are the active pricing
 * version's, and the Server Action works the price out again from scratch
 * when the button is pressed.
 */

/** An accepted plan, as the page shows it. */
export type PlanFacts = {
  /** Everything the plan includes (every category when the full library was bought). */
  included: Category[];
  /** What the admin picked. */
  picked: Category[];
  seats: number;
  interval: BillingInterval;
  perSeatCents: number;
  totalCents: number;
  acceptedAt: Date;
  acceptedByName: string;
  /** The number of the pricing version it was quoted from. */
  version: number;
};

/** One category on the picker: can it be bought right now, and if not, why not. */
export type CategoryOption = { value: Category; label: string; availability: CategoryAvailability };

export type CheckoutOffer =
  /** Pulse manages this clinic's plan. No card payment, no controls. */
  | { kind: "managed" }
  /** No card payment for this clinic: it talks to Pulse instead. */
  | { kind: "contact"; reason: "hospital" | "closed-by-staff" }
  /** The clinic already has a subscription. Its plan is shown; changing it is a later step. */
  | { kind: "subscribed" }
  /** Checkout is not available here (not switched on for this deployment, or no prices have been published). */
  | { kind: "closed"; message: string }
  /** Draw the plan picker. */
  | {
      kind: "picker";
      versionId: string;
      /** The active version's prices, with the founding number removed: no founding offer is approved, so the browser never sees one. */
      config: PricingConfig;
      options: CategoryOption[];
      /** What the picker opens with: the plan the admin accepted last if they came back, else the plan on file. */
      initial: { categories: Category[]; seats: number; interval: BillingInterval };
    };

export type CheckoutView = {
  offer: CheckoutOffer;
  billingStatus: BillingStatus;
  /** The plan being paid for, when there is a subscription (active, past due, or ended). */
  subscription: { plan: PlanFacts; currentPeriodEnd: Date | null; cancelAt: Date | null } | null;
  /** A plan the admin accepted that no confirmed payment has arrived for yet. */
  waiting: PlanFacts | null;
};

type PlanRow = NonNullable<NonNullable<Awaited<ReturnType<typeof getCheckoutFacts>>>["currentPlan"]>;

function planFacts(row: PlanRow): PlanFacts {
  return {
    included: row.entitledCategories,
    picked: row.categories,
    seats: row.surgeonSeats,
    interval: row.interval,
    perSeatCents: row.perSeatCents,
    totalCents: row.totalCents,
    acceptedAt: row.createdAt,
    acceptedByName: row.acceptedByName,
    version: row.pricingVersion.version,
  };
}

/** The checkout view for one clinic, or null for an unknown id. `planOnFile` is the clinic's current categories and seats, for the picker's first values. */
export async function getCheckoutView(clinicId: string, planOnFile: { categories: Category[]; surgeonSeats: number }): Promise<CheckoutView | null> {
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return null;

  const { facts } = clinic;
  const live = facts.status === "ACTIVE" || facts.status === "PAST_DUE";
  const subscription =
    clinic.currentPlan && (live || facts.status === "CANCELED")
      ? { plan: planFacts(clinic.currentPlan), currentPeriodEnd: facts.currentPeriodEnd, cancelAt: facts.cancelAt }
      : null;
  const waiting = clinic.pendingPlan && !live ? planFacts(clinic.pendingPlan) : null;
  const base = { billingStatus: facts.status, subscription, waiting };

  const eligibility = selfServeEligibility(clinic);
  if (!eligibility.eligible) {
    if (eligibility.reason === "managed-by-pulse") return { ...base, offer: { kind: "managed" } };
    return { ...base, offer: { kind: "contact", reason: eligibility.reason } };
  }
  if (live) return { ...base, offer: { kind: "subscribed" } };
  if (!checkoutIsOpen()) return { ...base, offer: { kind: "closed", message: CHECKOUT_CLOSED_MESSAGE } };

  // The prices. A problem reading them closes the picker with a plain
  // sentence; the detail goes to the server log, never to the page.
  let pricing;
  let availability;
  try {
    [pricing, availability] = await Promise.all([getActivePricing(), getCategoryAvailability()]);
  } catch (error) {
    console.error(`Checkout view for clinic ${clinicId}: ${error instanceof Error ? error.name : "Error"}`);
    return { ...base, offer: { kind: "closed", message: "Plans cannot be shown right now. Try again in a moment." } };
  }
  // The built-in default prices are an estimate nobody approved. Checkout needs a saved, active version.
  if (pricing.source.kind !== "version") return { ...base, offer: { kind: "closed", message: CHECKOUT_CLOSED_MESSAGE } };

  const options = CATEGORIES.map((category) => ({ value: category.value, label: category.label, availability: availability[category.value] }));
  const canBuy = (category: Category) => availability[category] === "sellable";
  const clinicMax = pricing.config.seats.clinicMax;
  const from = waiting
    ? { categories: waiting.picked, seats: waiting.seats, interval: waiting.interval }
    : { categories: planOnFile.categories, seats: planOnFile.surgeonSeats, interval: "MONTH" as BillingInterval };

  return {
    ...base,
    offer: {
      kind: "picker",
      versionId: pricing.source.version.id,
      config: { ...pricing.config, foundingDiscountBp: 0 },
      options,
      initial: {
        categories: from.categories.filter(canBuy),
        seats: Math.min(Math.max(from.seats, 1), clinicMax),
        interval: from.interval,
      },
    },
  };
}
