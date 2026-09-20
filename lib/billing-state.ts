import type { BillingStatus, ClinicStatus, PracticeType, StaffAccess } from "@prisma/client";

/**
 * The billing rules, pure: no database, no Stripe, no clock of their own.
 * lib/db/billing.ts reads the facts, asks this file what to do, and writes
 * the answer in one transaction. The tests in billing-state.test.ts are the
 * state table below, row by row.
 *
 * TWO SEPARATE THINGS ARE KEPT, AND NEVER MIXED UP:
 *
 *   1. The financial record (the ClinicBilling row): what Stripe says about
 *      the clinic's ONE expected subscription. It is updated from Stripe no
 *      matter what, so it can always be checked against Stripe.
 *   2. Access (Clinic.status and Clinic.graceEndsAt): whether the clinic is
 *      open. Worked out by effectiveAccess() below from three inputs: what
 *      Pulse staff set by hand, whether Pulse manages the clinic, and the
 *      financial record.
 *
 * THE STATE TABLE. Rules are read top to bottom; the first that fits wins.
 *
 *   # | Staff set by hand | Managed by Pulse | Billing      | Status   | Open?
 *   --+-------------------+------------------+--------------+----------+---------------------
 *   1 | PAUSED            | any              | any          | PAUSED   | no  (staff pause)
 *   2 | CANCELED          | any              | any          | CANCELED | no  (ended by staff)
 *   3 | OPEN              | any              | any          | ACTIVE   | yes (held open by hand)
 *   4 | nothing           | yes              | any          | PENDING  | no  (managed, not opened yet)
 *   5 | nothing           | no               | NONE         | PENDING  | no  (no plan)
 *   6 | nothing           | no               | INCOMPLETE   | PENDING  | no  (checkout not paid)
 *   7 | nothing           | no               | ACTIVE       | ACTIVE   | yes (paid)
 *   8 | nothing           | no               | PAST_DUE     | PAST_DUE | until graceEndsAt
 *   9 | nothing           | no               | CANCELED     | CANCELED | no
 *
 * A scheduled cancellation is row 7: the clinic stays open until Stripe
 * actually ends the subscription, then row 9. "Recovered" is row 8 going
 * back to row 7, which needs a PAID invoice, not just Stripe's word
 * "active" (Stripe also says "active" when an invoice is written off).
 *
 * What follows from the table, in words:
 *
 *   - A staff pause always wins. No notification from Stripe, old or new,
 *     reopens a clinic staff paused: billing never writes staffAccess to
 *     anything but empty, and never touches PAUSED or CANCELED.
 *   - A Pulse-managed clinic's access is only ever what staff set by hand
 *     (rows 3 and 4). Billing news still updates its financial record and is
 *     still logged, but changes neither its status nor its plan.
 *   - Marking a clinic managed, or pausing it, does NOT cancel anything in
 *     Stripe. A card subscription keeps charging until it is cancelled in
 *     Stripe. The screens say so wherever either is done.
 *   - One automatic change to a hand setting exists: when a self-serve
 *     clinic's first card payment is confirmed, a staffAccess of OPEN is
 *     cleared, so the clinic's access follows its payments from then on
 *     (otherwise a clinic opened by hand before billing would stay open for
 *     ever after it stopped paying). PAUSED and CANCELED are never cleared.
 */

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** The three inputs access is worked out from. */
export type AccessInputs = {
  staffAccess: StaffAccess | null;
  managedByPulse: boolean;
  /** The financial record's status; NONE when the clinic has no ClinicBilling row. */
  billingStatus: BillingStatus;
  /** The financial record's grace deadline, when it has one. */
  billingGraceEndsAt: Date | null;
};

/** What gets stored on the Clinic row. graceEndsAt is only ever set together with PAST_DUE. */
export type EffectiveAccess = { status: ClinicStatus; graceEndsAt: Date | null };

