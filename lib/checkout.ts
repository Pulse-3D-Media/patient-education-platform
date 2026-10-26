import { FIRST_PAYMENT_UNDER_WAY, SELF_SERVE_REFUSALS, selfServeEligibility, type BillingFacts } from "./billing-state";
import { engineInterval, sessionExpiresAt, type PlanSelection } from "./checkout-rules";
import {
  BillingRefusedError,
  acceptPlanForCheckout,
  getCheckoutFacts,
  reconcileSubscription,
  setStripeCustomer,
  type AcceptedPlanInput,
  type PurchaseAttempt,
} from "./db/billing";
import { labelsOf } from "./categories";
import { getCategoryList, libraryForQuote, listSellableCategories } from "./db/category-config";
import { getActivePricing } from "./db/pricing";
import { categoryLabel, formatCents, quote } from "./pricing";
import { PULSE_CONTACT_WORDS } from "./brand";
import type { CheckoutGateway, FetchSubscription } from "./stripe";
import { STRIPE_CHECKOUT_PREFIX } from "./stripe-pages";

/**
 * Self-serve checkout: everything between "an admin pressed Continue to
 * payment" and "here is the address of Stripe's payment page". SERVER ONLY.
 *
 * The rules this file holds to:
 *
 *   THE SERVER PRICES IT. The browser says what was picked. The price is
 *   worked out here, from the ACTIVE saved pricing version and the
 *   categories that are for sale right now, by the same engine the
 *   calculator uses (lib/pricing.ts). The built-in default prices are an
 *   estimate and are refused: checkout needs a version Pulse staff saved
 *   and made active.
 *
 *   NOBODY PAYS A TOTAL THEY DID NOT SEE. The form also says which pricing
 *   version and which total the admin was looking at. If either differs
 *   from what the server works out (prices were changed while the page was
 *   open, or the form was tampered with), nothing is created: the admin is
 *   shown the new total and has to press the button again. Once an attempt
 *   is written down, its payment page charges exactly that attempt's
 *   amounts even if prices change a minute later, and the page stops being
 *   payable after an hour.
 *
 *   ONE CUSTOMER, ONE PAGE, ONE SUBSCRIPTION. The clinic's Stripe customer
 *   is made once and stored before anything else. The attempt is written
 *   under the clinic's row lock, where an identical request finds the
 *   attempt already there (acceptPlanForCheckout). The payment page is made
 *   with a key built from the attempt's id, so Stripe hands identical
 *   requests the same page. Every other open page of this customer is
 *   closed, so an abandoned one cannot be paid later.
 *
 *   ONE FIRST PAYMENT AT A TIME. While Stripe still has a first payment
 *   under way for the clinic (paid by a method that takes time to clear, or
 *   not yet confirmed), no new checkout is started, here or under the lock.
 *   Otherwise both could end up paid, and the record waiting on the second
 *   while Stripe charges the first. The admin is told to wait for it to
 *   clear or for Stripe to drop it (decided with the security audit of
 *   2026-10-08; cancelling the first in Stripe was the alternative, and was
 *   not chosen, because a bank payment already in flight can still arrive
 *   for a subscription that has been cancelled).
 *
 *   NOTHING HERE OPENS A CLINIC. This file never touches a clinic's status,
 *   plan or access. Only the billing rules do that, from what Stripe itself
 *   says about the subscription (reconcileSubscription), whether the news
 *   arrives by webhook or is asked for with "Check again".
 *
 * The clinic id is always the signed-in admin's own clinic, found on the
 * server (getBillingClinicId). Nothing in this file reads one from a form.
 */

export type StartCheckoutResult =
  /** Send the admin to this Stripe address. */
  | { kind: "redirect"; url: string }
  /** The total is not the one the admin saw. Nothing was created; show the message and let them press again. */
  | { kind: "changed"; message: string }
  /** The payment page for this attempt was already paid. Send them to the return page, which confirms it. */
  | { kind: "confirming" }
  /** Not allowed, or not possible right now. A plain sentence. */
  | { kind: "refused"; message: string };

export type CheckoutDeps = {
  gateway: CheckoutGateway;
  /** How to ask Stripe where one subscription stands now (fetchSubscriptionSnapshot in lib/stripe.ts), for bringing the record into line before a new checkout. */
  fetchSubscription: FetchSubscription;
  /** Is checkout open on this deployment? (checkoutIsOpen in lib/stripe.ts.) */
  isOpen: boolean;
  now?: Date;
};

