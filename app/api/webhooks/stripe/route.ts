import { handleStripeEvent } from "@/lib/billing-events";
import { StripeConfigError, getWebhookSecret, verifyWebhook } from "@/lib/stripe";

/**
 * Where Stripe sends its notifications: POST /api/webhooks/stripe.
 *
 * Public on purpose (Stripe is not signed in to anything; proxy.ts leaves
 * /api/webhooks alone). What stands in for a sign-in is the signature:
 * Stripe signs the exact bytes it sends with a secret only Stripe and this
 * server hold, and nothing is read, stored or done until that signature has
 * been checked. A request that fails the check is answered 400 and leaves
 * no trace.
 *
 * What the answers mean to Stripe:
 *
 *   200   finished (done, a repeat of something done, or nothing to do).
 *         Stripe stops sending it.
 *   400   not from Stripe, or unreadable. Stripe does not get a second try
 *         that could succeed, which is right: the request was bad.
 *   500   the work failed (Stripe or the database was unreachable, say).
 *         Stripe sends it again later; the notification is on /pulse/billing
 *         as failed in the meantime.
 *   503   the signing secret is not set on this deployment. Stripe tries
 *         again later, by which time it may be.
 *
 * The work is finished BEFORE answering, because a serverless function may
 * be stopped as soon as it has answered (see lib/billing-events.ts). It is
 * short: one row lock, one request to Stripe capped at eight seconds.
 *
 * Nothing from the body is ever logged, and nothing is returned but a word.
 */

// Always run on the server at request time, on Node (Prisma and Stripe's
// library both need it), and never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function answer(status: number, word: string) {
  return new Response(word, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getWebhookSecret();
  } catch (error) {
    if (error instanceof StripeConfigError) {
      console.error("Stripe webhook: the signing secret is not set on this deployment.");
      return answer(503, "not configured");
    }
    throw error;
  }

  // The body exactly as sent. request.json() would re-write it, and the
  // signature is over the original bytes.
  const rawBody = await request.text();

  let event;
  try {
    event = verifyWebhook(rawBody, request.headers.get("stripe-signature"), secret);
  } catch {
    return answer(400, "bad signature");
  }

  try {
    await handleStripeEvent(event);
    return answer(200, "ok");
  } catch {
    // Already recorded and logged (by kind only) in handleStripeEvent.
    return answer(500, "failed");
  }
}