/** The state table above, as code. */
export function effectiveAccess(inputs: AccessInputs): EffectiveAccess {
  if (inputs.staffAccess === "PAUSED") return { status: "PAUSED", graceEndsAt: null };
  if (inputs.staffAccess === "CANCELED") return { status: "CANCELED", graceEndsAt: null };
  if (inputs.staffAccess === "OPEN") return { status: "ACTIVE", graceEndsAt: null };
  if (inputs.managedByPulse) return { status: "PENDING", graceEndsAt: null };

  switch (inputs.billingStatus) {
    case "ACTIVE":
      return { status: "ACTIVE", graceEndsAt: null };
    case "PAST_DUE":
      return { status: "PAST_DUE", graceEndsAt: inputs.billingGraceEndsAt };
    case "CANCELED":
      return { status: "CANCELED", graceEndsAt: null };
    case "NONE":
    case "INCOMPLETE":
    default:
      // Anything not understood is closed, never open.
      return { status: "PENDING", graceEndsAt: null };
  }
}

// ---------------------------------------------------------------------------
// Grace
// ---------------------------------------------------------------------------

/** The limits on the grace days setting. The settings form holds to the same ones. */
export const MIN_GRACE_DAYS = 1;
export const MAX_GRACE_DAYS = 365;

export function isValidGraceDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= MIN_GRACE_DAYS && days <= MAX_GRACE_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The exact moment grace ends: the moment the failed renewal was first
 * recorded, plus the grace days. Null when either cannot be read, and a
 * PAST_DUE clinic with no deadline is closed (clinicIsOpen), so a damaged
 * setting can never become unlimited unpaid access.
 */
export function graceDeadline(failedAt: Date, graceDays: unknown): Date | null {
  if (!(failedAt instanceof Date) || !Number.isFinite(failedAt.getTime())) return null;
  if (!isValidGraceDays(graceDays)) return null;
  return new Date(failedAt.getTime() + graceDays * DAY_MS);
}

// ---------------------------------------------------------------------------
// The financial record
// ---------------------------------------------------------------------------

/** The parts of a ClinicBilling row the rules read and write. */
export type BillingFacts = {
  status: BillingStatus;
  stripeCustomerId: string | null;
  /** The subscription this clinic is expected to have. News about any other one is ignored. */
  stripeSubscriptionId: string | null;
  pendingPlanId: string | null;
  currentPlanId: string | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  paymentFailedAt: Date | null;
  graceEndsAt: Date | null;
};

/** A clinic that has never had anything to do with Stripe. */
export const NO_BILLING: BillingFacts = {
  status: "NONE",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  pendingPlanId: null,
  currentPlanId: null,
  currentPeriodEnd: null,
  cancelAt: null,
  paymentFailedAt: null,
  graceEndsAt: null,
};

/**
 * What Stripe says about one subscription RIGHT NOW, fetched from Stripe at
 * the moment of deciding (lib/stripe.ts). The rules never read the body of
 * a notification: a notification only says "look at this subscription",
 * which is why the order notifications arrive in does not matter.
 */
export type SubscriptionSnapshot = {
  subscriptionId: string;
  customerId: string;
  /** Stripe's own word: active, past_due, canceled, incomplete, incomplete_expired, unpaid, trialing, paused. */
  status: string;
  /** True only when the subscription's latest invoice is paid. */
  latestInvoicePaid: boolean;
  currentPeriodEnd: Date | null;
  /** When a scheduled cancellation takes effect, or null when none is scheduled. */
  cancelAt: Date | null;
  /** metadata.billingPlanId, which checkout puts on the subscription itself. */
  planId: string | null;
};

export type BillingDecision =
  /** Nothing to do, on purpose. `needsLook` flags it on /pulse/billing for a person to check. */
  | { kind: "ignored"; reason: string; needsLook: boolean }
  /**
   * `next` is the financial record as it should now be. `entries` are the
   * log sentences, one per real transition; empty when nothing a person
   * would care about changed (a renewal moving the period end, say).
   * `activatePlanId` is set when the first payment was just confirmed and
   * the accepted plan should take effect.
   */
  | { kind: "apply"; next: BillingFacts; entries: string[]; activatePlanId: string | null };

/** Statuses of ours in which the expected subscription is over or never started, so a new one may take its place. */
const REPLACEABLE: BillingStatus[] = ["NONE", "INCOMPLETE", "CANCELED"];

