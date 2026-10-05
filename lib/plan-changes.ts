import type { Category } from "@prisma/client";
import { selfServeEligibility } from "./billing-state";
import { PULSE_CONTACT_WORDS } from "./brand";
import { engineInterval, samePlanShape } from "./checkout-rules";
import {
  BillingRefusedError,
  PLAN_MOVED_MESSAGE,
  acceptPlanForChange,
  getCheckoutFacts,
  getPlanShape,
  reconcileSubscription,
  withPlanChangeLock,
  type AcceptedPlanInput,
  type CheckoutFacts,
} from "./db/billing";
import { listSellableCategories } from "./db/category-config";
import { getActivePricing, getPricingVersion } from "./db/pricing";
import {
  PLAN_CHANGES_CLOSED_MESSAGE,
  RENEWAL_REASON_WORDS,
  SAME_PLAN_MESSAGE,
  classifyPlanChange,
  planChangeBlock,
  reviewMomentIsUsable,
  type ChangeRequest,
  type ChangeSeen,
  type RenewalReason,
} from "./plan-change";
import { formatCents, quote, type PricingConfig } from "./pricing";
import { STRIPE_INVOICE_PREFIX, STRIPE_PORTAL_PREFIX, type FetchSubscription, type PlanGateway, type SubscriptionState } from "./stripe";

/**
 * Changing a plan that is being paid for, cancelling a change, and opening
 * Stripe's own billing page. SERVER ONLY. The timing rule (what starts now,
 * what waits for the renewal) is in lib/plan-change.ts; read that first.
 *
 * The rules this file holds to:
 *
 *   THE SERVER PRICES IT. The browser says what was picked. The price comes
 *   from the prices the clinic signed up at (the pricing version on its
 *   current plan), or from the active version when the owner asked to move
 *   to current prices. An existing customer is never moved to other prices
 *   by loading a page or by a notification: only by asking, seeing the new
 *   amount, and confirming.
 *
 *   NOBODY PAYS AN AMOUNT THEY DID NOT SEE. A change is reviewed first: the
 *   server works out what it comes to and, for a change that starts now,
 *   asks Stripe what it would charge today. Confirm sends back what was on
 *   screen. The server works all of it out again, asks Stripe again FOR THE
 *   SAME MOMENT, and if anything differs nothing is done.
 *
 *   STRIPE SAYS WHAT HAPPENED. This file never changes what a clinic has.
 *   It writes down the plan that was accepted, asks Stripe to make the
 *   change, and then runs the same reconcileSubscription the webhook runs,
 *   which applies what Stripe says is true now. An upgrade whose payment
 *   did not go through therefore changes nothing, however this request
 *   ends, and a scheduled change grants nothing until its date.
 *
 *   ONE CHANGE AT A TIME. The Stripe calls for one clinic run under the
 *   clinic's row lock (withPlanChangeLock), and begin by asking Stripe where
 *   the subscription stands. A second request finds what the first one did
 *   and is told so, instead of changing the plan a second time.
 *
 * The clinic id is always the signed-in account owner's own clinic, found
 * on the server (getBillingOwnerClinicId). Nothing here reads one from a form.
 */

export type PlanChangeDeps = {
  gateway: PlanGateway;
  /** How to ask Stripe where a subscription stands, for the reconcile afterwards (lib/stripe.ts; a stand-in in the tests). */
  fetchSubscription: FetchSubscription;
  /** Is card payment open on this deployment? (checkoutIsOpen in lib/stripe.ts.) */
  isOpen: boolean;
  now?: Date;
};

/** What a change comes to, for the review step and the result messages. */
export type ChangeSummary = {
  included: Category[];
  seats: number;
  interval: "MONTH" | "YEAR";
  perSeatCents: number;
  totalCents: number;
  fullLibrary: boolean;
  /** The pricing version it is quoted from: its id (sent back on Confirm) and its number (shown). */
  versionId: string;
  version: number;
};

