import type { RenewalRequestFacts } from "./db/shares";
import { emailIsConfigured, sendEmail, type EmailEnv } from "./email";
import { listPeople, type Person } from "./people";

/**
 * The email a clinic's office admins get when a patient asks for a paused
 * link to be turned back on. Server only (it reads the clinic's people from
 * Clerk and sends through lib/email.ts); the wording itself,
 * renewalRequestEmail(), is a plain function the tests read.
 *
 * WHAT IT SAYS, AND WHAT IT CANNOT. Which procedure, which surgeon the link
 * is from, when the link was made, and how many renewals are left. Nothing
 * about the patient, because nothing about the patient exists (rule 2): the
 * link is tied to a procedure, a clinic and a surgeon, never to a person.
 * The email says so, so nobody goes looking for a name that is not there.
 *
 * ONE BUTTON, AND IT IS NOT A ONE-CLICK ACTION. "Reactivate this link" opens
 * a page in the app (/admin/reactivate/<code>) that needs a sign-in, checks
 * the person is an admin of THAT clinic, and has its own Confirm button.
 * Mail programs and hospital filters open links by themselves to scan them,
 * and a forwarded email must not be able to turn anything on; a GET that
 * changed the link would let both happen. Only Confirm, a POST from a
 * signed-in admin, does anything.
 *
 * WHERE THE BUTTON POINTS. The address is built from an origin the
 * deployment already knows is its own (pickTrustedOrigin in the caller),
 * never from the Host header as the browser sent it: an address that ends
 * up in someone's inbox must not be one an attacker chose.
 */

/** The page in the app where the link is turned back on. */
export function reactivateLink(origin: string, code: string): string {
  return `${origin}/admin/reactivate/${code}`;
}

/** "Sep 15, 2026", in Utah time, like the admin area. */
function dayWords(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

/** The five characters that mean something in HTML, made harmless, so a clinic or video name cannot become markup. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The subject, the plain-text body and the HTML body, from the facts and the page's address. */
export function renewalRequestEmail(facts: RenewalRequestFacts, reactivateUrl: string): { subject: string; text: string; html: string } {
  const from = facts.senderName ?? "not recorded on this link";
  const times = `${facts.renewalsLeft} more ${facts.renewalsLeft === 1 ? "time" : "times"}`;
  const days = `${facts.daysPerRenewal} ${facts.daysPerRenewal === 1 ? "day" : "days"} each`;

  const subject = `A patient is asking for a paused link to be turned back on: ${facts.videoTitle}`;

  const text = [
    `A patient has asked ${facts.clinic.name} to turn a paused video link back on.`,
    "",
    `Procedure: ${facts.videoTitle}`,
    `Link from: ${from}`,
    `Link made: ${dayWords(facts.createdAt)}`,
    `Can be turned back on: ${times}, ${days}`,
    "",
    "Nothing about the patient is stored or sent, so there is nothing more to say about who asked.",
    "",
    "To turn it back on, open this page, sign in, and press Confirm:",
    reactivateUrl,
    "",
    "Opening this email, or the page, turns nothing on by itself: only Confirm does. If you did not expect this, you can ignore it; the link stays paused.",
    "",
    "Pulse 3D",
  ].join("\n");

  const html = [
    `<p>A patient has asked <strong>${escapeHtml(facts.clinic.name)}</strong> to turn a paused video link back on.</p>`,
    "<table cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:16px;line-height:1.5\">",
    `<tr><td style="padding-right:12px;color:#52616a">Procedure</td><td><strong>${escapeHtml(facts.videoTitle)}</strong></td></tr>`,
    `<tr><td style="padding-right:12px;color:#52616a">Link from</td><td>${escapeHtml(from)}</td></tr>`,
    `<tr><td style="padding-right:12px;color:#52616a">Link made</td><td>${escapeHtml(dayWords(facts.createdAt))}</td></tr>`,
    `<tr><td style="padding-right:12px;color:#52616a">Can be turned back on</td><td>${escapeHtml(times)}, ${escapeHtml(days)}</td></tr>`,
    "</table>",
    "<p>Nothing about the patient is stored or sent, so there is nothing more to say about who asked.</p>",
    `<p><a href="${escapeHtml(reactivateUrl)}" style="display:inline-block;background:#1e5668;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:600">Reactivate this link</a></p>`,
    "<p style=\"color:#52616a\">That opens a page in the app: sign in and press Confirm there. Opening this email, or the page, turns nothing on by itself. If you did not expect this, you can ignore it; the link stays paused.</p>",
    "<p>Pulse 3D</p>",
  ].join("\n");

  return { subject, text, html };
}

/** What notifyClinicOfRenewalRequest() did. Every reason is one word for the server log; nothing about the message is in it. */
export type NotifyOutcome =
  | { told: true; recipients: number }
  | { told: false; reason: "not-configured" | "no-origin" | "no-organization" | "no-admins" | "people-unreadable" | "refused" | "unreachable" };

/**
 * Tell every office admin of the clinic, by email, that a patient asked.
 *
 * Nothing here is a condition of the request itself: the request was
 * written before this is called, and the overview lists it whatever
 * happens here. So every way this can fail answers with a reason and
 * throws nothing. `origin` is the trusted origin the caller picked, or
 * null when none could be; without one no address can be built and no
 * email goes. `options` exist for the tests (a stand-in for Clerk's people
 * list, for the service, and made-up settings).
 */
export async function notifyClinicOfRenewalRequest(
  facts: RenewalRequestFacts,
  origin: string | null,
  options: { env?: EmailEnv; fetch?: typeof fetch; people?: (clerkOrgId: string) => Promise<Person[]> } = {},
): Promise<NotifyOutcome> {
  if (!emailIsConfigured(options.env ?? process.env)) return { told: false, reason: "not-configured" };
  if (!origin) return { told: false, reason: "no-origin" };
  if (!facts.clinic.clerkOrgId) return { told: false, reason: "no-organization" };

  let people: Person[];
  try {
    people = await (options.people ?? listPeople)(facts.clinic.clerkOrgId);
  } catch (error) {
    console.error("Renewal request: the clinic's people could not be read", error instanceof Error ? error.name : "unknown error");
    return { told: false, reason: "people-unreadable" };
  }
  const admins = people.filter((person) => person.role === "admin").map((person) => person.email);
  if (admins.length === 0) return { told: false, reason: "no-admins" };

  const message = renewalRequestEmail(facts, reactivateLink(origin, facts.code));
  const outcome = await sendEmail(
    {
      to: admins,
      ...message,
      // One request per link per day is the rule; the key makes a resend of the same request a repeat, not a second email.
      idempotencyKey: `renewal-request-${facts.code}-${facts.requestedAt.getTime()}`,
    },
    { env: options.env, fetch: options.fetch },
  );
  if (!outcome.sent) return { told: false, reason: outcome.reason === "no-recipients" ? "no-admins" : outcome.reason };
  return { told: true, recipients: admins.length };
}
