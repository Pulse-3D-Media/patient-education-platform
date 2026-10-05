import type { BillingInterval, BillingStatus, Category } from "@prisma/client";
import { selfServeEligibility } from "@/lib/billing-state";
import { CATEGORIES, type CategoryAvailability } from "@/lib/categories";
import { CHECKOUT_CLOSED_MESSAGE } from "@/lib/checkout";
import { getCheckoutFacts } from "@/lib/db/billing";
import { getCategoryAvailability } from "@/lib/db/category-config";
import { getActivePricing, getPricingVersion } from "@/lib/db/pricing";
import { planChangeBlock } from "@/lib/plan-change";
import type { PricingConfig } from "@/lib/pricing";
import { checkoutIsOpen } from "@/lib/stripe";

/**
 * What the checkout part of /admin/billing shows for one clinic, worked out
 * on the server. Server only: it reads the database.
 *
 * It decides WHAT to draw (the plan picker, a message, the subscription
 * the clinic already has and the form for changing it). It decides nothing
 * about money: when a picker is drawn, the numbers it shows are a saved
 * pricing version's, and the Server Action works the price out again from
 * scratch when the button is pressed.
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
  /** The clinic already has a subscription. Its plan is shown, and `change` says how (or why not) it can be changed. */
  | { kind: "subscribed"; change: ChangeOffer }
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

/** Changing a plan that is being paid for: the form's numbers, or the reason there is no form. */
export type ChangeOffer =
  | { kind: "blocked"; message: string }
  | {
      kind: "changer";
      /** The prices this clinic signed up at (the version on its current plan). The form opens on these. */
      own: { versionId: string; version: number; config: PricingConfig };
      /** The prices on offer now, when they are a different version. Null when the clinic is already on them. Moving to them is the owner's choice, never automatic. */
      latest: { versionId: string; version: number; config: PricingConfig } | null;
      options: CategoryOption[];
      /** What the clinic has now: the form opens on it, and its categories can be kept even if they are no longer for sale. */
      current: { picked: Category[]; included: Category[]; seats: number; interval: BillingInterval };
    };

export type CheckoutView = {
  offer: CheckoutOffer;
  billingStatus: BillingStatus;
  /** The plan being paid for, when there is a subscription (active, past due, or ended). */
  subscription: { plan: PlanFacts; currentPeriodEnd: Date | null; cancelAt: Date | null } | null;
  /** A plan the admin accepted that no confirmed payment has arrived for yet (a first checkout). */
  waiting: PlanFacts | null;
  /** A change set for the next renewal, on a subscription that is live. Nothing of it is in force yet. */
  scheduled: { plan: PlanFacts; at: Date | null } | null;
  /** An upgrade on a live subscription whose payment has not gone through. Nothing of it is in force. */
  unpaidChange: PlanFacts | null;
  /** Can Stripe's own billing page (card, invoices, cancelling) be opened for this clinic? Not for a managed clinic, one that never paid by card, or a deployment where card payment is shut. */
  portal: boolean;
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
  const scheduled = live && clinic.scheduledPlan ? { plan: planFacts(clinic.scheduledPlan), at: facts.scheduledChangeAt } : null;
  const unpaidChange = live && clinic.pendingPlan ? planFacts(clinic.pendingPlan) : null;
  const open = checkoutIsOpen();
  const portal = open && !clinic.managedByPulse && facts.stripeCustomerId !== null && facts.status !== "NONE" && facts.status !== "INCOMPLETE";
  const base = { billingStatus: facts.status, subscription, waiting, scheduled, unpaidChange, portal };

  const eligibility = selfServeEligibility(clinic);
  if (!eligibility.eligible) {
    if (eligibility.reason === "managed-by-pulse") return { ...base, offer: { kind: "managed" } };
    return { ...base, offer: { kind: "contact", reason: eligibility.reason } };
  }
  if (live) return { ...base, offer: { kind: "subscribed", change: await changeOffer(clinicId, clinic, open) } };
  if (!open) return { ...base, offer: { kind: "closed", message: CHECKOUT_CLOSED_MESSAGE } };

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

/**
 * What the "Change your plan" part of the page shows for a clinic with a
 * live subscription: the form's numbers, or one plain sentence saying why
 * the plan cannot be changed here right now (the same rule the server
 * applies again when the button is pressed, planChangeBlock).
 */
async function changeOffer(clinicId: string, clinic: NonNullable<Awaited<ReturnType<typeof getCheckoutFacts>>>, open: boolean): Promise<ChangeOffer> {
  const { facts, currentPlan } = clinic;
  const block = planChangeBlock({
    eligibility: selfServeEligibility(clinic),
    open,
    status: facts.status,
    hasCurrentPlan: currentPlan !== null,
    cancelAt: facts.cancelAt,
    pendingPlanId: facts.pendingPlanId,
  });
  if (block || !currentPlan) return { kind: "blocked", message: block ?? "Your clinic has no subscription to change." };

  let own;
  let active;
  let availability;
  try {
    [own, active, availability] = await Promise.all([getPricingVersion(currentPlan.pricingVersionId), getActivePricing(), getCategoryAvailability()]);
  } catch (error) {
    console.error(`Plan change view for clinic ${clinicId}: ${error instanceof Error ? error.name : "Error"}`);
    return { kind: "blocked", message: "Plans cannot be shown right now. Try again in a moment." };
  }
  if (!own || !own.config) return { kind: "blocked", message: "Your plan's prices could not be read, so it cannot be changed here right now. Get in touch with Pulse 3D." };

  // The founding number is never sent to the browser: no founding offer is approved.
  const withoutFounding = (config: PricingConfig): PricingConfig => ({ ...config, foundingDiscountBp: 0 });
  const latest =
    active.source.kind === "version" && active.source.version.id !== own.id
      ? { versionId: active.source.version.id, version: active.source.version.version, config: withoutFounding(active.config) }
      : null;

  return {
    kind: "changer",
    own: { versionId: own.id, version: own.version, config: withoutFounding(own.config) },
    latest,
    options: CATEGORIES.map((category) => ({ value: category.value, label: category.label, availability: availability[category.value] })),
    current: { picked: currentPlan.categories, included: currentPlan.entitledCategories, seats: currentPlan.surgeonSeats, interval: currentPlan.interval },
  };
}
