import type { Instrumentation } from "next";
import { emailIsConfigured, sendEmail } from "@/lib/email";
import { ALERT_WINDOW_MS, alertEmail, alertKey, alertRecipients, describeRequestError } from "@/lib/error-report";

/**
 * How Pulse 3D gets told when something breaks on the server.
 *
 * Next.js calls onRequestError for every error the server captures while
 * drawing a page, running a route handler, a Server Action or the proxy,
 * whether or not one of the error pages then covered it for the person
 * looking. (Not for notFound() or a redirect: those are not errors.)
 *
 * Two things happen, both with the scrubbed record from
 * lib/error-report.ts and nothing else:
 *
 *   1. One line in the server log, "Request error: {...}", beside the full
 *      error Next.js has already logged. Vercel keeps that log for the
 *      project (Logs). This always happens.
 *
 *   2. An email, when ERROR_ALERT_EMAIL is set and email is configured
 *      (lib/email.ts, the same Resend settings the link emails use): at
 *      most one per distinct error, by digest, every ten minutes. Two
 *      things hold that line. This server remembers what it has sent, but
 *      a serverless function may be one of several running at once, so
 *      the message also carries an idempotency key built from the digest
 *      and the ten-minute window, and Resend drops the repeats from every
 *      other server too. A database outage that fails a thousand requests
 *      is one email, then one more every ten minutes until it is over.
 *
 * Nothing here sends the address that was opened, a share code, a header,
 * a message, a stack or a body: describeRequestError() is the only place
 * the record is built, and lib/error-report.test.ts proves what gets
 * through. With ERROR_ALERT_EMAIL empty, nothing is sent and the app runs
 * exactly as before.
 *
 * The email is awaited, as Next.js asks, so it is sent before a serverless
 * function is stopped.
 */

/** The alert keys this server has sent, with when. Pruned so it never grows. */
const sentThisWindow = new Map<string, number>();

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const now = new Date();
  const report = describeRequestError(error, request, context, process.env, now);
  console.error("Request error:", JSON.stringify(report));

  const to = alertRecipients(process.env);
  if (to.length === 0 || !emailIsConfigured()) return;

  const key = alertKey(report, now);
  if (sentThisWindow.has(key)) return;
  forgetOldKeys(now);
  sentThisWindow.set(key, now.getTime());

  const outcome = await sendEmail(alertEmail(report, to, key));
  if (!outcome.sent) console.error("Error alert: the email was not sent.", outcome.reason);
};

/** Drop keys older than one window, so the list stays a handful of entries. */
function forgetOldKeys(now: Date) {
  for (const [key, sentAt] of sentThisWindow) {
    if (now.getTime() - sentAt > ALERT_WINDOW_MS) sentThisWindow.delete(key);
  }
}

/** For the tests only: start with nothing remembered. */
export function forgetSentAlerts() {
  sentThisWindow.clear();
}