export const CHECKOUT_CLOSED_MESSAGE = "Choosing a plan here is not open yet. Until it is, Pulse 3D sets clinics up by hand.";

export async function startCheckout(args: {
  clinicId: string;
  selection: PlanSelection;
  actor: { id: string; name: string };
  /** A trusted origin for Stripe's return addresses (lib/trusted-origin.ts). */
  origin: string;
  deps: CheckoutDeps;
}): Promise<StartCheckoutResult> {
  const { clinicId, selection, actor, origin, deps } = args;
  const { gateway } = deps;

  if (!deps.isOpen) return { kind: "refused", message: CHECKOUT_CLOSED_MESSAGE };

  // 1. Who is asking. Checked here for a quick, clear answer, and again under
  //    the clinic's row lock before anything is written (acceptPlanForCheckout).
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return { kind: "refused", message: "Your clinic could not be found. Try again in a moment." };
  const eligibility = selfServeEligibility(clinic);
  if (!eligibility.eligible) return { kind: "refused", message: SELF_SERVE_REFUSALS[eligibility.reason] };
  if (clinic.facts.status === "ACTIVE" || clinic.facts.status === "PAST_DUE") {
    return { kind: "refused", message: ALREADY_SUBSCRIBED };
  }

  // 1b. A first payment still under way. Stripe is asked, because our record
  //     can be behind it (a notification that has not arrived yet). Nothing
  //     new is started while one is: a second checkout could be paid
  //     alongside the first, and the clinic charged twice.
  if (clinic.facts.stripeCustomerId) {
    const underWay = await paymentUnderWay({ clinicId, facts: clinic.facts, customerId: clinic.facts.stripeCustomerId, deps });
    if (underWay === "paid") return { kind: "confirming" };
    if (underWay === "subscribed") return { kind: "refused", message: ALREADY_SUBSCRIBED };
    if (underWay === "waiting") return { kind: "refused", message: FIRST_PAYMENT_UNDER_WAY };
  }

  // 2. The price, from the server's own numbers.
  const pricing = await getActivePricing();
  if (pricing.source.kind !== "version") return { kind: "refused", message: CHECKOUT_CLOSED_MESSAGE };
  const version = pricing.source.version;
  const [sellable, list, library] = await Promise.all([listSellableCategories(), getCategoryList(), libraryForQuote()]);
  const labels = labelsOf(list);
  const result = quote(pricing.config, {
    seats: selection.seats,
    categories: selection.categories,
    interval: engineInterval(selection.interval),
    // No founding offer has an approved rule for who gets it or for how long,
    // so checkout never applies one. Nothing the browser sends can ask for it.
    founding: false,
    // A hospital was refused above (selfServeEligibility), so what gets
    // this far is a clinic, including one Pulse staff never marked (UNKNOWN).
    practiceType: "clinic",
    sellable,
    labels,
    library,
  });
  if (!result.ok) return { kind: "refused", message: result.error };
  const amounts = result.quote.amounts;
  if (result.quote.band === "enterprise" || !amounts) {
    return {
      kind: "refused",
      message: `More than ${pricing.config.seats.clinicMax} surgeon seats is set up by Pulse 3D by agreement, so there is no card payment for it here. ${PULSE_CONTACT_WORDS}`,
    };
  }

  // 3. Is that the total the admin was looking at?
  if (selection.seenVersionId !== version.id || selection.seenTotalCents !== amounts.totalCents) {
    return {
      kind: "changed",
      message: `The total on this page was out of date. This plan comes to ${formatCents(amounts.totalCents)} per ${amounts.interval}. Check it, then continue.`,
    };
  }

  // 4. The clinic's one Stripe customer, on file before anything else exists
  //    in Stripe, so news about the purchase can always find its clinic.
  let customerId = clinic.facts.stripeCustomerId;
  if (!customerId) {
    const made = await gateway.createCustomer({ clinicId, clinicName: clinic.name });
    try {
      await setStripeCustomer(clinicId, made);
      customerId = made;
    } catch (error) {
      if (!(error instanceof BillingRefusedError)) throw error;
      // Another request put a customer on file first. That one is the clinic's.
      customerId = (await getCheckoutFacts(clinicId))?.facts.stripeCustomerId ?? null;
      if (!customerId) throw error;
    }
  }

  // 5. The attempt, written once (an identical recent one is found instead).
  const input: AcceptedPlanInput = {
    pricingVersionId: version.id,
    categories: result.quote.selectedCategories,
    entitledCategories: result.quote.entitledCategories,
    fullLibrary: result.quote.fullLibrary,
    surgeonSeats: selection.seats,
    interval: selection.interval,
    perSeatCents: amounts.perSeatCents,
    totalCents: amounts.totalCents,
    acceptedById: actor.id,
    acceptedByName: actor.name,
  };
  // What Stripe shows on the subscription and its invoices. It uses the categories' STARTING names on
  // purpose, not the names Pulse staff may have given them: Stripe keeps the description it is given
  // first, and refuses a repeated request (the same idempotency key, step 6) whose words differ, so a
  // rename between a first try and a retry would otherwise make the retry fail. Our own screens show
  // the current names.
  const description = result.quote.fullLibrary
    ? `Full library, ${seatWords(selection.seats)}`
    : `${result.quote.selectedCategories.map((category) => categoryLabel(category)).join(", ")}; ${seatWords(selection.seats)}`;

  let attempt: PurchaseAttempt;
  try {
    // No clock is handed in outside the tests: the attempt writer reads it under the clinic's row lock.
    attempt = await acceptPlanForCheckout(clinicId, input, { now: deps.now });
  } catch (error) {
    if (error instanceof BillingRefusedError) return { kind: "refused", message: error.message };
    throw error;
  }

  // 6. The payment page for that attempt: the open one if there is one,
  //    otherwise a new one.
  const pageFor = (planId: string, createdAt: Date) =>
    gateway.createSession({
      customerId: customerId as string,
      clinicId,
      planId,
      perSeatCents: input.perSeatCents,
      seats: input.surgeonSeats,
      interval: input.interval,
      description,
      origin,
      expiresAt: sessionExpiresAt(createdAt),
    });

  const open = await gateway.listOpenSessions(customerId);
  let session = open.find((candidate) => candidate.planId === attempt.planId && candidate.url) ?? null;
  if (!session) {
    session = await pageFor(attempt.planId, attempt.createdAt);
    if (attempt.reused) {
      // Stripe answers a repeated request with what it answered the first
      // time, so for an attempt used again, ask where its page stands NOW.
      const current = await gateway.getSession(session.id);
      if (current?.status === "complete") return { kind: "confirming" };
      if (!current || current.status !== "open" || !current.url) {
        // Its page has closed and cannot be paid. Start a fresh attempt.
        attempt = await acceptPlanForCheckout(clinicId, input, { now: deps.now, forceNew: true });
        session = await pageFor(attempt.planId, attempt.createdAt);
      } else {
        session = current;
      }
    }
  }

  // 7. Two tabs with DIFFERENT picks can both get this far. Only the attempt
  //    the clinic's record is waiting on may stay payable: a page for any
  //    other attempt would be paid and then not recognised.
  const after = await getCheckoutFacts(clinicId);
  if (after?.facts.pendingPlanId !== attempt.planId) {
    await gateway.expireSession(session.id);
    return { kind: "refused", message: "Another checkout was started for your clinic a moment ago, so this one was closed. Reload this page and carry on from there." };
  }
  for (const other of await gateway.listOpenSessions(customerId)) {
    if (other.id !== session.id) await gateway.expireSession(other.id);
  }

  if (!session.url || !session.url.startsWith(STRIPE_CHECKOUT_PREFIX)) {
    throw new Error("Checkout: Stripe returned a payment page with no usable address.");
  }
  return { kind: "redirect", url: session.url };
}

