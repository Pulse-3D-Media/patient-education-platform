import type { BillingInterval, BillingStatus, Category } from "@prisma/client";
import { SELF_SERVE_REFUSALS, type SelfServeEligibility } from "./billing-state";
import { readPlanSelection, type PlanSelection } from "./checkout-rules";

/**
 * The rules for changing a plan that is being paid for. Pure and safe for
 * the browser (rule 8 in CLAUDE.md): no database, no Stripe, no clock of
 * its own. lib/plan-changes.ts (server only) does the work; the Billing
 * page and its form use the same rules to say what will happen.
 *
 * THE ONE RULE ABOUT TIMING (the financial policy; it is not changed
 * without Evan's say-so):
 *
 *   - A change that only ADDS (more categories, more seats, or both, with
 *     the same billing interval and the same prices) starts NOW, once the
 *     payment for the rest of the current period has succeeded. Until that
 *     payment succeeds nothing changes.
 *   - EVERYTHING ELSE starts at the NEXT RENEWAL, as one whole change:
 *     taking anything away, adding one thing while taking another away,
 *     moving between monthly and yearly, and moving to newer prices. Until
 *     then the clinic keeps exactly what it has and pays what it pays.
 *
 * A change is NEVER sorted by whether its price goes up or down. Two plans
 * can cost the same and include different categories, and a plan that costs
 * more can still take a category away. What is compared is what the clinic
 * GETS (the categories included, and the seats).
 */

/** The parts of an accepted plan a change is sorted by. */
export type ChangeShape = {
  pricingVersionId: string;
  /** Everything the plan includes (every category, when the full library is bought). */
  entitledCategories: Category[];
  surgeonSeats: number;
  interval: BillingInterval;
  perSeatCents: number;
};

/** Why a change waits for the renewal. */
export type RenewalReason =
  /** Something is taken away and nothing is added. */
  | "reduction"
  /** Something is added and something else is taken away. */
  | "mixed"
  /** Monthly to yearly, or yearly to monthly. */
  | "interval"
  /** A move to the prices on offer now, from the prices the clinic signed up at. */
  | "pricing";

export type ChangeKind =
  /** Nothing would change. */
  | { timing: "same" }
  /** Only adds: starts now, once its payment succeeds. */
  | { timing: "now" }
  /** Starts at the next renewal. */
  | { timing: "renewal"; why: RenewalReason };

/** Sort one change. `current` is the plan in force, `next` the plan asked for. */
export function classifyPlanChange(current: ChangeShape, next: ChangeShape): ChangeKind {
  const added = next.entitledCategories.some((category) => !current.entitledCategories.includes(category));
  const removed = current.entitledCategories.some((category) => !next.entitledCategories.includes(category));
  const moreSeats = next.surgeonSeats > current.surgeonSeats;
  const fewerSeats = next.surgeonSeats < current.surgeonSeats;
  const adds = added || moreSeats;
  const takesAway = removed || fewerSeats;

  // Checked first: either of these makes the whole change a renewal change, whatever else it does.
  if (next.pricingVersionId !== current.pricingVersionId) return { timing: "renewal", why: "pricing" };
  if (next.interval !== current.interval) return { timing: "renewal", why: "interval" };

  if (adds && takesAway) return { timing: "renewal", why: "mixed" };
  if (takesAway) return { timing: "renewal", why: "reduction" };
  if (adds) return { timing: "now" };
  // Same categories, same seats, same interval, same prices. (A different
  // per-seat amount here cannot come from the same prices; if it ever did,
  // it would wait for the renewal like any change that is not purely more.)
  if (next.perSeatCents !== current.perSeatCents) return { timing: "renewal", why: "mixed" };
  return { timing: "same" };
}

/** Why a change waits, as a sentence for the admin making it. */
export const RENEWAL_REASON_WORDS: Record<RenewalReason, string> = {
  reduction: "This takes something off your plan, so it starts at your next renewal. Until then you keep everything you have now.",
  mixed: "This adds one thing and takes another away, so the whole change starts together at your next renewal. Until then your plan stays as it is.",
  interval: "This changes how often you pay, so the whole change starts at your next renewal. Until then your plan stays as it is.",
  pricing: "This moves your plan to the current prices, so the whole change starts at your next renewal. Until then your plan and its price stay as they are.",
};

export const SAME_PLAN_MESSAGE = "That is the plan you already have, so there is nothing to change.";

// ---------------------------------------------------------------------------
// May this clinic's plan be changed here right now?
// ---------------------------------------------------------------------------