export type ReviewResult =
  | {
      kind: "review";
      summary: ChangeSummary;
      /** Starts now: what Stripe will charge today, and the moment that was worked out for (whole seconds). */
      now: { dueNowCents: number; at: Date; renewsAt: Date | null } | null;
      /** Starts at the renewal: when, why, and whether it takes the place of a change already scheduled. */
      renewal: { at: Date | null; why: RenewalReason; words: string; replaces: boolean } | null;
    }
  | { kind: "same"; message: string }
  /** The total on the form is not the server's (prices changed, or the form was altered). Nothing done; show the message. */
  | { kind: "stale"; message: string }
  | { kind: "refused"; message: string };

export type ConfirmResult =
  /** The change is in force (an upgrade that was paid for). */
  | { kind: "changed"; message: string }
  /** The change is set for the renewal. */
  | { kind: "scheduled"; message: string; at: Date }
  /** The upgrade's payment did not go through. Nothing changed. `payUrl` is Stripe's page for paying it, when there is one. */
  | { kind: "payment-needed"; message: string; payUrl: string | null }
  | { kind: "stale"; message: string }
  | { kind: "same"; message: string }
  | { kind: "refused"; message: string };

const NOT_FOUND = "Your clinic could not be found. Try again in a moment.";
const REVIEW_AGAIN = "What this change comes to has moved since you reviewed it. Review it again.";

type Prepared =
  | { ok: false; result: { kind: "refused" | "same" | "stale"; message: string } }
  | {
      ok: true;
      clinic: CheckoutFacts;
      basePlanId: string;
      subscriptionId: string;
      input: Omit<AcceptedPlanInput, "acceptedById" | "acceptedByName">;
      summary: ChangeSummary;
      change: { timing: "now" } | { timing: "renewal"; why: RenewalReason };
    };

const refused = (message: string): Prepared => ({ ok: false, result: { kind: "refused", message } });

/**
 * Everything both steps (review, confirm) work out before Stripe is asked
 * anything: may this clinic change its plan, what the picked plan comes to
 * on the server's numbers, and whether it starts now or at the renewal.
 */
async function prepare(clinicId: string, request: ChangeRequest, deps: PlanChangeDeps): Promise<Prepared> {
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return refused(NOT_FOUND);

  const { facts } = clinic;
  const block = planChangeBlock({
    eligibility: selfServeEligibility(clinic),
    open: deps.isOpen,
    status: facts.status,
    hasCurrentPlan: clinic.currentPlan !== null,
    cancelAt: facts.cancelAt,
    pendingPlanId: facts.pendingPlanId,
  });
  if (block) return refused(block);
  const current = clinic.currentPlan;
  if (!current || !facts.stripeSubscriptionId) return refused("Your clinic has no subscription to change.");

  // The prices: the ones this clinic signed up at, unless the owner asked for the current ones.
  let config: PricingConfig;
  let version: { id: string; version: number };
  if (request.moveToCurrentPricing) {
    const active = await getActivePricing();
    if (active.source.kind !== "version") return refused(PLAN_CHANGES_CLOSED_MESSAGE);
    config = active.config;
    version = active.source.version;
  } else {
    const own = await getPricingVersion(current.pricingVersionId);
    if (!own || !own.config) return refused(`Your plan's prices could not be read, so it cannot be changed here right now. ${PULSE_CONTACT_WORDS}`);
    config = own.config;
    version = own;
  }

  // What may be on the changed plan: anything for sale now, and anything the
  // clinic already has (a category that came off sale is never taken away
  // from a clinic for that, and may be kept through a change).
  const sellable = [...new Set([...(await listSellableCategories()), ...current.entitledCategories])];
  const { selection } = request;
  const result = quote(config, {
    seats: selection.seats,
    categories: selection.categories,
    interval: engineInterval(selection.interval),
    // No founding offer has an approved rule, so none is ever applied (and the first plan never had one to preserve).
    founding: false,
    // A hospital was refused above; what gets this far is a clinic, including one Pulse staff never marked.
    practiceType: "clinic",
    sellable,
  });
  if (!result.ok) return refused(result.error);
  const amounts = result.quote.amounts;
  if (result.quote.band === "enterprise" || !amounts) {
    return refused(`More than ${config.seats.clinicMax} surgeon seats is set up by Pulse 3D by agreement, so there is no card payment for it here. ${PULSE_CONTACT_WORDS}`);
  }

  // Is that the total the owner was looking at?
  if (selection.seenVersionId !== version.id || selection.seenTotalCents !== amounts.totalCents) {
    return {
      ok: false,
      result: { kind: "stale", message: `The total on this page was out of date. This plan comes to ${formatCents(amounts.totalCents)} per ${amounts.interval}. Check it, then review the change again.` },
    };
  }

  const input = {
    pricingVersionId: version.id,
    categories: result.quote.selectedCategories,
    entitledCategories: result.quote.entitledCategories,
    surgeonSeats: selection.seats,
    interval: selection.interval,
    perSeatCents: amounts.perSeatCents,
    totalCents: amounts.totalCents,
  };
  const change = classifyPlanChange(current, input);
  if (change.timing === "same") return { ok: false, result: { kind: "same", message: SAME_PLAN_MESSAGE } };

  return {
    ok: true,
    clinic,
    basePlanId: current.id,
    subscriptionId: facts.stripeSubscriptionId,
    input,
    summary: {
      included: input.entitledCategories,
      seats: input.surgeonSeats,
      interval: input.interval,
      perSeatCents: input.perSeatCents,
      totalCents: input.totalCents,
      fullLibrary: result.quote.fullLibrary,
      versionId: version.id,
      version: version.version,
    },
    change,
  };
}

