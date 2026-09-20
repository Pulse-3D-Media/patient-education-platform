import { Prisma } from "@prisma/client";
import {
  beginBillingAttempt,
  findClinicIdByStripeCustomer,
  getBillingEvent,
  ignoreBillingEvent,
  isFinished,
  markBillingEventFailed,
  receiveBillingEvent,
  reconcileSubscription,
  setBillingEventClinic,
  type BillingEventRow,
} from "./db/billing";
import { eventRefs, fetchSubscriptionSnapshot, isHandledEventType, type FetchSubscription } from "./stripe";

/**
 * What happens to a notification from Stripe once its signature has been
 * checked (app/api/webhooks/stripe/route.ts does that part). SERVER ONLY.
 *
 * The steps, and why each is where it is:
 *
 *   1. A kind of notification we do not use is answered and dropped. Nothing
 *      is stored, so the table only ever holds billing news.
 *   2. The notification is written down under Stripe's own event id
 *      (receiveBillingEvent). A repeat finds the row already there. If that
 *      row is finished, the repeat is answered with success and NOTHING is
 *      done: no change, no log entry.
 *   3. Only two facts are taken from the notification's body: which customer
 *      and which subscription. The clinic is found by the customer. News
 *      about a customer we do not know is closed as ignored.
 *   4. reconcileSubscription (lib/db/billing.ts) locks the clinic, asks
 *      Stripe where the subscription stands NOW, applies that, writes the
 *      log entry and marks the notification finished, all in one
 *      transaction.
 *   5. If anything throws, the notification is marked FAILED with the kind
 *      of error only, and the error is thrown on, so the route answers 500
 *      and Stripe sends it again (for up to three days in live mode, three
 *      times over a few hours in test mode). Staff can also press Try again
 *      on /pulse/billing, which runs steps 3 to 5 from the stored row.
 *
 * The work is awaited before the route answers. Nothing is started in the
 * background and left: on Vercel a function can be stopped the moment it
 * has answered, and work that was still running would be lost while Stripe
 * believed it delivered.
 */

export type HandleResult = {
  /** skipped: a kind we do not use. duplicate: already finished earlier. The rest are what reconcile said. */
  status: "skipped" | "duplicate" | "processed" | "ignored";
  outcome: string;
};

/** What the processor needs from outside, so tests can hand in a stand-in for Stripe. */
export type BillingDeps = { fetchSubscription: FetchSubscription; now?: Date };

const REAL_DEPS: BillingDeps = { fetchSubscription: fetchSubscriptionSnapshot };

/** The smallest part of a Stripe event this file reads. */
export type IncomingEvent = { id: string; type: string; livemode: boolean; data: { object: unknown } };

/**
 * The kind of an error, never its message: a Stripe error's type, a Prisma
 * error's code, or the class name. Safe to store and show to staff.
 */
export function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `Prisma ${error.code}`;
  if (error && typeof error === "object") {
    const type = (error as { type?: unknown }).type;
    if (typeof type === "string" && type.startsWith("Stripe")) return type;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return "Error";
}

export async function handleStripeEvent(event: IncomingEvent, deps: BillingDeps = REAL_DEPS): Promise<HandleResult> {
  if (!isHandledEventType(event.type)) return { status: "skipped", outcome: "Not a kind of notification this app uses." };

  const refs = eventRefs(event);
  const { row } = await receiveBillingEvent({
    stripeEventId: event.id,
    type: event.type,
    stripeCustomerId: refs.customerId,
    stripeSubscriptionId: refs.subscriptionId,
  });
  if (isFinished(row.status)) return { status: "duplicate", outcome: row.outcome ?? "" };

  if (event.livemode) {
    const outcome = "A live-mode notification was refused: this app runs Stripe in test mode only.";
    await ignoreBillingEvent(row.id, outcome);
    return { status: "ignored", outcome };
  }

  return processRow(row, deps);
}

/** Try a stored notification again. For the button on /pulse/billing; the caller has already checked for Pulse staff. */
export async function retryBillingEvent(eventRowId: string, deps: BillingDeps = REAL_DEPS): Promise<HandleResult | null> {
  const row = await getBillingEvent(eventRowId);
  if (!row) return null;
  if (isFinished(row.status)) return { status: "duplicate", outcome: row.outcome ?? "" };
  return processRow(row, deps);
}

async function processRow(row: BillingEventRow, deps: BillingDeps): Promise<HandleResult> {
  try {
    await beginBillingAttempt(row.id);

    if (!row.stripeCustomerId) {
      const outcome = "The notification names no customer. Nothing was changed.";
      await ignoreBillingEvent(row.id, outcome);
      return { status: "ignored", outcome };
    }
    const clinicId = await findClinicIdByStripeCustomer(row.stripeCustomerId);
    if (!clinicId) {
      const outcome = "No clinic has this Stripe customer. Nothing was changed.";
      await ignoreBillingEvent(row.id, outcome);
      return { status: "ignored", outcome };
    }
    await setBillingEventClinic(row.id, clinicId);
    if (!row.stripeSubscriptionId) {
      const outcome = "The notification is not about a subscription. Nothing was changed.";
      await ignoreBillingEvent(row.id, outcome, clinicId);
      return { status: "ignored", outcome };
    }

    const result = await reconcileSubscription({
      clinicId,
      subscriptionId: row.stripeSubscriptionId,
      fetchSubscription: deps.fetchSubscription,
      eventId: row.id,
      now: deps.now,
    });
    if (result.kind === "already-done") return { status: "duplicate", outcome: result.outcome };
    return { status: result.kind, outcome: result.outcome };
  } catch (error) {
    // The kind of failure goes on the row; the detail goes to the server
    // log, which is not shown to anyone. Neither holds the notification's body.
    const code = errorCode(error);
    console.error(`Billing notification ${row.stripeEventId} (${row.type}) failed: ${code}`);
    await markBillingEventFailed(row.id, code).catch(() => undefined);
    throw error;
  }
}