export type ChangeBlockFacts = {
  eligibility: SelfServeEligibility;
  /** Is card payment switched on for this deployment (checkoutIsOpen in lib/stripe.ts)? */
  open: boolean;
  status: BillingStatus;
  hasCurrentPlan: boolean;
  cancelAt: Date | null;
  /** An upgrade waiting for its payment. */
  pendingPlanId: string | null;
};

export const PLAN_CHANGES_CLOSED_MESSAGE = "Changing a plan here is not open yet. Until it is, get in touch with Pulse 3D and we will do it with you.";

/**
 * Why this clinic's plan cannot be changed here right now, as a plain
 * sentence, or null when it can. The page asks this to decide what to draw,
 * and the server asks it again when the button is pressed.
 */
export function planChangeBlock(facts: ChangeBlockFacts): string | null {
  if (!facts.eligibility.eligible) return SELF_SERVE_REFUSALS[facts.eligibility.reason];
  if (!facts.open) return PLAN_CHANGES_CLOSED_MESSAGE;
  if (facts.status === "PAST_DUE") return "Your last payment did not go through. Settle that first, then change your plan.";
  if (facts.status !== "ACTIVE" || !facts.hasCurrentPlan) return "Your clinic has no subscription to change.";
  if (facts.cancelAt) return "Your subscription is set to end, so its plan cannot be changed. Keep the subscription going first (on Stripe's billing page), then change the plan.";
  if (facts.pendingPlanId) return "A plan change is waiting for its payment. Pay for it or cancel it first.";
  return null;
}

// ---------------------------------------------------------------------------
// What the forms send
// ---------------------------------------------------------------------------

/** What the change form sends when the admin asks to REVIEW a change: the picks, and nothing about money that is believed. */
export type ChangeRequest = {
  selection: PlanSelection;
  /** Quote from the prices on offer now, not the prices the clinic signed up at. */
  moveToCurrentPricing: boolean;
};

export type ChangeRequestResult = { ok: true; request: ChangeRequest } | { ok: false; error: string };

export function readChangeRequest(formData: FormData): ChangeRequestResult {
  const read = readPlanSelection(formData);
  if (!read.ok) return read;
  return { ok: true, request: { selection: read.selection, moveToCurrentPricing: formData.get("moveToCurrentPricing") === "yes" } };
}

/**
 * What the admin was shown on the review step, sent back when they press
 * Confirm. Like every "seen" value, it is only ever COMPARED with what the
 * server works out again; none of it is charged or trusted.
 */
export type ChangeSeen = {
  timing: "now" | "renewal";
  /** For a change that starts now: the moment the amount due today was worked out for, in whole seconds. */
  at: Date | null;
  /** For a change that starts now: the amount due today that was on screen, in cents. */
  dueNowCents: number | null;
};

export type ChangeConfirmResult = { ok: true; request: ChangeRequest; seen: ChangeSeen } | { ok: false; error: string };

const OUT_OF_DATE = "This page is out of date. Review the change again.";

export function readChangeConfirm(formData: FormData): ChangeConfirmResult {
  const read = readChangeRequest(formData);
  if (!read.ok) return read;

  const timing = String(formData.get("seenTiming") ?? "");
  if (timing === "renewal") return { ok: true, request: read.request, seen: { timing, at: null, dueNowCents: null } };
  if (timing !== "now") return { ok: false, error: OUT_OF_DATE };

  const atText = String(formData.get("seenAt") ?? "");
  const dueText = String(formData.get("seenDueNowCents") ?? "");
  // The amount due can be negative in principle (a credit), so a leading minus is read; it is still only compared.
  if (!/^\d{9,11}$/.test(atText) || !/^-?\d{1,12}$/.test(dueText)) return { ok: false, error: OUT_OF_DATE };
  return { ok: true, request: read.request, seen: { timing, at: new Date(Number(atText) * 1000), dueNowCents: Number(dueText) } };
}

/** How long an amount shown on the review step may be confirmed for. After that the admin reviews again, so the amount is fresh. */
export const REVIEW_MINUTES = 15;

/**
 * May a change be made for the moment the admin's review was worked out
 * for? Only a recent moment, never one in the future, and never one before
 * the period being paid for began. The moment decides how much of the
 * period is left to charge for, so it is the server's own clock from the
 * review, sent back; this is the check that it still is.
 */
export function reviewMomentIsUsable(at: Date, now: Date, periodStart: Date | null): boolean {
  const time = at.getTime();
  if (!Number.isFinite(time)) return false;
  if (time > now.getTime() + 60_000) return false;
  if (time < now.getTime() - REVIEW_MINUTES * 60_000) return false;
  if (periodStart && time < periodStart.getTime()) return false;
  return true;
}
