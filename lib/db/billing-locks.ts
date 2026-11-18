import type { Prisma } from "@prisma/client";

/**
 * The two named locks billing holds while it waits on Stripe.
 *
 * Why they exist: asking Stripe something takes a moment, and sometimes many
 * seconds. Billing used to ask while holding the CLINIC'S ROW LOCK, which is
 * also the lock a surgeon's Send (createShare) and a patient's Play on a
 * printed code (issueShareFromQrCode) take a share of while they check the
 * plan. A slow Stripe could therefore make links fail for that clinic
 * (audit finding E1, 2026-11-16). Now no row lock is ever held while Stripe
 * is being asked: billing holds one of these instead, and takes the row lock
 * only afterwards, for the few milliseconds the write takes.
 *
 * Both are named Postgres locks ("advisory locks", like the admin-change lock
 * in lib/db/admin-change-lock.ts and the renewal email's in renewal-lock.ts).
 * A named lock only makes other holders of the SAME name at the SAME clinic
 * wait; links, seats, settings and staff changes never ask for it, so they
 * never wait for it. Each is taken with two numbers: what the lock is for, and
 * the clinic id turned into a number. Two clinics whose ids give the same
 * number only wait for each other briefly; nothing is ever mixed up. Each is
 * let go when its transaction ends, whether it succeeded or threw.
 *
 * What waits on what, now:
 *
 *   THE SYNC LOCK (BILLING_SYNC_LOCK). Held for one whole look at Stripe:
 *   asking, then writing what Stripe said. Two looks at one clinic (two
 *   notifications at once, a notification and Check with Stripe, the staff
 *   reset) take turns, so the second always asks Stripe after the first has
 *   written, and an older answer can never be written over a newer one.
 *   Nothing else waits for it.
 *
 *   THE PLAN CHANGE LOCK (PLAN_CHANGE_LOCK). Held while one plan change (or
 *   cancelling one) talks to Stripe. A second plan change at the same clinic
 *   waits for it, as before, then sees what the first did. Nothing else waits
 *   for it: a look at Stripe during a plan change goes ahead and simply reads
 *   whatever Stripe says at that moment (the plan change's own look
 *   afterwards reads it again).
 *
 *   THE CLINIC'S ROW LOCK (readClinicLocked). Unchanged for everyone else.
 *   Billing takes it only for its write, after Stripe has answered, so a link
 *   waits at most for that write.
 */

/** What each lock is for. Different from every other lock's first number in lib/db. */
export const BILLING_SYNC_LOCK = 20261117;
export const PLAN_CHANGE_LOCK = 20261118;

/** Take one of the named locks for this clinic, for the rest of the transaction. Waits while another transaction holds it. */
export async function takeNamedBillingLock(tx: Prisma.TransactionClient, lock: number, clinicId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock}::int, hashtext(${clinicId}))`;
}
