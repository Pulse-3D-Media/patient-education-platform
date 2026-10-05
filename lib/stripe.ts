import Stripe from "stripe";
import type { SubscriptionSnapshot } from "./billing-state";
import { STRIPE_INVOICE_PREFIX, STRIPE_PORTAL_PREFIX } from "./stripe-pages";

/**
 * The only file that talks to Stripe. SERVER ONLY: it reads the secret key,
 * so nothing that runs in the browser may import it (rule 8 in CLAUDE.md).
 *
 * What the Stripe package ("stripe", Stripe's own library for Node) is used
 * for here:
 *
 *   - checking that a notification really came from Stripe (its signature,
 *     worked out over the exact bytes Stripe sent);
 *   - asking Stripe where one subscription stands right now;
 *   - checkout: making the clinic's one Stripe customer, and making, finding
 *     and closing the Stripe-hosted payment pages;
 *   - plan changes: previewing and making an upgrade, scheduling a change
 *     for the next renewal, cancelling either, and opening Stripe's own
 *     billing page for cards, invoices and cancelling (the bottom of this
 *     file).
 *
 * TEST MODE ONLY. Until launch the app refuses a live key outright: a key
 * that does not start with "sk_test_" (or "rk_test_", a restricted test key)
 * is treated as missing configuration. Going live is a deliberate change to
 * this file, made in its own reviewed step, not a value someone pastes into
 * Vercel.
 *
 * Two environment variables, both in .env and in Vercel, never in code:
 *
 *   STRIPE_SECRET_KEY       the test secret key
 *   STRIPE_WEBHOOK_SECRET   the signing secret of the webhook endpoint
 *                           (whsec_...), or the one `stripe listen` prints
 */

/** Thrown when Stripe is not set up (or is set up with a live key). The message never contains a key. */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

/** Is this a key the app will use? Test keys only. */
export function isTestSecretKey(key: string | undefined): key is string {
  return typeof key === "string" && (key.startsWith("sk_test_") || key.startsWith("rk_test_"));
}

let client: Stripe | null = null;

/** The Stripe client, made on first use. Throws a StripeConfigError when the key is missing or is not a test key. */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeConfigError("STRIPE_SECRET_KEY is not set.");
  if (!isTestSecretKey(key)) throw new StripeConfigError("STRIPE_SECRET_KEY is not a test key. This app only runs Stripe in test mode.");
  client = new Stripe(key, {
    // Bounded, because the call happens while a clinic's row is locked (see
    // reconcileSubscription in lib/db/billing.ts): a slow Stripe must fail
    // the attempt, not hang it. Stripe sends the notification again.
    timeout: 8000,
    maxNetworkRetries: 1,
  });
  return client;
}

/** The webhook signing secret. Throws a StripeConfigError when it is missing. */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith("whsec_")) throw new StripeConfigError("STRIPE_WEBHOOK_SECRET is not set.");
  return secret;
}

/**
 * Check a notification's signature against the exact text Stripe sent and
 * return the event. Throws when the signature is wrong, missing, or older
 * than Stripe's five-minute tolerance. No network call: this is arithmetic
 * on the body and the secret, so it works without a secret KEY, which is
 * why it builds its own bare client rather than calling getStripe().
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string): Stripe.Event {
  if (!signatureHeader) throw new Error("No Stripe-Signature header.");
  return verifier().webhooks.constructEvent(rawBody, signatureHeader, secret);
}

let bare: Stripe | null = null;
function verifier(): Stripe {
  // The key given here is never sent anywhere: constructEvent makes no request.
  bare ??= new Stripe("sk_test_signature_check_only");
  return bare;
}

/** The customer and subscription a notification is about. Nothing else from its body is ever used. */
export type EventRefs = { customerId: string | null; subscriptionId: string | null };

