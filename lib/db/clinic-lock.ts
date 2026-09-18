import type { Prisma } from "@prisma/client";

/**
 * Read one clinic for a change, holding its row against other changes until
 * the transaction ends.
 *
 * Every change to a clinic is written together with a sentence in its log
 * saying what the value was and what it became (changeClinicWithLog in
 * clinics.ts). That sentence is only true if nobody else changes the clinic
 * between the moment "what it was" is read and the moment the change is
 * written. Two people can now save at once (Pulse staff on /pulse and the
 * clinic's own admin on /admin/branding), so the read takes a lock first:
 * the second save waits for the first to finish, then reads what the first
 * one wrote, and describes that.
 *
 * Postgres's "FOR NO KEY UPDATE" is the lock an ordinary UPDATE takes. It
 * makes other changes to the row wait, and it waits for a share link that
 * is being made for this clinic (createShare holds the row FOR SHARE while
 * it checks the plan), but it does not hold up anything that only points
 * at the clinic, such as a new note or a new link being inserted.
 *
 * Prisma's query builder cannot ask for a row lock, so the lock is one line
 * of SQL, with the id bound as a parameter, never pasted into the text. The
 * read that follows is an ordinary Prisma read with the fields the caller
 * asks for; it runs inside the same transaction, after the lock, so what it
 * returns cannot change until that transaction ends.
 *
 * In a file of its own so the overlap test can wrap it
 * (clinics.race.test.ts).
 *
 * Returns null when no clinic has that id.
 */
export async function readClinicLocked<S extends Prisma.ClinicSelect>(
  tx: Prisma.TransactionClient,
  clinicId: string,
  select: S,
): Promise<Prisma.ClinicGetPayload<{ select: S }> | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Clinic"
    WHERE "id" = ${clinicId}
    FOR NO KEY UPDATE`;
  if (rows.length === 0) return null;
  return tx.clinic.findUnique({ where: { id: clinicId }, select }) as Promise<Prisma.ClinicGetPayload<{ select: S }> | null>;
}