/**
 * Is the subscription, as Stripe has it NOW, the one this change was worked
 * out against? Returns a refusal sentence, or null when it is.
 */
function stateProblem(state: SubscriptionState | null, basePlanId: string, customerId: string | null): string | null {
  if (!state || state.customerId !== customerId) return "Stripe has no subscription for your clinic to change.";
  if (state.status !== "active") return "Your subscription is not paid up in Stripe right now, so its plan cannot be changed. Settle that first.";
  if (state.cancelAt) return "Your subscription is set to end. Keep it going first, then change your plan.";
  if (state.pending) return "A plan change is waiting for its payment. Pay for it or cancel it first.";
  if (state.planId !== basePlanId) return PLAN_MOVED_MESSAGE;
  return null;
}

const whole = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);

/**
 * Step one: what would this change do, and what would it cost? Changes
 * nothing anywhere. For a change that starts now, Stripe is asked what it
 * would charge today; that is the amount shown, to the cent.
 */
export async function reviewPlanChange(args: { clinicId: string; request: ChangeRequest; deps: PlanChangeDeps }): Promise<ReviewResult> {
  const { clinicId, request, deps } = args;
  const prepared = await prepare(clinicId, request, deps);
  if (!prepared.ok) return prepared.result;
  const { clinic, summary, change, basePlanId } = prepared;

  const state = await deps.gateway.getState(prepared.subscriptionId);
  const problem = stateProblem(state, basePlanId, clinic.facts.stripeCustomerId);
  if (problem || !state) return { kind: "refused", message: problem ?? NOT_FOUND };

  if (change.timing === "renewal") {
    return { kind: "review", summary, now: null, renewal: { at: state.periodEnd, why: change.why, words: RENEWAL_REASON_WORDS[change.why], replaces: Boolean(state.schedule?.next) } };
  }

  if (state.schedule?.next) {
    return { kind: "refused", message: "A change is already scheduled for your next renewal. Cancel that one first, then make this one." };
  }
  const at = whole(deps.now ?? new Date());
  const preview = await deps.gateway.previewUpgrade({ state, perSeatCents: summary.perSeatCents, interval: summary.interval, seats: summary.seats, at });
  return { kind: "review", summary, now: { dueNowCents: preview.dueNowCents, at, renewsAt: state.periodEnd }, renewal: null };
}