/** The kinds of notification the app acts on. Every other kind is answered and dropped without being stored. */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // An upgrade that was waiting for its payment: paid, or given up on.
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  // A change scheduled for the next renewal: made, replaced, cancelled, or finished.
  "subscription_schedule.created",
  "subscription_schedule.updated",
  "subscription_schedule.released",
  "subscription_schedule.canceled",
  "subscription_schedule.completed",
] as const;

export function isHandledEventType(type: string): boolean {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/** "cus_123" from either an id or an expanded object. */
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/**
 * Pull the customer id and the subscription id out of a notification, and
 * nothing else. Works on the object's plain shape rather than Stripe's
 * types, because the shape of a notification follows the API version set on
 * the webhook endpoint, which may be older or newer than this library: an
 * invoice names its subscription at `parent.subscription_details.subscription`
 * since the 2025 "basil" versions and at `subscription` before them.
 */
export function eventRefs(event: { type: string; data: { object: unknown } }): EventRefs {
  const object = (event.data.object ?? {}) as Record<string, unknown>;
  const customerId = idOf(object.customer);

  if (event.type.startsWith("customer.subscription.")) {
    return { customerId, subscriptionId: idOf(object.id) };
  }
  if (event.type.startsWith("invoice.")) {
    const parent = object.parent as { subscription_details?: { subscription?: unknown } | null } | null | undefined;
    const subscriptionId = idOf(parent?.subscription_details?.subscription) ?? idOf(object.subscription);
    return { customerId, subscriptionId };
  }
  if (event.type.startsWith("checkout.session.")) {
    return { customerId, subscriptionId: idOf(object.subscription) };
  }
  if (event.type.startsWith("subscription_schedule.")) {
    // A schedule that has let go of its subscription names it under released_subscription.
    return { customerId, subscriptionId: idOf(object.subscription) ?? idOf(object.released_subscription) };
  }
  return { customerId, subscriptionId: null };
}

/** The key checkout puts on the subscription's own metadata to say which accepted plan it is for. */
export const PLAN_METADATA_KEY = "billingPlanId";

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/** The accepted plan's id from a piece of metadata this server wrote, or null. */
function planIdIn(metadata: Record<string, string> | null | undefined): string | null {
  const planId = metadata?.[PLAN_METADATA_KEY];
  return typeof planId === "string" && planId ? planId : null;
}

/**
 * The change a subscription's schedule will make at the next renewal: the
 * first phase that starts when the current one ends. Null when there is no
 * schedule, or the schedule has nothing left to change (its last phase is
 * the one running now).
 */
function nextPhaseOf(schedule: Stripe.SubscriptionSchedule | string | null | undefined): { planId: string | null; at: Date } | null {
  if (!schedule || typeof schedule === "string") return null;
  if (schedule.status !== "active" && schedule.status !== "not_started") return null;
  const currentEnd = schedule.current_phase?.end_date;
  if (typeof currentEnd !== "number") return null;
  const next = schedule.phases.find((phase) => phase.start_date >= currentEnd);
  const at = fromUnix(next?.start_date);
  if (!next || !at) return null;
  return { planId: planIdIn(next.metadata), at };
}

/**
 * Reduce a subscription, as Stripe returns it with its latest invoice
 * expanded, to the few facts the rules read. Pure, so the tests feed it
 * made-up subscriptions.
 */
export function snapshotFromSubscription(subscription: Stripe.Subscription): SubscriptionSnapshot | null {
  const customerId = idOf(subscription.customer);
  if (!customerId) return null;

  const invoice = subscription.latest_invoice;
  const latestInvoicePaid = typeof invoice === "object" && invoice !== null && invoice.status === "paid";

  // The period now lives on the subscription's items. With one price there is
  // one item; with several, the earliest end is the honest one.
  const ends = (subscription.items?.data ?? []).map((item) => item.current_period_end).filter((end) => typeof end === "number");
  const currentPeriodEnd = ends.length > 0 ? fromUnix(Math.min(...ends)) : null;

  const cancelAt = fromUnix(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? currentPeriodEnd : null);

  // Plan changes. A price made for a plan change carries that plan's id; the
  // price a first checkout made carries none, so itemPlanId is null until a
  // subscription has been through a change.
  const item = subscription.items?.data?.[0];
  const pendingItem = subscription.pending_update?.subscription_items?.[0];
  const nextPhase = nextPhaseOf(subscription.schedule);

  return {
    subscriptionId: subscription.id,
    customerId,
    status: subscription.status,
    latestInvoicePaid,
    currentPeriodEnd,
    cancelAt,
    planId: planIdIn(subscription.metadata),
    itemPlanId: planIdIn(item?.price?.metadata),
    pendingPlanId: planIdIn(pendingItem?.price?.metadata),
    scheduledPlanId: nextPhase?.planId ?? null,
    scheduledAt: nextPhase?.planId ? nextPhase.at : null,
  };
}

/** How the database layer asks for a subscription's current state. A parameter there, so tests hand in a stand-in. */
export type FetchSubscription = (subscriptionId: string) => Promise<SubscriptionSnapshot | null>;

/**
 * Where one subscription stands in Stripe right now. Null when Stripe has
 * no such subscription (or it is a live-mode one, which a test key cannot
 * see). Any other failure throws, and the attempt is tried again later.
 */
export const fetchSubscriptionSnapshot: FetchSubscription = async (subscriptionId) => {
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice", "schedule"] });
    if (subscription.livemode) return null;
    return snapshotFromSubscription(subscription);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return null;
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Is self-serve checkout open on this deployment?
 *
 * While the app runs Stripe in TEST MODE ONLY, a "purchase" is paid for with
 * Stripe's public test card, which anybody can type. If that were offered on
 * the production site, anyone could sign up and open a clinic for nothing.
 * So test-mode checkout needs three things, all of them:
 *
 *   1. BILLING_CHECKOUT is set to exactly "test" (it is off unless someone
 *      turns it on, for a preview or on their own computer);
 *   2. the Stripe key is a test key;
 *   3. this is NOT Vercel's production deployment, whatever (1) says. Vercel
 *      sets VERCEL_ENV itself; a value pasted into the Production settings
 *      by mistake cannot open checkout there.
 *
 * Opening checkout to real customers is part of going live: a deliberate,
 * reviewed change to this function, together with the live keys.
 */
export function checkoutIsOpen(env: Record<string, string | undefined> = process.env): boolean {
  if (env.BILLING_CHECKOUT !== "test") return false;
  if (!isTestSecretKey(env.STRIPE_SECRET_KEY)) return false;
  if (env.VERCEL_ENV === "production") return false;
  return true;
}

/** The one product every plan is sold as. Made once in Stripe, under this fixed id, the first time it is needed. */
export const PRODUCT_ID = "p3d_patient_education_library";
const PRODUCT_NAME = "Pulse 3D Patient Education Library";

/** The key on a Stripe customer and on a checkout page that says which clinic it is for. Written by this server, never read from a browser. */
export const CLINIC_METADATA_KEY = "clinicId";

/** What the checkout flow needs to know about one Stripe-hosted payment page. */
export type CheckoutSessionInfo = {
  id: string;
  /** Where to send the admin. Null once the page is no longer payable. */
  url: string | null;
  /** Stripe's word: open, complete or expired. */
  status: string;
  /** The accepted plan this page is for (metadata this server wrote when it made the page). */
  planId: string | null;
};

/** What a payment page is made from. Every amount comes from an accepted BillingPlan row, never from a form. */
export type CheckoutSessionArgs = {
  customerId: string;
  clinicId: string;
  planId: string;
  /** What ONE seat costs for ONE interval, in cents: a month's price for MONTH, the whole year's price for YEAR. */
  perSeatCents: number;
  seats: number;
  interval: "MONTH" | "YEAR";
  /** One line for the invoice: what the plan includes. */
  description: string;
  /** A trusted origin (lib/trusted-origin.ts), such as https://example.vercel.app. */
  origin: string;
  expiresAt: Date;
};

/**
 * The exact request a payment page is made with. Pure, so the tests read
 * the amounts straight off it.
 *
 *   - One line: the per-seat amount for the interval as the unit price, and
 *     the seats as the quantity. Stripe multiplies the two, which is the one
 *     multiplication the pricing engine does, so the totals agree to the cent.
 *   - A yearly plan is a YEARLY price of the whole year's amount. It is never
 *     the monthly amount with "year" written on it.
 *   - The quantity cannot be changed on Stripe's page, no promotion codes, no
 *     trial. The payment method type asked for is "card" and nothing else, so
 *     no bank debit that settles days later is requested. Stripe's page can
 *     still offer the card wallets and Link (including Link's bank option)
 *     that are switched on in the Stripe ACCOUNT's own settings: seen on the
 *     real test-mode page. That is a Stripe setting, not something this
 *     request controls. Whatever is used, nothing opens until the
 *     subscription's invoice is PAID (lib/billing-state.ts).
 *   - The plan id goes on the SUBSCRIPTION's own metadata. That is the only
 *     place the webhook looks (lib/billing-state.ts): metadata on the page
 *     itself does not travel to subscription notifications.
 *   - No tax is collected or calculated. That is a decision still to be made
 *     before live payments, not one to slip in here.
 */
export function checkoutSessionParams(args: CheckoutSessionArgs): Stripe.Checkout.SessionCreateParams {
  const metadata = { [PLAN_METADATA_KEY]: args.planId, [CLINIC_METADATA_KEY]: args.clinicId };
  return {
    mode: "subscription",
    customer: args.customerId,
    client_reference_id: args.clinicId,
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: args.seats,
        price_data: {
          currency: "usd",
          product: PRODUCT_ID,
          unit_amount: args.perSeatCents,
          recurring: { interval: args.interval === "YEAR" ? "year" : "month", interval_count: 1 },
        },
      },
    ],
    subscription_data: { metadata, description: args.description.slice(0, 480) },
    metadata,
    success_url: `${args.origin}/admin/billing/return`,
    cancel_url: `${args.origin}/admin/billing?checkout=cancelled`,
    expires_at: Math.floor(args.expiresAt.getTime() / 1000),
  };
}

