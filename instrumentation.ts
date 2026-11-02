import type { Instrumentation } from "next";
import { after } from "next/server";
import { emailIsConfigured, sendEmail, type EmailMessage } from "@/lib/email";
import {
  ALERT_CEILING,
  alertEmail,
  alertGroup,
  alertKey,
  alertRecipients,
  alertWindow,
  describeRequestError,
  distinctError,
  heldBackEmail,
  heldBackKey,
  type ErrorReport,
} from "@/lib/error-report";

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
 *      project (Logs). This always happens, for every error.
 *
 *   2. An email, when ERROR_ALERT_EMAIL is set and email is configured
 *      (lib/email.ts, the same Resend settings the link emails use): at
 *      most one per distinct error every ten minutes, and at most
 *      ALERT_CEILING for one route, kind and error name, however many
 *      different errors that is, because some error text varies with the
 *      request. Past that, one note says alerts were held back, and the rest
 *      are in the log only. A database outage that fails a thousand requests
 *      is one email, then one more every ten minutes until it is over.
 *
 *      A serverless function may be one of several running at once, and each
 *      remembers only what it has sent itself. What holds the line across
 *      them is the idempotency key each message carries: there are only
 *      ALERT_CEILING keys and one note's key per group per window, and Resend
 *      drops a repeat from any other server. See alertKey().
 *
 * Nothing here sends the address that was opened, a share code, a header,
 * a message, a stack or a body: describeRequestError() is the only place
 * the record is built, and lib/error-report.test.ts proves what gets
 * through. With ERROR_ALERT_EMAIL empty, nothing is sent and the app runs
 * exactly as before.
 *
 * Next.js does not always wait for this function: on a Server Action or a
 * page's error it starts it and answers the person, and the serverless
 * function may then be suspended with the email half sent. So:
 *
 *   - an alert is claimed before anything is awaited, in one unbroken stretch
 *     of code, so errors arriving while an email is on its way count against
 *     the ceiling at once;
 *
 *   - the send is handed to Next.js's after(), which asks the platform to keep
 *     the function alive until it finishes. Outside a request there is nothing
 *     to hand it to, and after() refuses; the send carries on regardless;
 *
 *   - a claim is never given back when a send fails or is cut off, or a Resend
 *     outage would mean one more attempt for every error. That alert is lost
 *     from this server (another server may still send under the same key), and
 *     the error is still in the log.
 */

/** What this server has done for one group in the current window. */
type GroupMemory = {
  window: number;
  /** The distinct errors it has claimed an alert for. Never more than ALERT_CEILING. */
  errors: Set<string>;
  noteClaimed: boolean;
};

/** One entry per group seen in the current window. Pruned, so it never grows. */
const groups = new Map<string, GroupMemory>();

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const now = new Date();
  const report = describeRequestError(error, request, context, process.env, now);
  console.error("Request error:", JSON.stringify(report));

  const to = alertRecipients(process.env);
  if (to.length === 0 || !emailIsConfigured()) return;

  const message = claimAlert(report, to, now);
  if (!message) return;

  const sending = sendAlert(message);
  try {
    after(sending);
  } catch {
    // Not inside a request, so the platform cannot be asked to wait. The send below goes on.
  }
  await sending;
};

/** Decide what, if anything, to send for this report, and remember it. Not async, on purpose: see the comment at the top. */
function claimAlert(report: ErrorReport, to: string[], now: Date): EmailMessage | null {
  const window = alertWindow(now);
  forgetOldWindows(window);

  const name = alertGroup(report);
  const group = groups.get(name) ?? { window, errors: new Set<string>(), noteClaimed: false };
  groups.set(name, group);

  const error = distinctError(report);
  if (group.errors.has(error)) return null;

  if (group.errors.size < ALERT_CEILING) {
    group.errors.add(error);
    return alertEmail(report, to, alertKey(report, group.errors.size, now));
  }

  if (group.noteClaimed) return null;
  group.noteClaimed = true;
  return heldBackEmail(report, to, heldBackKey(report, now), now);
}

/** sendEmail() never throws, so neither does this, and after() is never handed a failure. */
async function sendAlert(message: EmailMessage) {
  const outcome = await sendEmail(message);
  if (!outcome.sent) console.error("Error alert: the email was not sent.", outcome.reason);
}

/** Drop what belongs to an earlier window, so the list stays a handful of entries. */
function forgetOldWindows(window: number) {
  for (const [name, group] of groups) {
    if (group.window !== window) groups.delete(name);
  }
}

/** For the tests only: start with nothing remembered, as a second server would. */
export function forgetSentAlerts() {
  groups.clear();
}
