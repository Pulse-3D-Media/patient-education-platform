import Stripe from "stripe";
import type { SubscriptionSnapshot } from "./billing-state";

/**
 * The only file that talks to Stripe. SERVER ONLY: it reads the secret key,
 * so nothing that runs in the browser may import it (rule 8 in CLAUDE.md).
 *
 * What the Stripe package ("stripe", Stripe's own library for Node) is used
 * for here:
 *
 *   - checking that a notification really came from Stripe (its signature,
 *     worked out over the exact bytes Stripe sent);
 *   - asking Stripe where one subscription stands right now.
 *
 * Checkout, plan changes and the rest come in later steps and go in here too.
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
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
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
  return { customerId, subscriptionId: null };
}

/** The key checkout puts on the subscription's own metadata to say which accepted plan it is for. */
export const PLAN_METADATA_KEY = "billingPlanId";

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
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

  const planId = subscription.metadata?.[PLAN_METADATA_KEY];

  return {
    subscriptionId: subscription.id,
    customerId,
    status: subscription.status,
    latestInvoicePaid,
    currentPeriodEnd,
    cancelAt,
    planId: typeof planId === "string" && planId ? planId : null,
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
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
    if (subscription.livemode) return null;
    return snapshotFromSubscription(subscription);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return null;
    throw error;
  }
};