function sessionInfo(session: Stripe.Checkout.Session): CheckoutSessionInfo {
  const planId = session.metadata?.[PLAN_METADATA_KEY];
  return { id: session.id, url: session.url ?? null, status: session.status ?? "", planId: typeof planId === "string" && planId ? planId : null };
}

function isStripeRequestError(error: unknown, code?: string): boolean {
  return error instanceof Stripe.errors.StripeInvalidRequestError && (code === undefined || error.code === code);
}

let productReady = false;

/** Make sure the one product exists. Asked for by its fixed id, so two first checkouts at the same moment end with one product. */
async function ensureProduct(): Promise<void> {
  if (productReady) return;
  const stripe = getStripe();
  try {
    await stripe.products.retrieve(PRODUCT_ID);
  } catch (error) {
    if (!isStripeRequestError(error, "resource_missing")) throw error;
    try {
      await stripe.products.create({ id: PRODUCT_ID, name: PRODUCT_NAME });
    } catch (createError) {
      if (!isStripeRequestError(createError, "resource_already_exists")) throw createError;
    }
  }
  productReady = true;
}

/**
 * Everything checkout asks of Stripe. A plain object of functions so the
 * checkout flow (lib/checkout.ts) takes it as a parameter and the tests
 * hand in a stand-in, the same way reconcileSubscription takes its fetch.
 */