/**
 * Step two: make the change the owner reviewed.
 *
 *   1. Everything is worked out again, exactly as for the review.
 *   2. For a change that starts now, Stripe is asked again what it would
 *      charge, for the SAME moment as the review. A different amount stops
 *      here with nothing done.
 *   3. The accepted plan is written down (acceptPlanForChange, under the
 *      clinic's row lock, where the seat floor is checked).
 *   4. A Stripe price is made for that plan, marked with the plan's id.
 *   5. Under the clinic's row lock, Stripe is asked where the subscription
 *      stands, and only if it is still what this change was worked out
 *      against is Stripe asked to make the change.
 *   6. reconcileSubscription applies whatever Stripe now says.
 *
 * If this stops anywhere after step 3, what is left is harmless: a plan row
 * nothing points at, or a Stripe price nothing uses. If it stops after
 * Stripe has made the change (step 5), Stripe's own notification runs step 6.
 */
export async function confirmPlanChange(args: {
  clinicId: string;
  request: ChangeRequest;
  seen: ChangeSeen;
  actor: { id: string; name: string };
  deps: PlanChangeDeps;
}): Promise<ConfirmResult> {
  const { clinicId, request, seen, actor, deps } = args;
  const { gateway } = deps;
  const now = deps.now ?? new Date();

  const prepared = await prepare(clinicId, request, deps);
  if (!prepared.ok) return prepared.result;
  const { clinic, input, summary, change, basePlanId, subscriptionId } = prepared;
  const customerId = clinic.facts.stripeCustomerId;

  // The owner reviewed one kind of change; if it is now the other kind, they review again.
  if (seen.timing !== change.timing) return { kind: "stale", message: REVIEW_AGAIN };

  // Someone else's change may have got there first. If it is this very change (a double click, a second tab), it is done.
  const alreadyThere = async (state: SubscriptionState | null) => {
    if (!state || state.customerId !== customerId || state.pending || !state.planId || state.planId === basePlanId) return false;
    const there = await getPlanShape(clinicId, state.planId);
    return there !== null && samePlanShape(there, input);
  };
  const ALREADY: ConfirmResult = { kind: "changed", message: "That change has already been made." };

  if (change.timing === "now") {
    const first = await gateway.getState(subscriptionId);
    if (await alreadyThere(first)) return ALREADY;
    const problem = stateProblem(first, basePlanId, customerId);
    if (problem || !first) return { kind: "refused", message: problem ?? NOT_FOUND };
    if (!seen.at || seen.dueNowCents === null || !reviewMomentIsUsable(seen.at, now, first.periodStart)) return { kind: "stale", message: REVIEW_AGAIN };
    const preview = await gateway.previewUpgrade({ state: first, perSeatCents: input.perSeatCents, interval: input.interval, seats: input.surgeonSeats, at: seen.at });
    if (preview.dueNowCents !== seen.dueNowCents) return { kind: "stale", message: REVIEW_AGAIN };
  }

  const accepted: AcceptedPlanInput = { ...input, acceptedById: actor.id, acceptedByName: actor.name };
  let planId: string;
  try {
    planId = (await acceptPlanForChange(clinicId, accepted, { basePlanId, timing: change.timing })).planId;
  } catch (error) {
    if (error instanceof BillingRefusedError) return { kind: "refused", message: error.message };
    throw error;
  }

  // Made before the lock is taken: it changes nothing by existing, and asking twice gives the same price.
  const priceId = await gateway.ensurePrice({ planId, perSeatCents: input.perSeatCents, interval: input.interval });

  type Step = { kind: "refused"; message: string } | { kind: "already" } | { kind: "upgraded"; applied: boolean } | { kind: "scheduled"; at: Date };
  const step = await withPlanChangeLock<Step>(clinicId, async () => {
    let state = await gateway.getState(subscriptionId);
    if (await alreadyThere(state)) return { kind: "already" };
    const problem = stateProblem(state, basePlanId, customerId);
    if (problem || !state) return { kind: "refused", message: problem ?? NOT_FOUND };

    // A schedule whose change has already happened is still attached for the
    // rest of that period, with nothing left to do. Let it go first, so it is
    // not in the way (the subscription itself is untouched by that).
    if (state.schedule && !state.schedule.next) {
      await gateway.releaseSchedule(state.schedule.id);
      state = { ...state, schedule: null };
    }

    if (change.timing === "now") {
      if (state.schedule?.next) return { kind: "refused", message: "A change is already scheduled for your next renewal. Cancel that one first, then make this one." };
      const done = await gateway.applyUpgrade({ state, planId, priceId, seats: input.surgeonSeats, at: seen.at as Date });
      return { kind: "upgraded", applied: done.applied };
    }

    // The same change is already scheduled (a double click): nothing more to do.
    const waiting = state.schedule?.next?.planId ? await getPlanShape(clinicId, state.schedule.next.planId) : null;
    if (waiting && samePlanShape(waiting, input)) return { kind: "already" };
    const done = await gateway.scheduleChange({ state, planId, priceId, seats: input.surgeonSeats, interval: input.interval });
    return { kind: "scheduled", at: done.at };
  });

  if (step.kind === "refused") return step;

  // Whatever Stripe now says is what gets applied: the same rules the webhook runs.
  await reconcileSubscription({ clinicId, subscriptionId, fetchSubscription: deps.fetchSubscription, now: deps.now });

  const per = summary.interval === "YEAR" ? "year" : "month";
  if (step.kind === "already") return ALREADY;
  if (step.kind === "scheduled") {
    return { kind: "scheduled", at: step.at, message: `Scheduled. Your plan changes at your next renewal, to ${formatCents(summary.totalCents)} per ${per}. Nothing was charged today.` };
  }
  if (step.applied) return { kind: "changed", message: `Your plan has changed. It now comes to ${formatCents(summary.totalCents)} per ${per}.` };

  const after = await gateway.getState(subscriptionId);
  const payUrl = after?.pending ? (after.openInvoice?.payUrl ?? null) : null;
  return {
    kind: "payment-needed",
    payUrl: payUrl && payUrl.startsWith(STRIPE_INVOICE_PREFIX) ? payUrl : null,
    message: "The payment for this change did not go through, so your plan has not changed and you keep what you had. You can pay for it on Stripe's page, or cancel the change.",
  };
}

