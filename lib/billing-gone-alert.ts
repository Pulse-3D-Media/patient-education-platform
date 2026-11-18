import "server-only";
import { after } from "next/server";
import { reconcileSubscription, type GoneClosure, type ReconcileResult } from "./db/billing";
import { emailIsConfigured, sendEmail, type EmailEnv, type EmailMessage } from "./email";
import { alertRecipients, type ReportEnv } from "./error-report";
import { errorKind } from "./error-kind";
import { pickTrustedOrigin, type OriginEnv } from "./trusted-origin";

/**
 * The email Pulse staff get when Stripe no longer has a paying clinic's
 * subscription and the app has therefore ended it (audit finding E3; the
 * email decided by Evan on 2026-11-18). Server only.
 *
 * WHEN. A look at Stripe (a notification, Check with Stripe, checkout, a plan
 * change) finds that the subscription a clinic that was ACTIVE or PAST_DUE
 * expects is gone. The record then says the subscription ended (CANCELED),
 * which closes the clinic unless Pulse manages it. A first payment that never
 * finished (INCOMPLETE) ends quietly, because that clinic was never open.
 * AT GO-LIVE, AND WHENEVER THE STRIPE KEY IS SWITCHED TO ANOTHER ACCOUNT, EVERY
 * CLINIC WHOSE SUBSCRIPTION THE NEW KEY CANNOT SEE IS CLOSED THIS WAY, WITH
 * ONE EMAIL EACH.
 *
 * EXACTLY ONCE. Whether to send is decided inside the transaction that ends
 * the subscription, under the clinic's billing sync lock (reconcileSubscription
 * in lib/db/billing.ts sets `goneClosure`). A notification and Check with
 * Stripe that overlap take turns, and the second finds the record already
 * ended, so it sends nothing. The email also carries an idempotency key from
 * the clinic and the moment of the change, so Resend will not send it twice.
 * This is one email per closure, not an error alert, so the error alerts'
 * ceiling (ALERT_CEILING in lib/error-report.ts) does not apply to it; it is
 * bounded by the number of clinics.
 *
 * NEVER IN THE WAY. The email is sent after the change has committed, handed
 * to Next.js's after() so the request does not wait for it. A failed send
 * never undoes or fails the billing change: it is one log line, in words and
 * the kind of failure only.
 *
 * WHAT IT HOLDS. The clinic's name, its new status and a link to its /pulse
 * page built from an origin this deployment knows is its own. No payment
 * detail and no Stripe ids.
 */

/** The clinic's page on the Pulse dashboard. */
export function pulseClinicPage(origin: string, clinicId: string): string {
  return `${origin}/pulse/clinics/${clinicId}`;
}

const STATUS_WORDS: Record<GoneClosure["clinicStatus"], string> = { PENDING: "Pending", ACTIVE: "Active", PAUSED: "Paused", PAST_DUE: "Past due", CANCELED: "Canceled" };

/** The email's words. `origin` is null when no origin can be trusted, and then the page is named instead of linked. */
export function goneAlertEmail(closure: GoneClosure, to: string[], origin: string | null): EmailMessage {
  // A name goes on the subject line: no line breaks in it, whatever was typed.
  const clinic = closure.clinicName.replace(/\s+/g, " ").trim();
  const where = origin ? pulseClinicPage(origin, closure.clinicId) : `the Pulse dashboard, /pulse/clinics/${closure.clinicId}`;
  const closed = closure.clinicStatus === "CANCELED";
  const lines = [
    `Clinic: ${clinic}`,
    "",
    closed
      ? "Stripe no longer has this clinic's subscription, so the app treated it as ended and closed the clinic (its status is now Canceled). Its surgeons cannot send links until it is open again."
      : `Stripe no longer has this clinic's subscription, so the app recorded it as ended. Pulse manages this clinic, so its status did not change (it is ${STATUS_WORDS[closure.clinicStatus]}).`,
    "",
    "This happens when the subscription or the customer was deleted in Stripe, or when the app's Stripe key was switched to another account (going from test mode to live does this for every clinic).",
    "",
    `Look at it here: ${where}`,
    "",
    "If this was a mistake, or the clinic should carry on: open the clinic's page, check Stripe, press Reset billing under Card billing, and the clinic's admin can then choose a plan and pay again on their Billing page.",
    "",
    "The same words are in the clinic's log. You get this once for each time a clinic's subscription is found gone.",
  ];
  return {
    to,
    subject: `Pulse 3D: Stripe no longer has a clinic's subscription (${clinic})`,
    text: lines.join("\n"),
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p>`,
    idempotencyKey: `billing-gone-${closure.clinicId}-${closure.at.getTime()}`,
  };
}

export type GoneAlertOutcome = { told: true } | { told: false; reason: "not-configured" | "no-recipients" | "refused" | "unreachable" };

/** Send the email for one closure. Never throws. */
export async function notifyPulseOfGoneSubscription(
  closure: GoneClosure,
  deps: { env?: ReportEnv & EmailEnv & OriginEnv; fetch?: typeof fetch } = {},
): Promise<GoneAlertOutcome> {
  try {
    const env = deps.env ?? process.env;
    const to = alertRecipients(env);
    if (to.length === 0 || !emailIsConfigured(env)) return { told: false, reason: "not-configured" };
    // No request to pick from here, so the first origin this deployment knows is its own (APP_ORIGINS first).
    const origin = pickTrustedOrigin(null, env);
    const outcome = await sendEmail(goneAlertEmail(closure, to, origin), { env, fetch: deps.fetch });
    if (outcome.sent) return { told: true };
    console.error("Billing: the email about a vanished subscription was not sent.", outcome.reason);
    return { told: false, reason: outcome.reason };
  } catch (error) {
    console.error("Billing: the email about a vanished subscription was not sent.", errorKind(error));
    return { told: false, reason: "unreachable" };
  }
}

/**
 * reconcileSubscription (lib/db/billing.ts), then, when that look ended a
 * paying clinic's vanished subscription, the email to Pulse staff, started
 * after the commit and handed to after() so nobody waits for it. Every caller
 * outside lib/db uses this rather than reconcileSubscription directly.
 *
 * `tell` is for the tests; the app always uses notifyPulseOfGoneSubscription.
 */
export async function reconcileAndTellPulse(
  args: Parameters<typeof reconcileSubscription>[0],
  tell: (closure: GoneClosure) => Promise<unknown> = notifyPulseOfGoneSubscription,
): Promise<ReconcileResult> {
  const result = await reconcileSubscription(args);
  if (result.goneClosure) tellLater(result.goneClosure, tell);
  return result;
}

function tellLater(closure: GoneClosure, tell: (closure: GoneClosure) => Promise<unknown>) {
  let sending: Promise<unknown>;
  try {
    sending = tell(closure).catch((error) => {
      console.error("Billing: the email about a vanished subscription was not sent.", errorKind(error));
    });
  } catch (error) {
    console.error("Billing: the email about a vanished subscription was not sent.", errorKind(error));
    return;
  }
  try {
    after(sending);
  } catch {
    // Not inside a request, so the platform cannot be asked to wait. The send goes on.
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