export type CheckoutGateway = {
  /** Make the clinic's Stripe customer and return its id. Asking twice for the same clinic gives the same customer. */
  createCustomer(args: { clinicId: string; clinicName: string }): Promise<string>;
  /** The payment pages of this customer that can still be paid. */
  listOpenSessions(customerId: string): Promise<CheckoutSessionInfo[]>;
  /** Close a payment page so it can never be paid. Closing one that is already closed is not an error. */
  expireSession(sessionId: string): Promise<void>;
  /** Make the payment page for one accepted plan. Asking twice for the same plan gives the same page. */
  createSession(args: CheckoutSessionArgs): Promise<CheckoutSessionInfo>;
  /** One payment page as it stands now, or null when Stripe has none by that id. */
  getSession(sessionId: string): Promise<CheckoutSessionInfo | null>;
  /** This customer's subscriptions, newest first: which plan each carries and where Stripe says it stands. */
  listSubscriptions(customerId: string): Promise<{ id: string; planId: string | null; status: string }[]>;
};

/**
 * The real gateway. Two of its calls carry an idempotency key, which is
 * Stripe's own guard against doing the same thing twice: a second request
 * with the same key gets the first one's answer instead of a second
 * customer or a second payment page. The keys are built from our own ids
 * (the clinic, the accepted plan), so a double click, a retry after a lost
 * connection and a second browser tab all arrive with the same key.
 */