// ---------------------------------------------------------------------------
// Cancelling a change that has not happened yet
// ---------------------------------------------------------------------------

export type SimpleResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Cancel a change that is waiting: the one scheduled for the renewal
 * ("scheduled"), or an upgrade waiting for its payment ("payment"). The plan
 * in force is not touched by either. Safe to press twice: the second time
 * there is nothing waiting.
 */
export async function cancelWaitingChange(args: { clinicId: string; which: "scheduled" | "payment"; deps: PlanChangeDeps }): Promise<SimpleResult> {
  const { clinicId, which, deps } = args;
  const { gateway } = deps;
  if (!deps.isOpen) return { ok: false, message: PLAN_CHANGES_CLOSED_MESSAGE };
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return { ok: false, message: NOT_FOUND };
  if (clinic.managedByPulse) return { ok: false, message: "Your plan is managed by Pulse 3D, so there is nothing to change here." };
  const { stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId } = clinic.facts;
  if (!subscriptionId || !customerId) return { ok: false, message: "Your clinic has no subscription, so there is nothing to cancel." };

  const cancelled = await withPlanChangeLock(clinicId, async () => {
    const state = await gateway.getState(subscriptionId);
    if (!state || state.customerId !== customerId) return false;
    if (which === "scheduled") {
      if (!state.schedule?.next) return false;
      await gateway.releaseSchedule(state.schedule.id);
      return true;
    }
    // Voiding the unpaid invoice is how Stripe drops an upgrade it was holding back.
    if (!state.pending || !state.openInvoice) return false;
    await gateway.voidInvoice(state.openInvoice.id);
    return true;
  });

  await reconcileSubscription({ clinicId, subscriptionId, fetchSubscription: deps.fetchSubscription, now: deps.now });
  if (!cancelled) return { ok: true, message: "There was no change waiting, so nothing was cancelled." };
  return { ok: true, message: which === "scheduled" ? "The scheduled change was cancelled. Your plan stays as it is." : "The change was cancelled and nothing was charged for it. Your plan stays as it is." };
}

