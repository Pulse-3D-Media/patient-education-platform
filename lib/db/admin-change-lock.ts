import { prisma } from "./client";

/**
 * The lock that makes admin changes at one clinic take turns: switching admin
 * on or off, and removing someone (lib/seat-changes.ts).
 *
 * Why it is needed: each of those checks with Clerk first (is the person
 * asking still an admin? would this leave the clinic with no admin?) and then
 * writes to Clerk. Two admins pressing at the same moment, each switching the
 * other's admin off or removing the other, could both pass the checks before
 * either write landed, and leave the clinic with no admin at all. With this
 * lock the second one waits until the first has finished, then checks again
 * and sees what the first did.
 *
 * It is a named Postgres lock (an "advisory lock", like the renewal email's in
 * lib/db/renewal-lock.ts), NOT the clinic's row lock. That matters, because
 * this is the one lock held while Clerk is being asked something: nothing but
 * another admin change at the same clinic ever waits for it, so links, seats,
 * billing and settings are never held up by a slow Clerk. Every Clerk call
 * under it has the usual five-second limit (lib/clerk-timeout.ts), so it is
 * held for seconds at most. Clinics never wait for each other.
 *
 * Taken with two numbers: what the lock is for, and the clinic id turned
 * into a number. Two clinics whose ids give the same number only wait for
 * each other briefly; nothing is mixed up. It is released when the work
 * finishes, whether it succeeded or threw.
 *
 * `work` must not use the database itself while the lock is held (it runs
 * outside the lock's transaction, so a write there would not be part of it);
 * it is for the Clerk checks and the Clerk write. Log entries and seat writes
 * come after, once the lock is let go.
 */

/** What the lock is for. Different from every other lock's first number. */
const ADMIN_CHANGE_LOCK = 20261106;

/**
 * Generous on purpose: up to four Clerk calls of five seconds each can happen
 * under the lock, and a second request may wait for a first one. If it ever
 * ran out mid-way, this throws (and the lock is let go early); the caller
 * then says it cannot be sure whether the change went through.
 */
const HOLD_MS = 45_000;

export async function withAdminChangeLock<T>(clinicId: string, work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_CHANGE_LOCK}::int, hashtext(${clinicId}))`;
      return work();
    },
    { maxWait: 10_000, timeout: HOLD_MS },
  );
}