/** A date as the log shows it. UTC, so the same entry reads the same everywhere. */
function day(date: Date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Decide what one look at Stripe means for one clinic's financial record.
 *
 *   current     the record as it is (read under the clinic's row lock)
 *   snap        the subscription as Stripe reports it now
 *   now         the server's clock
 *   graceDays   the grace days setting, read in the same transaction
 *
 * Deciding the same snapshot twice gives "apply" with no entries and an
 * unchanged record the second time: that is what makes a repeated or
 * late notification harmless.
 */
export function decideBilling(current: BillingFacts, snap: SubscriptionSnapshot, now: Date, graceDays: unknown): BillingDecision {
  // Ownership. The clinic was found by the customer on the notification; the
  // subscription Stripe returned must belong to that same customer.
  if (!current.stripeCustomerId || snap.customerId !== current.stripeCustomerId) {
    return { kind: "ignored", reason: "The subscription belongs to a different Stripe customer than this clinic's.", needsLook: true };
  }

  let base = current;
  const entries: string[] = [];

  if (current.stripeSubscriptionId !== snap.subscriptionId) {
    // Not the subscription we expect. It may only take over when (a) the one
    // we expect is over or never started, (b) it carries the id of the plan
    // this clinic accepted and is waiting on, and (c) it is not already dead.
    const dead = snap.status === "canceled" || snap.status === "incomplete_expired";
    const carriesPendingPlan = current.pendingPlanId !== null && snap.planId === current.pendingPlanId;
    if (!carriesPendingPlan || dead) {
      // A subscription that is dead, or that nobody has paid, costs the clinic
      // nothing and is noise. One that is being CHARGED is different: it is on
      // this clinic's own customer, so the clinic is paying for something this
      // record does not recognise (most likely a checkout page from an earlier
      // attempt that was paid after a newer one was started). Nothing is
      // changed, because which plan it bought cannot be known from here, but a
      // person has to look.
      const charging = ["active", "past_due", "unpaid", "trialing"].includes(snap.status);
      return charging
        ? {
            kind: "ignored",
            reason:
              "Stripe is charging this clinic's customer for a subscription that is not the plan the clinic accepted last. Nothing was changed. Check Stripe: the clinic may have paid on a checkout page from an earlier attempt.",
            needsLook: true,
          }
        : { kind: "ignored", reason: "Not the subscription this clinic is expected to have.", needsLook: false };
    }
    if (!REPLACEABLE.includes(current.status)) {
      return {
        kind: "ignored",
        reason: "A second subscription exists in Stripe while this clinic's subscription is still live. Check Stripe: the clinic may be charged twice.",
        needsLook: true,
      };
    }
    // Take it on. Everything that belonged to the old subscription is dropped.
    base = { ...current, status: "NONE", stripeSubscriptionId: snap.subscriptionId, currentPeriodEnd: null, cancelAt: null, paymentFailedAt: null, graceEndsAt: null };
  }

  const next: BillingFacts = { ...base };
  let activatePlanId: string | null = null;
  const wasLive = base.status === "ACTIVE" || base.status === "PAST_DUE";

  switch (snap.status) {
    case "incomplete": {
      if (wasLive) return unsupported(snap.status);
      next.status = "INCOMPLETE";
      if (base.status !== "INCOMPLETE") entries.push("Checkout started. Waiting for the first payment to be confirmed; nothing opens because of this.");
      break;
    }

    case "incomplete_expired": {
      if (wasLive) return unsupported(snap.status);
      next.status = "NONE";
      next.stripeSubscriptionId = null;
      next.pendingPlanId = pendingPlanAfterDeath(base, snap);
      next.currentPeriodEnd = null;
      next.cancelAt = null;
      entries.push("The first payment was never completed, so the subscription did not start.");
      break;
    }

    case "active": {
      if (base.status === "ACTIVE") break; // already there; only the dates below may move
      if (!snap.latestInvoicePaid) {
        // Stripe says active, but no paid invoice proves it. For a new
        // subscription that is "not paid yet"; for a past-due one it means
        // the invoice was written off, which is not a recovery.
        if (base.status === "PAST_DUE") break;
        next.status = "INCOMPLETE";
        if (base.status !== "INCOMPLETE") entries.push("Checkout started. Waiting for the first payment to be confirmed; nothing opens because of this.");
        break;
      }
      if (base.status === "PAST_DUE") {
        next.status = "ACTIVE";
        next.paymentFailedAt = null;
        next.graceEndsAt = null;
        entries.push("Payment recovered. The subscription is active again.");
        break;
      }
      // First confirmed payment of this subscription.
      next.status = "ACTIVE";
      if (base.pendingPlanId) {
        activatePlanId = base.pendingPlanId;
        next.currentPlanId = base.pendingPlanId;
        next.pendingPlanId = null;
      }
      entries.push("First payment confirmed. The subscription is active.");
      break;
    }

    case "past_due":
    case "unpaid": {
      if (base.status === "PAST_DUE") break; // grace started once; a repeated failure never moves it
      if (base.status !== "ACTIVE") {
        // First seen already failing (we were never told it was active). It
        // must have been paid once to get here, so the plan takes effect,
        // and grace starts now, the first time the failure is recorded.
        if (base.pendingPlanId) {
          activatePlanId = base.pendingPlanId;
          next.currentPlanId = base.pendingPlanId;
          next.pendingPlanId = null;
        }
      }
      next.status = "PAST_DUE";
      next.paymentFailedAt = now;
      next.graceEndsAt = graceDeadline(now, graceDays);
      entries.push(
        next.graceEndsAt
          ? `A renewal payment failed. The grace period ends ${day(next.graceEndsAt)}.`
          : "A renewal payment failed. The grace days setting could not be read, so there is no grace period.",
      );
      break;
    }

    case "canceled": {
      if (base.status === "CANCELED") break;
      if (wasLive) {
        next.status = "CANCELED";
        entries.push("The subscription has ended.");
      } else {
        // Cancelled before it was ever paid: the clinic never became a customer.
        next.status = "NONE";
        next.stripeSubscriptionId = null;
        next.pendingPlanId = pendingPlanAfterDeath(base, snap);
        entries.push("The subscription was cancelled before the first payment, so it did not start.");
      }
      next.cancelAt = null;
      next.paymentFailedAt = null;
      next.graceEndsAt = null;
      break;
    }

    default:
      // trialing, paused, or a word Stripe adds later. We sell no trials and
      // never pause collection, so this can only come from a change made by
      // hand in Stripe. Nothing is changed; a person is asked to look.
      return unsupported(snap.status);
  }

  // The dates, for a subscription that is live after the above.
  if (next.status === "ACTIVE" || next.status === "PAST_DUE") {
    next.currentPeriodEnd = snap.currentPeriodEnd;
    const before = base.cancelAt?.getTime() ?? null;
    const after = snap.cancelAt?.getTime() ?? null;
    if (before !== after) {
      next.cancelAt = snap.cancelAt;
      entries.push(snap.cancelAt ? `Cancellation scheduled. The subscription stays active until ${day(snap.cancelAt)}.` : "The scheduled cancellation was removed.");
    }
  }

  return { kind: "apply", next, entries, activatePlanId };
}

/**
 * Which plan is still waiting for a first payment once a subscription that
 * was never paid has died (it expired, or was cancelled before paying).
 *
 * The plan that subscription was FOR is no longer waiting: nothing can pay
 * for it any more. But an admin may have started again in the meantime and
 * accepted a newer plan, which is now the one waiting, and a late notice
 * about the old attempt must not wipe it. If it did, the new checkout would
 * be paid and then not recognised, because the subscription it creates
 * carries a plan id this record no longer remembers. So the waiting plan is
 * only cleared when it is the very plan the dead subscription carried.
 */
function pendingPlanAfterDeath(base: BillingFacts, snap: SubscriptionSnapshot): string | null {
  return snap.planId !== null && snap.planId === base.pendingPlanId ? null : base.pendingPlanId;
}

function unsupported(status: string): BillingDecision {
  return {
    kind: "ignored",
    reason: `Stripe reports this subscription as "${status.slice(0, 40)}", which this app does not use. Nothing was changed. Check the subscription in Stripe.`,
    needsLook: true,
  };
}

/** True when two records are the same in every field the rules write. */
export function sameBillingFacts(a: BillingFacts, b: BillingFacts): boolean {
  const time = (date: Date | null) => date?.getTime() ?? null;
  return (
    a.status === b.status &&
    a.stripeCustomerId === b.stripeCustomerId &&
    a.stripeSubscriptionId === b.stripeSubscriptionId &&
    a.pendingPlanId === b.pendingPlanId &&
    a.currentPlanId === b.currentPlanId &&
    time(a.currentPeriodEnd) === time(b.currentPeriodEnd) &&
    time(a.cancelAt) === time(b.cancelAt) &&
    time(a.paymentFailedAt) === time(b.paymentFailedAt) &&
    time(a.graceEndsAt) === time(b.graceEndsAt)
  );
}

/** True while Stripe may still be charging for this record's subscription. */
export function hasLiveSubscription(status: BillingStatus): boolean {
  return status === "ACTIVE" || status === "PAST_DUE" || status === "INCOMPLETE";
}

// ---------------------------------------------------------------------------
// Who may pay by card
// ---------------------------------------------------------------------------

export type SelfServeReason = "practice-type-unknown" | "hospital" | "managed-by-pulse" | "closed-by-staff";

export type SelfServeEligibility = { eligible: true } | { eligible: false; reason: SelfServeReason };

/**
 * May this clinic buy a plan by card? Checkout asks this on the server
 * before it does anything, and again under the clinic's row lock before it
 * writes anything. A clinic that has not said what kind of practice it is
 * may not: it has to answer first, so a hospital is never sold a self-serve
 * plan by default. No clinic that existed before billing is assumed to be
 * eligible; they all start UNKNOWN.
 *
 * A clinic Pulse staff have paused or ended by hand may not either. What
 * staff set by hand wins over billing (the state table above), so its card
 * payment would be taken and the clinic would stay closed. It has to talk
 * to Pulse first. A clinic staff are holding OPEN may buy: its first
 * confirmed payment hands its access over to its payments.
 */
export function selfServeEligibility(clinic: { practiceType: PracticeType; managedByPulse: boolean; staffAccess?: StaffAccess | null }): SelfServeEligibility {
  if (clinic.managedByPulse) return { eligible: false, reason: "managed-by-pulse" };
  if (clinic.practiceType === "HOSPITAL") return { eligible: false, reason: "hospital" };
  if (clinic.practiceType !== "CLINIC") return { eligible: false, reason: "practice-type-unknown" };
  if (clinic.staffAccess === "PAUSED" || clinic.staffAccess === "CANCELED") return { eligible: false, reason: "closed-by-staff" };
  return { eligible: true };
}

/** Why a clinic cannot pay by card, as a sentence for the clinic's admin. */
export const SELF_SERVE_REFUSALS: Record<SelfServeReason, string> = {
  "practice-type-unknown": "Tell us first whether this is a clinic or a hospital. The question is at the top of this page.",
  hospital: "Hospitals and health systems are set up by Pulse 3D by agreement, so there is no card payment here.",
  "managed-by-pulse": "Your plan is managed by Pulse 3D, so there is nothing to pay for here.",
  "closed-by-staff": "Pulse 3D has paused this clinic by hand, so a card payment would not open it. Get in touch with Pulse 3D first.",
};

/** How each practice type reads on a screen and in the log. */
export const PRACTICE_TYPE_WORDS: Record<PracticeType, string> = {
  UNKNOWN: "Not answered yet",
  CLINIC: "Clinic or private practice",
  HOSPITAL: "Hospital or health system",
};

/** How each hand setting reads on a screen and in the log. */
export const STAFF_ACCESS_WORDS: Record<StaffAccess, string> = {
  OPEN: "Open",
  PAUSED: "Paused",
  CANCELED: "Canceled",
};

/** How each billing status reads on the staff screens. */
export const BILLING_STATUS_WORDS: Record<BillingStatus, string> = {
  NONE: "No subscription",
  INCOMPLETE: "Checkout not paid",
  ACTIVE: "Paid",
  PAST_DUE: "Payment failed",
  CANCELED: "Ended",
};