export const stripeGateway: CheckoutGateway = {
  async createCustomer({ clinicId, clinicName }) {
    const customer = await getStripe().customers.create(
      { name: clinicName.slice(0, 200), metadata: { [CLINIC_METADATA_KEY]: clinicId } },
      { idempotencyKey: `p3d:customer:${clinicId}` },
    );
    return customer.id;
  },

  async listOpenSessions(customerId) {
    const page = await getStripe().checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
    return page.data.filter((session) => !session.livemode).map(sessionInfo);
  },

  async expireSession(sessionId) {
    try {
      await getStripe().checkout.sessions.expire(sessionId);
    } catch (error) {
      // Already paid, already expired, or gone: either way it is not open, which is all that was wanted.
      if (!isStripeRequestError(error)) throw error;
    }
  },

  async createSession(args) {
    await ensureProduct();
    const session = await getStripe().checkout.sessions.create(checkoutSessionParams(args), { idempotencyKey: `p3d:checkout:${args.planId}` });
    if (session.livemode) throw new StripeConfigError("Stripe made a live-mode checkout page. This app only runs Stripe in test mode.");
    return sessionInfo(session);
  },

  async getSession(sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      return session.livemode ? null : sessionInfo(session);
    } catch (error) {
      if (isStripeRequestError(error, "resource_missing")) return null;
      throw error;
    }
  },

  async listSubscriptions(customerId) {
    const page = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    return page.data
      .filter((subscription) => !subscription.livemode)
      .map((subscription) => {
        const planId = subscription.metadata?.[PLAN_METADATA_KEY];
        return { id: subscription.id, planId: typeof planId === "string" && planId ? planId : null, status: subscription.status };
      });
  },
};

// ---------------------------------------------------------------------------
// Plan changes, and Stripe's own billing page
// ---------------------------------------------------------------------------

export { STRIPE_INVOICE_PREFIX, STRIPE_PORTAL_PREFIX };

/** An invoice Stripe is still waiting to be paid for. */
export type OpenInvoice = {
  id: string;
  /** Stripe's own page for paying it, or null when Stripe gave none. */
  payUrl: string | null;
  dueCents: number;
};

/**
 * One subscription as a plan change needs to see it, read from Stripe at
 * the moment of asking. Never stored: the next request asks again.
 */
