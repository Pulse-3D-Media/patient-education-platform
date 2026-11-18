import "server-only";
import { getQrAlertNames } from "./db/qr-codes";
import { emailIsConfigured, sendEmail, type EmailEnv, type EmailMessage } from "./email";
import { alertRecipients, type ReportEnv } from "./error-report";
import type { QrAlert } from "./qr-code";

/**
 * The email Pulse staff get when a printed QR code gets busy (audit finding
 * F1, November 2026). Server only.
 *
 * WHY. Each printed code hands out at most qrDailyCap links per UTC day (200
 * by default). Someone with a photo of a poster can use those up in a couple
 * of minutes, and after that every real patient who scans it sees "This video
 * isn't available right now" until midnight UTC. The flag (qrDailyFlag, 100)
 * was already on /pulse, but only for someone who happened to look. Now the
 * Play tap whose link makes the day's count exactly the flag, and the one
 * that makes it exactly the limit, each send one email to ERROR_ALERT_EMAIL
 * (the same address the error alerts use), naming the clinic, the procedure
 * and the count, with a link to the clinic's Links tab on /pulse.
 *
 * WHAT IT NEVER HOLDS. The printed code (a secret like a key: the email names
 * the code by its clinic and procedure, and the link opens the clinic's page
 * by the clinic's id), and anything about whoever tapped: no address, no
 * browser, no device, because none of that is ever read.
 *
 * ONCE, HOWEVER MANY SERVERS. Which tap reached the number is decided inside
 * the Play tap's transaction, under the code's row lock (issueShareFromQrCode
 * in lib/db/shares.ts), so only one tap sees it. As a second guard, the email
 * carries an idempotency key made from the code's row id, the UTC day and the
 * threshold (qrAlertKey), and Resend sends a key only once a day.
 *
 * NEVER IN THE PATIENT'S WAY. The route sends it after the link is written and
 * the answer has gone back (Next.js's after()), and this function never
 * throws. A failure is one log line with one word.
 *
 * With ERROR_ALERT_EMAIL empty, or email not set up, nothing is sent and
 * nothing is looked up.
 */

/** The idempotency key for one code, one UTC day and one threshold. The same on every server. */
export function qrAlertKey(alert: QrAlert): string {
  return `qr-daily-${alert.threshold}-${alert.qrCodeId}-${alert.day}`;
}

/** The clinic's Links tab on the Pulse dashboard. The clinic page opens the tab named after the #. */
export function pulseLinksTab(origin: string, clinicId: string): string {
  return `${origin}/pulse/clinics/${clinicId}#links`;
}

/**
 * The email's words. `origin` is one this deployment knows is its own
 * (pickTrustedOrigin in the route), or null when there is none, and then the
 * page is named instead of linked.
 */
export function qrAlertEmail(alert: QrAlert, names: { clinicName: string; videoTitle: string }, to: string[], origin: string | null): EmailMessage {
  // A name goes on the subject line: no line breaks in it, whatever was typed.
  const clinic = names.clinicName.replace(/\s+/g, " ").trim();
  const video = names.videoTitle.replace(/\s+/g, " ").trim();
  const where = origin ? pulseLinksTab(origin, alert.clinicId) : `the Pulse dashboard, /pulse/clinics/${alert.clinicId}, the Links tab`;
  const atCap = alert.threshold === "cap";

  const lines = [
    atCap
      ? `A printed QR code at ${clinic} for ${video} has handed out ${alert.issuedToday} links today (UTC). That is its daily limit: until midnight UTC, anyone who scans it and taps Play sees "This video isn't available right now". Links it already handed out keep working.`
      : `A printed QR code at ${clinic} for ${video} has handed out ${alert.issuedToday} links today (UTC). That is the flag. It stops handing out links at ${alert.cap} until midnight UTC.`,
    "",
    "A link is one tap on Play, not a scan and not a person: one patient tapping twice makes two. A count this high in one day can mean a very busy waiting room, or someone scripting the code from a photo of it.",
    "",
    `Look at it here: ${where}`,
    "",
    'To let every printed code hand out more today, raise "Printed-code links per day" on /pulse/settings. The clinic can retire or replace this code on its own Links page.',
    "",
    "This message never holds the printed code or anything about who scanned it. You get it once per code per day for the flag, and once for the limit.",
  ];
  const html = `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  return {
    to,
    subject: atCap ? `Pulse 3D: a printed QR code reached its daily limit (${clinic})` : `Pulse 3D: a printed QR code reached today's flag (${clinic})`,
    text: lines.join("\n"),
    html,
    idempotencyKey: qrAlertKey(alert),
  };
}

export type QrAlertOutcome = { told: true } | { told: false; reason: "not-configured" | "lookup-failed" | "no-recipients" | "refused" | "unreachable" };

/** What the tests hand in instead of the real settings, Resend and the database. */
type Deps = {
  env?: ReportEnv & EmailEnv;
  fetch?: typeof fetch;
  lookup?: (clinicId: string, qrCodeId: string) => Promise<{ clinicName: string; videoTitle: string } | null>;
};

/** Send the email for one alert. Never throws. */
export async function notifyPulseOfBusyQrCode(alert: QrAlert, origin: string | null, deps: Deps = {}): Promise<QrAlertOutcome> {
  const env = deps.env ?? process.env;
  const to = alertRecipients(env);
  if (to.length === 0 || !emailIsConfigured(env)) return { told: false, reason: "not-configured" };

  let names: { clinicName: string; videoTitle: string } | null;
  try {
    names = await (deps.lookup ?? getQrAlertNames)(alert.clinicId, alert.qrCodeId);
  } catch {
    names = null;
  }
  if (!names) {
    console.error("Printed code alert: the email was not sent.", "lookup-failed");
    return { told: false, reason: "lookup-failed" };
  }

  const outcome = await sendEmail(qrAlertEmail(alert, names, to, origin), { env, fetch: deps.fetch });
  if (outcome.sent) return { told: true };
  console.error("Printed code alert: the email was not sent.", outcome.reason);
  return { told: false, reason: outcome.reason };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
