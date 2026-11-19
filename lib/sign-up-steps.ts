import type { BillingInterval } from "@prisma/client";
import type { Category } from "./categories";

/**
 * The three sign-up steps a new clinic's owner sees on the left (the
 * approved design, screens 02-signup-2 and 3): Email, Plan, Payment. Pure
 * and safe for the browser: no database, no Stripe, no Clerk.
 *
 * The plan step hands what was picked to the payment step in the page's
 * address (/onboarding/payment?categories=knee,hip&seats=3&interval=MONTH).
 * That address is only a REQUEST (rule 8): the payment page works the price
 * out again on the server from the active pricing version, and the Pay
 * button's checkout works it out a third time. Nothing in the address is
 * ever charged because it was in the address, and it holds nothing private.
 */

export type SignUpStepKey = "email" | "plan" | "payment";

export const SIGN_UP_STEPS: { key: SignUpStepKey; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "plan", label: "Plan" },
  { key: "payment", label: "Payment" },
];

/** Where each step of the sign-up flow lives. The email step is the landing page's box (PR #120). */
export const SIGN_UP_PATHS = {
  plan: "/onboarding/plan",
  payment: "/onboarding/payment",
  done: "/onboarding/done",
} as const;

/** What the progress list shows for one step: done, the one you are on, or still to come. */
export function stepState(step: SignUpStepKey, current: SignUpStepKey): "done" | "current" | "later" {
  const at = SIGN_UP_STEPS.findIndex((entry) => entry.key === current);
  const index = SIGN_UP_STEPS.findIndex((entry) => entry.key === step);
  if (index < at) return "done";
  return index === at ? "current" : "later";
}

/** How many steps are done, for the bar ("1 of 3" on the plan step, as drawn). */
export function stepsDone(current: SignUpStepKey): number {
  return SIGN_UP_STEPS.findIndex((entry) => entry.key === current);
}

/** A plan as the address carries it between the two steps. */
export type PlanInAddress = { categories: Category[]; seats: number; interval: BillingInterval };

/** The payment step's address for a plan, or the plan step's (with the picks kept) when `to` is "plan". */
export function planHref(plan: PlanInAddress, to: "plan" | "payment" = "payment"): string {
  const query = new URLSearchParams({ categories: plan.categories.join(","), seats: String(plan.seats), interval: plan.interval });
  return `${SIGN_UP_PATHS[to]}?${query.toString()}`;
}

/** The most seats the address may ask for. The real limit (the card plan's maximum) is the pricing version's, checked on the server. */
const MAX_SEATS_IN_ADDRESS = 99_999;

/**
 * Read a plan back out of the address, refusing rather than guessing: a
 * category that is not one of `known`, a repeat, seats that are not a whole
 * number, an interval that is not MONTH or YEAR. Null means "no usable plan
 * in the address", and the page falls back to what the server already knows.
 */
export function readPlanFromAddress(params: Record<string, string | string[] | undefined>, known: Category[]): PlanInAddress | null {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const categoriesText = one(params.categories);
  const seatsText = one(params.seats);
  const intervalText = one(params.interval);
  if (!categoriesText || !seatsText || !intervalText) return null;

  const raw = categoriesText.split(",").filter((value) => value !== "");
  if (raw.length === 0 || raw.length > known.length) return null;
  if (new Set(raw).size !== raw.length) return null;
  if (raw.some((value) => !known.includes(value))) return null;
  // In library order, so the same picks always make the same plan.
  const categories = known.filter((category) => raw.includes(category));

  if (!/^\d{1,5}$/.test(seatsText)) return null;
  const seats = Number(seatsText);
  if (seats < 1 || seats > MAX_SEATS_IN_ADDRESS) return null;

  if (intervalText !== "MONTH" && intervalText !== "YEAR") return null;
  return { categories, seats, interval: intervalText };
}