export type SubscriptionState = {
  subscriptionId: string;
  customerId: string;
  /** Stripe's own word: active, past_due, canceled and so on. */
  status: string;
  /** The one line on the subscription. Its id CHANGES when a scheduled change takes effect, so it is never kept. */
  itemId: string;
  quantity: number;
  /**
   * The accepted plan the subscription is on: the plan its price was made
   * for, or, for a subscription that has never been changed, the plan
   * checkout wrote on the subscription itself.
   */
  planId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAt: Date | null;
  /** An upgrade Stripe is holding back until its invoice is paid. */
  pending: { planId: string | null } | null;
  /** The schedule attached to the subscription, when there is one. `next` is the change it will make at the next renewal, if any. */
  schedule: { id: string; next: { planId: string | null; at: Date } | null } | null;
  /** The latest invoice, when it is still unpaid: a failed renewal, or an upgrade waiting for its payment. */
  openInvoice: OpenInvoice | null;
};

/** Everything a plan change asks of Stripe. A plain object of functions, so the flow (lib/plan-changes.ts) takes it as a parameter and the tests hand in a stand-in. */
export type PlanGateway = {
  /** The subscription as it stands now, or null when Stripe has none by that id. */
  getState(subscriptionId: string): Promise<SubscriptionState | null>;
  /** The Stripe price for one accepted plan, made once: asking twice for the same plan gives the same price. */
  ensurePrice(args: { planId: string; perSeatCents: number; interval: "MONTH" | "YEAR" }): Promise<string>;
  /** What Stripe would charge today for moving to this price and these seats at this exact moment. Changes nothing. */
  previewUpgrade(args: { state: SubscriptionState; perSeatCents: number; interval: "MONTH" | "YEAR"; seats: number; at: Date }): Promise<{ dueNowCents: number }>;
  /**
   * Move the subscription to this plan's price and seats now, charging the
   * difference for the rest of the period. `applied` is false when the
   * payment did not go through: Stripe then holds the change back, the
   * subscription stays exactly as it was, and the unpaid invoice can be paid
   * on Stripe's page (or voided, which drops the change).
   */
  applyUpgrade(args: { state: SubscriptionState; planId: string; priceId: string; seats: number; at: Date }): Promise<{ applied: boolean }>;
  /** Set (or replace) the change made at the next renewal. Nothing is charged and nothing changes until then. Returns that date. */
  scheduleChange(args: { state: SubscriptionState; planId: string; priceId: string; seats: number; interval: "MONTH" | "YEAR" }): Promise<{ at: Date }>;
  /** Let a schedule go. The subscription carries on exactly as it is now, with no change waiting. */
  releaseSchedule(scheduleId: string): Promise<void>;
  /** Void an unpaid invoice. For an upgrade waiting on its payment, this is what drops the upgrade. */
  voidInvoice(invoiceId: string): Promise<void>;
  /** A visit to Stripe's own billing page for this customer: card, invoices, cancelling. Returns its address. */
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<string>;
};

const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const stripeInterval = (interval: "MONTH" | "YEAR") => (interval === "YEAR" ? "year" : "month");

/** Reduce a subscription (with its latest invoice and its schedule expanded) to what a plan change reads. Pure. */
export function stateFromSubscription(subscription: Stripe.Subscription): SubscriptionState | null {
  const customerId = idOf(subscription.customer);
  const item = subscription.items?.data?.[0];
  if (!customerId || !item) return null;

  const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  const openInvoice: OpenInvoice | null =
    invoice && invoice.status === "open" && invoice.id
      ? {
          id: invoice.id,
          payUrl: invoice.hosted_invoice_url && invoice.hosted_invoice_url.startsWith(STRIPE_INVOICE_PREFIX) ? invoice.hosted_invoice_url : null,
          dueCents: invoice.amount_due,
        }
      : null;

  const pendingItem = subscription.pending_update?.subscription_items?.[0];
  const schedule = typeof subscription.schedule === "object" && subscription.schedule !== null ? subscription.schedule : null;
  const scheduleId = idOf(subscription.schedule);

  return {
    subscriptionId: subscription.id,
    customerId,
    status: subscription.status,
    itemId: item.id,
    quantity: item.quantity ?? 1,
    planId: planIdIn(item.price?.metadata) ?? planIdIn(subscription.metadata),
    periodStart: fromUnix(item.current_period_start),
    periodEnd: fromUnix(item.current_period_end),
    cancelAt: fromUnix(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? fromUnix(item.current_period_end) : null),
    pending: subscription.pending_update ? { planId: planIdIn(pendingItem?.price?.metadata) } : null,
    schedule: scheduleId ? { id: scheduleId, next: nextPhaseOf(schedule) } : null,
    openInvoice,
  };
}

