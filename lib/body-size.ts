/**
 * How big a request's body says it is, judged before the body is read.
 * Pure, with no server code, so it can be tested on its own.
 *
 * Used by the Stripe webhook (app/api/webhooks/stripe/route.ts), which has to
 * read the whole body as text to check Stripe's signature over it. Without a
 * limit, a stranger could send a very large body and make the server read all
 * of it before the signature check refused it (audit run 2, November 2026).
 */

/**
 * The largest Stripe notification the webhook will read: 1 MiB. Real ones
 * are a few kilobytes (the biggest, an invoice with many lines, stays far
 * below a hundred), so this is many times what Stripe sends, and well under
 * the 4.5 MB Vercel lets any request carry.
 */
export const MAX_STRIPE_WEBHOOK_BYTES = 1024 * 1024;

/**
 * What the Content-Length header says about a body, against `maxBytes`:
 *
 *   "ok"         no header (the platform caps the body anyway), or a whole
 *                number of bytes no bigger than the limit
 *   "too-large"  a whole number of bytes over the limit
 *   "malformed"  anything else (not a whole number, negative, several values)
 *
 * The header is the sender's own claim, so this is the cheap first refusal,
 * not the only protection: the platform still limits what it accepts.
 */
export function judgeContentLength(header: string | null, maxBytes: number): "ok" | "too-large" | "malformed" {
  if (header === null) return "ok";
  const value = header.trim();
  if (!/^\d+$/.test(value)) return "malformed";
  // A number too long to be a size anyone sends is simply too large.
  if (value.length > 15) return "too-large";
  return Number(value) > maxBytes ? "too-large" : "ok";
}
