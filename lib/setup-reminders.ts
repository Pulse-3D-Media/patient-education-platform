import { createHash } from "node:crypto";
import type { ClinicStatus } from "@prisma/client";
import { readSetupProgress, setupIsDue, SETUP_PATH, type SetupProgress } from "./setup";

/**
 * The setup reminder emails: the rules and the wording. Pure (no database,
 * no Clerk, no email service), so the tests can stand on any day.
 * lib/db/setup-reminders.ts does the reads and the one write;
 * lib/setup-reminder-run.ts sends; app/api/cron/setup-reminders is the
 * address Vercel calls once a day.
 *
 * THE SCHEDULE (Evan, 2026-11-18): 1 day, 1 week and 2 weeks after the clinic
 * signed up, only while setup is unfinished. The third is the last, for ever.
 *
 * "SIGNED UP" IS THE CLINIC ROW'S createdAt. The server writes it once, when
 * the row is first made at sign-up, and nothing the clinic does can change it.
 *
 * WHICH REMINDER A RUN SENDS. The newest one whose time has come, and only if
 * it is newer than the last one sent. So:
 *   - a day the job did not run is made up the next day (one email, late);
 *   - a clinic never gets two in one run, and never an older reminder once a
 *     newer one has gone;
 *   - nothing at all is sent from three weeks after sign-up (STOP_AFTER_DAYS).
 *     The third reminder may go up to a week late, never later.
 * A clinic that only opens (pays, or is opened by Pulse staff) some days
 * after it signed up gets at most the one reminder due on the day it opens,
 * and nothing if it opens three weeks or more after signing up: never three
 * at once, and never a "1 day after sign-up" email a month later.
 *
 * WHO IS ELIGIBLE (whoGetsReminders below):
 *   - setup under way: setupStep is one of the four steps. EMPTY (a clinic
 *     made before setup existed) and "finished" never get one, nor does a
 *     value that is not understood (lib/setup.ts reads that as finished);
 *   - the clinic is ACTIVE. A clinic that never paid (PENDING) needs to choose
 *     a plan, not finish setting up; a PAUSED or CANCELED one is closed; and a
 *     PAST_DUE one, even inside its grace days, is being asked to fix its
 *     payment, so a nudge about setup would be the wrong message;
 *   - the clinic has an account owner, who is the one person emailed (the
 *     run checks with Clerk that they are still an admin of the clinic).
 * A clinic Pulse manages by hand (managedByPulse) is NOT left out: setup and
 * the library's "Finish setup" reminder treat it like any other clinic, and
 * there was no onboarding email before this one to copy a different rule from.
 */

/** Days after sign-up that reminders 1, 2 and 3 fall due. */
export const SETUP_REMINDER_DAYS = [1, 7, 14] as const;

/** The number of the last reminder. */
export const LAST_SETUP_REMINDER = SETUP_REMINDER_DAYS.length;

/** From this many days after sign-up nothing is sent, however many were missed. */
export const STOP_AFTER_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment `days` days after `from`, to the millisecond. */
export function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * The reminder to send now (1, 2 or 3), or null for none.
 *
 *   signedUpAt  the clinic row's createdAt
 *   lastSent    Clinic.setupReminder: the number of the newest reminder sent, 0 for none
 */
export function reminderDue(signedUpAt: Date, lastSent: number, now: Date): number | null {
  if (!(signedUpAt instanceof Date) || !Number.isFinite(signedUpAt.getTime())) return null;
  if (now.getTime() >= daysAfter(signedUpAt, STOP_AFTER_DAYS).getTime()) return null;
  let due = 0;
  SETUP_REMINDER_DAYS.forEach((days, index) => {
    if (now.getTime() >= daysAfter(signedUpAt, days).getTime()) due = index + 1;
  });
  if (due === 0) return null;
  // A stored number that is not a plain 0 to 3 counts as "the last one went", so a damaged row never sends.
  const sent = Number.isInteger(lastSent) && lastSent >= 0 && lastSent <= LAST_SETUP_REMINDER ? lastSent : LAST_SETUP_REMINDER;
  return due > sent ? due : null;
}

/** What the rules need to know about one clinic. */
export type ReminderClinicFacts = {
  status: ClinicStatus;
  setupStep: string | null;
  setupDone: readonly string[];
  ownerClerkUserId: string | null;
  clerkOrgId: string | null;
};

/** Where setup stands for a clinic that may get a reminder, or null when it may not get one at all (see the top of this file). */
export function whoGetsReminders(clinic: ReminderClinicFacts): (SetupProgress & { finished: false }) | null {
  if (clinic.status !== "ACTIVE") return null;
  if (!clinic.ownerClerkUserId || !clinic.clerkOrgId) return null;
  const progress = readSetupProgress(clinic.setupStep, clinic.setupDone);
  return setupIsDue(progress) ? progress : null;
}

/**
 * The idempotency key Resend keeps a send under for a day: the clinic and the
 * reminder's number, so a repeat of the same reminder is dropped by Resend
 * too. A SHA-256 fingerprint, so the clinic's id does not sit in Resend's logs.
 */
