import type { Prisma } from "@prisma/client";

/**
 * The lock behind the renewal email limit (RENEWAL_EMAILS_PER_DAY in
 * lib/expiry.ts): at most ten "ask my clinic" emails per clinic per UTC day.
 *
 * Counting and writing have to happen one request at a time per clinic, or
 * two requests arriving together could both count nine and both send the
 * tenth email. So a request takes this clinic's lock, counts, writes its
 * own request, and commits, which lets the next one in; the next one then
 * counts the first. Requests at different clinics never wait for each other.
 *
 * A named Postgres lock (an "advisory lock") rather than a lock on the
 * clinic's row, so a waiting room tapping Ask my clinic never holds up the
 * clinic making links or saving its settings. Taken with two numbers: the
 * first says what the lock is for, the second is the clinic id turned into
 * a number. Two clinics whose ids happen to give the same number only
 * wait for each other a few milliseconds; nothing is ever mixed up, because
 * the count below is by clinic id. It is released when the transaction ends.
 *
 * In a file of its own so the overlap test can wrap it
 * (lib/db/shares.renewal-email.race.test.ts).
 */

/** What the lock is for. The settings lock (lib/db/settings.ts) uses the one-number form, so the two can never meet. */
const RENEWAL_EMAIL_LOCK = 20261026;

/**
 * Take this clinic's lock for the rest of the transaction, then count the
 * requests recorded at this clinic since `since` (midnight UTC): the links
 * whose last request is from today. A link turned back on today has had its
 * request cleared, so it drops out of the count; only an office admin can do
 * that, so it can never be used to send more email.
 */
export async function lockAndCountRenewalRequests(tx: Prisma.TransactionClient, clinicId: string, since: Date): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RENEWAL_EMAIL_LOCK}::int, hashtext(${clinicId}))`;
  return tx.share.count({ where: { clinicId, renewalRequestedAt: { gte: since } } });
}
