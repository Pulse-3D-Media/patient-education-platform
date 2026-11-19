import { SETUP_STEPS, type SetupProgress } from "../setup";
import { daysAfter, LAST_SETUP_REMINDER, reminderDue, SETUP_REMINDER_DAYS, STOP_AFTER_DAYS, whoGetsReminders } from "../setup-reminders";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";

/**
 * The reads and the one write behind the setup reminder emails
 * (Clinic.setupReminder and Clinic.setupReminderAt; the rules are in
 * lib/setup-reminders.ts).
 *
 * listClinicsDueSetupReminder() takes no clinic id: it is the daily job's
 * list, read with a limit and an order, and it hands back ids, never names.
 * claimSetupReminder() takes the clinic id first, like every function here
 * that touches one clinic (rule 1); the id comes from that list, never from
 * anything a browser sent.
 */

/** One clinic the daily job may remind, with only what it needs to find the owner. */
export type ReminderCandidate = { id: string; clerkOrgId: string; ownerClerkUserId: string };

/**
 * Clinics that look due a reminder right now, oldest sign-up first, at most
 * `limit` of them. The database does the filtering, so a run never loads
 * every clinic: ACTIVE, setup under way, an owner, and inside one of the three
 * windows with that window's reminder not yet sent:
 *
 *   reminder 1   signed up 1 to 7 days ago, none sent yet
 *   reminder 2   7 to 14 days ago, fewer than 2 sent
 *   reminder 3   14 to 21 days ago, fewer than 3 sent
 *
 * This is only the list to look at: claimSetupReminder() decides again,
 * under the clinic's lock, before anything is sent.
 */
export async function listClinicsDueSetupReminder(now: Date, limit: number): Promise<ReminderCandidate[]> {
  const windowEnds = [...SETUP_REMINDER_DAYS.slice(1), STOP_AFTER_DAYS];
  const windows = SETUP_REMINDER_DAYS.map((days, index) => ({
    createdAt: { lte: daysAfter(now, -days), gt: daysAfter(now, -windowEnds[index]) },
    setupReminder: { lt: index + 1 },
  }));
  const rows = await prisma.clinic.findMany({
    where: {
      status: "ACTIVE",
      setupStep: { in: SETUP_STEPS.map((step) => step.key) },
      setupReminder: { lt: LAST_SETUP_REMINDER },
      ownerClerkUserId: { not: null },
      clerkOrgId: { not: null },
      OR: windows,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, clerkOrgId: true, ownerClerkUserId: true },
  });
  return rows.filter((row): row is ReminderCandidate => row.clerkOrgId !== null && row.ownerClerkUserId !== null);
}

/** What a claim hands back: the reminder's number and where setup stands, for the email's list. */
export type ReminderClaim = { reminder: number; progress: SetupProgress };

/**
 * Decide whether this clinic gets a reminder now and, if it does, record it,
 * in one transaction holding the clinic's row lock (the lock every change to
 * a clinic takes). Returns null when nothing is due (already sent, setup
 * finished, the clinic closed, too early, too late).
 *
 * The record is written BEFORE the email is sent, and the caller sends only
 * after this has committed. So:
 *   - two runs at the same moment: the second waits for the lock, then reads
 *     the first one's record and gets null. One email.
 *   - a rerun later the same day: null. No email.
 *   - the send fails after the record committed: that reminder is missed, not
 *     sent twice. A missed reminder is better than a duplicate, and the next
 *     one still goes at its time. The run counts it as failed.
 */
export async function claimSetupReminder(clinicId: string, now: Date): Promise<ReminderClaim | null> {
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, {
      status: true,
      setupStep: true,
      setupDone: true,
      ownerClerkUserId: true,
      clerkOrgId: true,
      createdAt: true,
      setupReminder: true,
    });
    if (!clinic) return null;
    const progress = whoGetsReminders({ ...clinic, setupDone: clinic.setupDone ?? [] });
    if (!progress) return null;
    const reminder = reminderDue(clinic.createdAt, clinic.setupReminder, now);
    if (reminder === null) return null;
    await tx.clinic.update({ where: { id: clinicId }, data: { setupReminder: reminder, setupReminderAt: now }, select: { id: true } });
    return { reminder, progress };
  });
}