export function setupReminderKey(clinicId: string, reminder: number): string {
  return `setup-reminder-${createHash("sha256").update(`${clinicId}:${reminder}`).digest("hex")}`;
}

/** The setup page on the app's own address. It sends the admin to the step they were on (or to sign in first, and back). */
export function setupLink(origin: string): string {
  return `${origin}${SETUP_PATH}`;
}

/** The five characters that mean something in HTML, made harmless. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const SETUP_REMINDER_SUBJECT = "A few minutes to finish setting up your clinic";

/**
 * The email, as drawn (screen 13). The same words for all three; the list
 * shows which steps are done at the moment it is sent.
 *
 *   origin        the app's own address, from the deployment's settings (never a request header)
 *   canReply      true when replies reach a person (EMAIL_REPLY_TO is set);
 *                 without it the "Reply to this email" line is left out,
 *                 because the sending address may be a no-reply one
 *
 * One change from the drawing: once the team step is done, the heading's
 * second sentence ("Your team isn't in yet.") would be untrue, so it reads
 * "A few steps are left." instead.
 *
 * Nothing about any patient, and nothing about the clinic but its setup
 * steps: not even its name, which the drawing does not show either.
 */
export function setupReminderEmail(progress: SetupProgress, origin: string, canReply: boolean): { subject: string; text: string; html: string } {
  const teamDone = progress.steps.some((step) => step.key === "team" && step.state === "done");
  const heading = teamDone ? "Your library is ready. A few steps are left." : "Your library is ready. Your team isn't in yet.";
  const intro = "Thanks for signing up. A few setup steps are left before your team can send their first link:";
  const after = "It takes about 5 minutes, and it picks up where you left off.";
  const reply = "Questions? Reply to this email and a person will answer.";
  const why = "You're getting this because you set up a clinic on Pulse 3D. These reminders stop once setup is finished.";
  const link = setupLink(origin);

  const text = [
    heading,
    "",
    intro,
    "",
    ...progress.steps.map((step) => `${step.state === "done" ? "[x]" : "[ ]"} ${step.label}`),
    "",
    after,
    "",
    `Finish setup: ${link}`,
    "",
    ...(canReply ? [reply, ""] : []),
    why,
  ].join("\n");

  // Email programs ignore stylesheets and most modern layout, so this is
  // tables and inline styles. The font falls back to Arial where the
  // design's fonts are not installed, which is most mail programs.
  const font = "'Hanken Grotesk',Arial,Helvetica,sans-serif";
  const headingFont = "'Schibsted Grotesk','Hanken Grotesk',Arial,Helvetica,sans-serif";
  const rows = progress.steps
    .map((step, index) => {
      const done = step.state === "done";
      const mark = done
        ? `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:#2a829b;color:#ffffff;text-align:center;font-size:13px;font-weight:700">&#10003;</span>`
        : `<span style="display:inline-block;width:19px;height:19px;border-radius:11px;border:1.5px solid #737b83"></span>`;
      const top = index === 0 ? "border-top:1px solid #e3e7eb;" : "";
      return `<tr><td style="${top}border-bottom:1px solid #e3e7eb;height:46px;width:34px;vertical-align:middle">${mark}</td><td style="${top}border-bottom:1px solid #e3e7eb;height:46px;vertical-align:middle;color:#12202a;font-size:16px">${escapeHtml(step.label)}</td></tr>`;
    })
    .join("");

  const html = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(SETUP_REMINDER_SUBJECT)}</title>`,
    // Narrower padding on a phone, as drawn. Mail programs that ignore this keep the wider padding, which still fits.
    `<style>@media (max-width:480px){.em-pad{padding:26px 20px !important}.em-outer{padding:20px 12px 32px !important}}</style></head>`,
    `<body style="margin:0;padding:0;background:#eef1f4">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4"><tr><td class="em-outer" align="center" style="padding:32px 12px 48px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e3e7eb;border-radius:14px"><tr><td class="em-pad" style="padding:36px 40px 36px 40px;font-family:${font};color:#3a4c56;font-size:16px;line-height:1.6">`,
    `<img src="${escapeHtml(`${origin}/pulse-3d-logo.png`)}" alt="Pulse 3D Media" height="30" style="height:30px;width:auto;display:block;border:0;margin:0 0 22px">`,
    `<h1 style="margin:0 0 18px;font-family:${headingFont};font-size:26px;font-weight:600;letter-spacing:-0.02em;line-height:1.2;color:#12202a">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0 0 14px">${escapeHtml(intro)}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-family:${font}">${rows}</table>`,
    `<p style="margin:0 0 14px">${escapeHtml(after)}</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#1e5668;color:#ffffff;font-weight:700;text-decoration:none">Finish setup</a></p>`,
    canReply ? `<p style="margin:0 0 14px;font-size:14px;color:#52616a">${escapeHtml(reply)}</p>` : "",
    `<hr style="border:0;border-top:1px solid #e3e7eb;margin:22px 0">`,
    `<p style="margin:0;font-size:14px;color:#52616a">${escapeHtml(why)}</p>`,
    `</td></tr></table>`,
    `</td></tr></table>`,
    `</body></html>`,
  ].join("\n");

  return { subject: SETUP_REMINDER_SUBJECT, text, html };
}