/** What Stripe's billing page may do. Changing the plan there is switched OFF: it would skip this app's seat and category rules. */
const PORTAL_KEY = "p3d";
const PORTAL_VERSION = "portal-v1";
let portalConfigurationId: string | null = null;

/**
 * The settings Stripe's billing page runs with for this app, found by the
 * mark this server puts on them, or made the first time they are needed.
 * Every visit names these settings, so it never depends on whatever is saved
 * as the default in the Stripe dashboard. (On a Stripe account that has no
 * billing-page settings at all, Stripe makes the first ones its default.)
 *
 *   - Updating the card: on.   Past invoices: on.
 *   - Cancelling: on, at the END of the period that has been paid for, with
 *     no refund worked out. Undoing a cancellation before then: Stripe's
 *     page offers it. (The cancellation terms are not approved yet; this is
 *     the test-mode placeholder.)
 *   - Changing the plan, the seats or the price there: OFF. Plan changes go
 *     through this app, which checks seats, categories and prices.
 */
async function ensurePortalConfiguration(): Promise<string> {
  if (portalConfigurationId) return portalConfigurationId;
  const stripe = getStripe();
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((configuration) => !configuration.livemode && configuration.metadata?.[PORTAL_KEY] === PORTAL_VERSION);
  if (found) {
    portalConfigurationId = found.id;
    return found.id;
  }
  const made = await stripe.billingPortal.configurations.create(
    {
      business_profile: { headline: PRODUCT_NAME },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: false },
        customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      },
      metadata: { [PORTAL_KEY]: PORTAL_VERSION },
    },
    { idempotencyKey: `p3d:${PORTAL_VERSION}` },
  );
  portalConfigurationId = made.id;
  return made.id;
}

/**
 * The real gateway. The calls that make something carry an idempotency key
 * built from the accepted plan's id, so a double click, a retry and a second
 * tab asking for the same change get the first one's answer, not a second
 * price or a second charge.
 */