// ---------------------------------------------------------------------------
// Stripe's own pages: the billing page, and paying an unpaid invoice
// ---------------------------------------------------------------------------

export type LinkResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * A visit to Stripe's billing page for the clinic's own Stripe customer:
 * update the card, see invoices, cancel (or undo a cancellation). The
 * customer id is the one on the clinic's own record, never one from a form,
 * so a visit can only ever be to the signed-in owner's own clinic's account.
 *
 * Works for a clinic that is NOT open (past due, ended): it is how such a
 * clinic repairs its billing. Refused for a clinic Pulse manages.
 */
export async function openBillingPortal(args: { clinicId: string; origin: string; deps: PlanChangeDeps }): Promise<LinkResult> {
  const { clinicId, origin, deps } = args;
  const { gateway } = deps;
  if (!deps.isOpen) return { ok: false, message: PLAN_CHANGES_CLOSED_MESSAGE };
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return { ok: false, message: NOT_FOUND };
  if (clinic.managedByPulse) return { ok: false, message: "Your plan is managed by Pulse 3D and invoiced by agreement, so there is no card or invoice to manage here." };
  const { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, status } = clinic.facts;
  if (!customerId) return { ok: false, message: "Your clinic has not paid by card here, so there is nothing to manage yet." };

  // Stripe will not let a subscription be cancelled while a schedule is
  // attached to it. A schedule whose change has already happened has nothing
  // left to do, so it is let go here, before the visit.
  if (subscriptionId && (status === "ACTIVE" || status === "PAST_DUE")) {
    const state = await gateway.getState(subscriptionId);
    if (state && state.customerId === customerId && state.schedule && !state.schedule.next) await gateway.releaseSchedule(state.schedule.id);
  }

  const url = await gateway.createPortalSession({ customerId, returnUrl: `${origin}/admin/billing?from=stripe` });
  if (!url.startsWith(STRIPE_PORTAL_PREFIX)) throw new Error("Billing: Stripe returned a billing page with no usable address.");
  return { ok: true, url };
}

/**
 * Stripe's page for paying the clinic's unpaid invoice: a renewal that
 * failed, or an upgrade waiting for its payment. Paying there is what
 * recovers the clinic (or makes the upgrade happen); this only finds the page.
 */
export async function findInvoiceToPay(args: { clinicId: string; deps: PlanChangeDeps }): Promise<LinkResult> {
  const { clinicId, deps } = args;
  if (!deps.isOpen) return { ok: false, message: PLAN_CHANGES_CLOSED_MESSAGE };
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return { ok: false, message: NOT_FOUND };
  if (clinic.managedByPulse) return { ok: false, message: "Your plan is managed by Pulse 3D, so there is nothing to pay here." };
  const { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId } = clinic.facts;
  if (!customerId || !subscriptionId) return { ok: false, message: "Nothing is waiting to be paid." };

  const state = await deps.gateway.getState(subscriptionId);
  const url = state && state.customerId === customerId ? state.openInvoice?.payUrl : null;
  if (!url || !url.startsWith(STRIPE_INVOICE_PREFIX)) return { ok: false, message: "Nothing is waiting to be paid right now. If you have just paid, press Check with Stripe." };
  return { ok: true, url };
}
