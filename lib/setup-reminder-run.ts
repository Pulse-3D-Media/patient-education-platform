import "server-only";
import { claimSetupReminder, listClinicsDueSetupReminder } from "./db/setup-reminders";
import { emailIsConfigured, sendEmail, type EmailEnv } from "./email";
import { errorKind } from "./error-kind";
import { getMember, type Person } from "./people";
import { setupReminderEmail, setupReminderKey } from "./setup-reminders";
import { pickTrustedOrigin, type OriginEnv } from "./trusted-origin";

/**
 * One run of the daily setup reminder job (app/api/cron/setup-reminders calls
 * it once a day). Server only: it reads the database, asks Clerk for each
 * owner's address and sends through lib/email.ts.
 *
 * FOR EACH CLINIC THE LIST SAYS IS DUE, IN THIS ORDER:
 *
 *   1. Ask Clerk for the account owner (getMember, five-second limit). They
 *      must still be in the clinic and an admin; if not, or if Clerk does not
 *      answer, nothing is recorded and tomorrow's run looks again.
 *   2. Claim the reminder (claimSetupReminder): decide and record, under the
 *      clinic's row lock, in one transaction. Null means another run got
 *      there first, or nothing is due after all: nothing is sent.
 *   3. Send, only after the record has committed.
 *
 * WHY RECORD FIRST, THEN SEND. If the send then fails (Resend down, the
 * function stopped), that one reminder is lost, and is counted as failed in
 * the run's answer and the log. The other order, send then record, would
 * send it again the next day whenever the record failed, and two runs at once
 * could both send. A missed reminder is better than a duplicate. Resend is
 * also given an idempotency key per clinic and reminder, so even a repeat
 * that reached it within a day would be dropped.
 *
 * HOW A FAILURE IS NOTICED. The answer and the log line carry counts: sent,
 * skipped, failed, and whether more were left for tomorrow. Vercel keeps each
 * run's log (Project, Cron Jobs, View Logs). Nothing else is logged: never an
 * address, a clinic name, a clinic id or an error message (only errorKind()).
 *
 * WHERE THE BUTTON POINTS. The setup page on the app's own address, picked
 * from the deployment's own settings (APP_ORIGINS first, then the addresses
 * Vercel sets) with no request header at all. With none known, nothing is sent.
 */

/** At most this many clinics are looked at in one run. The rest wait for the next day, inside their window. */
export const REMINDERS_PER_RUN = 25;

/** A run stops starting new clinics after this long, well inside Vercel's 300-second limit on the Hobby plan. */
export const RUN_BUDGET_MS = 200_000;

/** What one run did. Counts only. */
export type ReminderRunResult = {
  /** False when email or the app's address is not set up here: nothing was read or sent. */
  configured: boolean;
  /** Clinics the list handed over. */
  checked: number;
  sent: number;
  /** Nothing due after all (another run sent it, setup finished), or no owner to send to. */
  skipped: number;
  /** Clerk did not answer, the record could not be written, or the send failed. */
  failed: number;
  /** True when the list was full or time ran out: some may be left for the next run. */
  more: boolean;
};

export type ReminderRunOptions = {
  now?: Date;
  env?: EmailEnv & OriginEnv;
  fetch?: typeof fetch;
  /** A stand-in for Clerk's member lookup, for the tests. */
  member?: (clerkOrgId: string, userId: string) => Promise<Person | null>;
  limit?: number;
  /** The clock the time budget is measured on, for the tests. */
  clock?: () => number;
};

export async function runSetupReminders(options: ReminderRunOptions = {}): Promise<ReminderRunResult> {
  const env = options.env ?? (process.env as EmailEnv & OriginEnv);
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const member = options.member ?? getMember;
  const limit = options.limit ?? REMINDERS_PER_RUN;
  const result: ReminderRunResult = { configured: false, checked: 0, sent: 0, skipped: 0, failed: 0, more: false };

  if (!emailIsConfigured(env)) return result;
  const origin = pickTrustedOrigin(null, env);
  if (!origin) return result;
  result.configured = true;

  const replyTo = env.EMAIL_REPLY_TO?.trim() || undefined;
  const started = clock();
  const candidates = await listClinicsDueSetupReminder(now, limit);
  result.more = candidates.length >= limit;

  for (const clinic of candidates) {
    if (clock() - started > RUN_BUDGET_MS) {
      result.more = true;
      break;
    }
    result.checked += 1;

    let owner: Person | null;
    try {
      owner = await member(clinic.clerkOrgId, clinic.ownerClerkUserId);
    } catch (error) {
      console.error("Setup reminders: the owner could not be read from Clerk", errorKind(error));
      result.failed += 1;
      continue;
    }
    if (!owner || owner.role !== "admin" || !owner.email.trim()) {
      result.skipped += 1;
      continue;
    }

    let claim: Awaited<ReturnType<typeof claimSetupReminder>>;
    try {
      claim = await claimSetupReminder(clinic.id, now);
    } catch (error) {
      console.error("Setup reminders: the record could not be written", errorKind(error));
      result.failed += 1;
      continue;
    }
    if (!claim) {
      result.skipped += 1;
      continue;
    }

    const message = setupReminderEmail(claim.progress, origin, Boolean(replyTo));
    const outcome = await sendEmail(
      { to: [owner.email], ...message, replyTo, idempotencyKey: setupReminderKey(clinic.id, claim.reminder) },
      { env, fetch: options.fetch },
    );
    if (outcome.sent) {
      result.sent += 1;
    } else {
      // The reason is one word (refused, unreachable, ...). The reminder stays recorded, so it is not sent again.
      console.error("Setup reminders: a reminder was recorded but not sent", outcome.reason);
      result.failed += 1;
    }
  }
  return result;
}