function seatWords(seats: number) {
  return `${seats} surgeon ${seats === 1 ? "seat" : "seats"}`;
}

const ALREADY_SUBSCRIBED = "Your clinic already has a subscription, so a second one was not started.";

/** Stripe's words for a subscription that is over or never started. Neither can be paid any more. */
const isDead = (status: string) => status === "canceled" || status === "incomplete_expired";

/**
 * Which of a customer's subscriptions to bring the clinic's record into line
 * with: the one for the plan the clinic is waiting on, else the one already
 * on record. Anything else on the customer is not ours to apply (the
 * webhook flags it for a person when it is being charged).
 */
function subscriptionToCheck(facts: BillingFacts, subscriptions: { id: string; planId: string | null; status: string }[]) {
  return (
    subscriptions.find((subscription) => facts.pendingPlanId !== null && subscription.planId === facts.pendingPlanId && !isDead(subscription.status)) ??
    subscriptions.find((subscription) => subscription.id === facts.stripeSubscriptionId)
  );
}

/**
 * Before a new checkout: is a payment for this clinic already under way in
 * Stripe? The record is brought into line first (the same reconcile the
 * webhook runs, which grants only what Stripe says was paid), so the answer,
 * and the Billing page after it, are up to date.
 *
 *   "paid"        the earlier payment has just been confirmed: send the
 *                 admin to the return page, which says so
 *   "subscribed"  the clinic has a subscription (a failed renewal, say)
 *   "waiting"     a first payment is still under way, or Stripe has a
 *                 subscription for the clinic that is neither started nor dead
 *   null          nothing under way: carry on
 */
