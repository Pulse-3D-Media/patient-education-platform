import type { Prisma } from "@prisma/client";
import { readClinicLocked } from "./clinic-lock";

/**
 * Lock one clinic and count its taken seats, in that order, for a request
 * that is about to take one (a seat for a person, or a seat held by an
 * invitation).
 *
 * "How many seats are taken?" and "take one more" are two steps. The count
 * is only worth anything if nobody else can take a seat between them, so the
 * clinic's row is locked FIRST (readClinicLocked, the lock every change to a
 * clinic's plan takes too) and the count is read while it is held. Every
 * request that takes a seat starts here, so two of them for one clinic run
 * one after the other, and the second counts the seat the first one took.
 *
 * Seats held by people (SeatAllocation) and by open invitations
 * (SeatInvitation) are counted together: both use up the plan.
 *
 * In a file of its own so the overlap test can wrap it and hold a request
 * still in exactly that gap, after the count and before the write
 * (seats.race.test.ts).
 *
 * Returns null when no clinic has that id.
 */
export async function readSeatsLocked(
  tx: Prisma.TransactionClient,
  clinicId: string,
): Promise<{ surgeonSeats: number; seated: number; invited: number; ownerClerkUserId: string | null } | null> {
  const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true, ownerClerkUserId: true });
  if (!clinic) return null;
  const seated = await tx.seatAllocation.count({ where: { clinicId } });
  const invited = await tx.seatInvitation.count({ where: { clinicId } });
  return { surgeonSeats: clinic.surgeonSeats, seated, invited, ownerClerkUserId: clinic.ownerClerkUserId };
}
