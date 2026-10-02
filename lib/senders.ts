import { getSeatClinic, listSeatNames } from "./db/seats";
import { SenderRefusedError, type ShareSender } from "./db/shares";
import { getMember, listPeople } from "./people";
import { isClerkUserId } from "./seats";
import { effectiveSenderName, type Sender } from "./sender-name";

/**
 * Who a patient link can be from. SERVER ONLY: it reads Clerk and the
 * database. The pages call listSenders() to draw the surgeon picker, and
 * both actions that make links call resolveSender() to turn a user id into
 * the sender createShare() writes onto the link.
 *
 * A link can be from anyone who holds a seat at the clinic (lib/seats.ts).
 * The account owner without a seat is not a surgeon here and is never in
 * the list; an owner who took a seat is. Nothing the browser sends is
 * trusted: resolveSender() checks with Clerk that the person is in THIS
 * clinic's organization (read from the clinic's own row), and createShare()
 * then checks, under a lock, that they hold a seat here at that moment.
 */

export type { Sender };

/**
 * Everyone who holds a seat at this clinic and is still in its organization,
 * in the People page's order (admins first, then by name). Someone whose
 * seat outlived their membership (they were removed in Clerk's own panel,
 * and the People page has not been opened since) is left out. Throws when
 * Clerk cannot be read; the page says so and makes nothing.
 */
export async function listSenders(clinicId: string): Promise<Sender[]> {
  const clinic = await getSeatClinic(clinicId);
  if (!clinic?.clerkOrgId) return [];
  const [people, seats] = await Promise.all([listPeople(clinic.clerkOrgId), listSeatNames(clinicId)]);
  const typed = new Map(seats.map((seat) => [seat.clerkUserId, seat.displayName]));
  return people
    .filter((person) => typed.has(person.userId))
    .map((person) => ({
      userId: person.userId,
      name: person.name,
      patientName: effectiveSenderName(typed.get(person.userId), person.defaultPatientName),
    }));
}

export type SenderCheck = { ok: true; sender: ShareSender } | { ok: false; message: string };

/**
 * Turn a user id (the admin's pick, or the signed-in surgeon's own id) into
 * the sender for a new link. Checks that it is a Clerk user id and that the
 * person is a member of this clinic's organization; the seat itself is
 * checked by createShare(), inside the transaction that writes the link,
 * where it cannot change in between. The fallback name comes from Clerk as
 * it is now. `null` from Clerk (it could not be reached) is a failure, and
 * nothing is made.
 */
export async function resolveSender(clinicId: string, userId: unknown): Promise<SenderCheck> {
  if (typeof userId !== "string" || !userId) return { ok: false, message: "Choose who the link is from." };
  if (!isClerkUserId(userId)) return { ok: false, message: NOT_A_SENDER };
  const clinic = await getSeatClinic(clinicId);
  if (!clinic?.clerkOrgId) return { ok: false, message: NOT_A_SENDER };
  const member = await getMember(clinic.clerkOrgId, userId);
  if (!member) return { ok: false, message: NOT_A_SENDER };
  return { ok: true, sender: { clerkUserId: member.userId, fallbackName: member.defaultPatientName ?? null } };
}

/** The same sentence createShare() uses when the seat check fails, so the two refusals read alike. */
const NOT_A_SENDER = new SenderRefusedError().message;