async function paymentUnderWay(args: { clinicId: string; facts: BillingFacts; customerId: string; deps: CheckoutDeps }) {
  const { clinicId, facts, customerId, deps } = args;
  const subscriptions = await deps.gateway.listSubscriptions(customerId);
  const alive = subscriptions.filter((subscription) => !isDead(subscription.status));
  if (alive.length === 0 && facts.status !== "INCOMPLETE") return null;

  const target = subscriptionToCheck(facts, subscriptions);
  if (target) await reconcileSubscription({ clinicId, subscriptionId: target.id, fetchSubscription: deps.fetchSubscription, now: deps.now });

  const after = (await getCheckoutFacts(clinicId))?.facts.status;
  if (after === "ACTIVE") return "paid";
  if (after === "PAST_DUE") return "subscribed";
  if (after === "INCOMPLETE" || alive.length > 0) return "waiting";
  return null;
}

// ---------------------------------------------------------------------------
// "Check again": ask Stripe, rather than wait for Stripe to tell us
// ---------------------------------------------------------------------------

export type CheckPaymentResult = {
  /** What the clinic's billing record says after the check. */
  status: "ACTIVE" | "INCOMPLETE" | "NONE" | "PAST_DUE" | "CANCELED";
  message: string;
};

/**
 * Bring one clinic's billing into line with Stripe on request, for when the
 * notification Stripe sends is late or cannot reach this deployment at all
 * (a preview behind Vercel's sign-in, a developer's computer).
 *
 * It grants nothing by itself. It finds the clinic's own subscription in
 * Stripe (through the clinic's own customer id, from the server's record)
 * and runs the very same reconcileSubscription the webhook runs, which
 * activates a plan only when Stripe says the subscription is active AND its
 * latest invoice is paid. Pressing it twice, or after the webhook already
 * did the work, changes nothing and logs nothing.
 */
export async function checkPayment(args: {
  clinicId: string;
  gateway: CheckoutGateway;
  fetchSubscription: FetchSubscription;
  now?: Date;
}): Promise<CheckPaymentResult> {
  const { clinicId, gateway, fetchSubscription } = args;
  const clinic = await getCheckoutFacts(clinicId);
  if (!clinic) return { status: "NONE", message: "Your clinic could not be found. Try again in a moment." };
  const { facts } = clinic;
  if (!facts.stripeCustomerId) return { status: facts.status, message: "No checkout has been started for your clinic, so there is nothing to check." };

  // The subscription to look at: the one for the plan the clinic is waiting
  // on, else the one already on record (subscriptionToCheck).
  const target = subscriptionToCheck(facts, await gateway.listSubscriptions(facts.stripeCustomerId));

  if (!target) {
    return { status: facts.status, message: "Stripe has no payment for your clinic yet. If you have just paid, give it a minute and check again." };
  }

  await reconcileSubscription({ clinicId, subscriptionId: target.id, fetchSubscription, now: args.now });

  const after = (await getCheckoutFacts(clinicId))?.facts.status ?? facts.status;
  const messages: Record<CheckPaymentResult["status"], string> = {
    ACTIVE: "Payment confirmed.",
    INCOMPLETE: "Stripe has not confirmed the payment yet. Nothing has opened, and nothing will until it does.",
    NONE: "Stripe has no confirmed payment for your clinic.",
    PAST_DUE: "Your last payment did not go through.",
    CANCELED: "That subscription has ended.",
  };
  return { status: after, message: messages[after] };
}