export const stripePlanGateway: PlanGateway = {
  async getState(subscriptionId) {
    try {
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice", "schedule"] });
      if (subscription.livemode) return null;
      return stateFromSubscription(subscription);
    } catch (error) {
      if (isStripeRequestError(error, "resource_missing")) return null;
      throw error;
    }
  },

  async ensurePrice({ planId, perSeatCents, interval }) {
    await ensureProduct();
    const price = await getStripe().prices.create(
      {
        currency: "usd",
        product: PRODUCT_ID,
        unit_amount: perSeatCents,
        recurring: { interval: stripeInterval(interval), interval_count: 1 },
        // The mark the billing rules read (lib/billing-state.ts): a subscription on this price is on this plan.
        metadata: { [PLAN_METADATA_KEY]: planId },
      },
      { idempotencyKey: `p3d:price:${planId}` },
    );
    if (price.livemode) throw new StripeConfigError("Stripe made a live-mode price. This app only runs Stripe in test mode.");
    return price.id;
  },

  async previewUpgrade({ state, perSeatCents, interval, seats, at }) {
    const preview = await getStripe().invoices.createPreview({
      customer: state.customerId,
      subscription: state.subscriptionId,
      subscription_details: {
        items: [
          {
            id: state.itemId,
            quantity: seats,
            price_data: { currency: "usd", product: PRODUCT_ID, unit_amount: perSeatCents, recurring: { interval: stripeInterval(interval), interval_count: 1 } },
          },
        ],
        // The same two settings applyUpgrade uses, with the same moment, so the preview is the invoice.
        proration_behavior: "always_invoice",
        proration_date: unix(at),
      },
    });
    return { dueNowCents: preview.amount_due };
  },

  async applyUpgrade({ state, planId, priceId, seats, at }) {
    const subscription = await getStripe().subscriptions.update(
      state.subscriptionId,
      {
        items: [{ id: state.itemId, price: priceId, quantity: seats }],
        // Invoice the difference now, not at the next renewal.
        proration_behavior: "always_invoice",
        proration_date: unix(at),
        // Only change the subscription if that invoice is PAID. Otherwise
        // Stripe keeps the change aside (a "pending update") and the
        // subscription stays exactly as it was.
        payment_behavior: "pending_if_incomplete",
      },
      { idempotencyKey: `p3d:upgrade:${planId}` },
    );
    const item = subscription.items?.data?.[0];
    return { applied: !subscription.pending_update && item?.price?.id === priceId };
  },

  async scheduleChange({ state, planId, priceId, seats, interval }) {
    const stripe = getStripe();
    // A subscription can have one schedule. If it has one, its waiting change is replaced in place.
    const scheduleId = state.schedule?.id ?? (await stripe.subscriptionSchedules.create({ from_subscription: state.subscriptionId })).id;
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const currentStart = schedule.current_phase?.start_date;
    const current = schedule.phases.find((phase) => phase.start_date === currentStart) ?? schedule.phases[0];
    const at = fromUnix(current?.end_date);
    if (!current || !at) throw new Error("Stripe returned a schedule with no current period.");

    await stripe.subscriptionSchedules.update(scheduleId, {
      // After the change has run for one period the schedule lets go, and the subscription simply carries on.
      end_behavior: "release",
      // Writing the schedule must not itself put anything on an invoice.
      // Without this, Stripe added two stray "unused time / remaining time"
      // lines to the NEXT invoice just for restating the current period
      // (seen in test mode, October 2026: they came to one cent).
      proration_behavior: "none",
      phases: [
        // The period being paid for now, exactly as it is.
        {
          start_date: current.start_date,
          end_date: current.end_date,
          proration_behavior: "none",
          items: current.items.map((phaseItem) => ({ price: idOf(phaseItem.price) as string, quantity: phaseItem.quantity ?? 1 })),
        },
        // From the renewal on: the new plan. Nothing is credited or charged
        // for the change itself ("none"); the new period starts on the
        // renewal date and is invoiced in full ("phase_start"). Without that
        // second setting, a move from monthly to yearly made NO invoice for
        // the first year (seen in Stripe test mode, October 2026).
        {
          items: [{ price: priceId, quantity: seats }],
          duration: { interval: stripeInterval(interval), interval_count: 1 },
          proration_behavior: "none",
          billing_cycle_anchor: "phase_start",
          metadata: { [PLAN_METADATA_KEY]: planId },
        },
      ],
    });
    return { at };
  },

  async releaseSchedule(scheduleId) {
    try {
      await getStripe().subscriptionSchedules.release(scheduleId);
    } catch (error) {
      // Already released, finished or gone: either way nothing is scheduled, which is all that was wanted.
      if (!isStripeRequestError(error)) throw error;
    }
  },

  async voidInvoice(invoiceId) {
    try {
      await getStripe().invoices.voidInvoice(invoiceId);
    } catch (error) {
      // Already paid, already void, or gone. The caller looks at the subscription again to see which.
      if (!isStripeRequestError(error)) throw error;
    }
  },

  async createPortalSession({ customerId, returnUrl }) {
    const configuration = await ensurePortalConfiguration();
    const session = await getStripe().billingPortal.sessions.create({ customer: customerId, configuration, return_url: returnUrl });
    if (session.livemode) throw new StripeConfigError("Stripe made a live-mode billing page. This app only runs Stripe in test mode.");
    return session.url;
  },
};
