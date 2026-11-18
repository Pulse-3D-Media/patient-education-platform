import { getSeatSummary } from "@/lib/db/seats";
import { hasFreeSeat, noSeatHelp, type NoSeatHelp } from "@/lib/seats";

/**
 * Which line a library page shows someone without a seat (noSeatHelp() in
 * lib/seats.ts has the rule). Server only. A member, or someone holding a
 * seat, costs nothing; only an office admin without a seat has the seats
 * counted, a plain read for the words, never a decision (Take a seat is
 * decided again on the server, under the clinic's lock).
 */
export async function seatHelpFor(clinic: { id: string; isOwner: boolean; isAdmin: boolean }, seat: unknown): Promise<NoSeatHelp> {
  if (seat || !(clinic.isAdmin || clinic.isOwner)) return "ask";
  const summary = clinic.isOwner ? await getSeatSummary(clinic.id) : null;
  return noSeatHelp({ isOwner: clinic.isOwner, isAdmin: clinic.isAdmin, seatFree: summary !== null && hasFreeSeat(summary) });
}
