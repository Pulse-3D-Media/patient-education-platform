import type { Prisma } from "@prisma/client";
import { readClinicLocked } from "./clinic-lock";

/**
 * Lock one clinic and count its surgeon seats, in that order, for a request
 * that is about to give one.
 *
 * "How many seats are in use?" and "write one more" are two steps. The count
 * is only worth anything if nobody else can add a seat between them, so the
 * clinic's row is locked FIRST (readClinicLocked, the lock every change to a
 * clinic's plan takes too) and the count is read while it is held. Every
 * request that gives a seat starts here, so two of them for one clinic run
 * one after the other, and the second counts the seat the first one took.
 *
 * In a file of its own so the overlap test can wrap it and hold a request
 * still in exactly that gap, after the count and before the write
 * (seats.race.test.ts).
 *
 * Returns null when no clinic has that id.
 */
export async function readSeatsLocked(tx: Prisma.TransactionClient, clinicId: string): Promise<{ surgeonSeats: number; inUse: number } | null> {
  const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
  if (!clinic) return null;
  const inUse = await tx.seatAllocation.count({ where: { clinicId } });
  return { surgeonSeats: clinic.surgeonSeats, inUse };
}
