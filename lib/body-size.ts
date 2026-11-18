/**
 * How big a request's body says it is, judged before the body is read.
 * Pure, with no server code, so it can be tested on its own.
 *
 * Used by the three webhooks (app/api/webhooks/stripe, mux and clerk), which
 * each have to read the whole body to check the sender's signature over it.
 * Without a limit, a stranger could send a very large body and make the server
 * read all of it before the signature check refused it (audit run 2, and
 * finding F3 of the 2026-11-16 audit for Mux and Clerk).
 */

/**
 * The largest Stripe notification the webhook will read: 1 MiB. Real ones
 * are a few kilobytes (the biggest, an invoice with many lines, stays far
 * below a hundred), so this is many times what Stripe sends, and well under
 * the 4.5 MB Vercel lets any request carry.
 */
export const MAX_STRIPE_WEBHOOK_BYTES = 1024 * 1024;

/**
 * The largest Mux notification the webhook will read: 256 KiB. Real ones
 * (an upload or an asset changing state) are a few kilobytes, so this is
 * many times what Mux sends. Added for audit finding F3, November 2026.
 */
export const MAX_MUX_WEBHOOK_BYTES = 256 * 1024;

/**
 * The largest Clerk notification the webhook will read: 256 KiB. Real ones
 * (a membership or an organization changing) are a few kilobytes, even with
 * the most metadata Clerk allows on them. Checked before Clerk's own
 * verifyWebhook reads the body, so the signature is still checked over the
 * exact bytes sent.
 */
export const MAX_CLERK_WEBHOOK_BYTES = 256 * 1024;

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
