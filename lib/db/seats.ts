import type { Prisma } from "@prisma/client";
import {
  PENDING_WINDOW_MS,
  hasFreeSeat,
  isClerkUserId,
  seatCheckIsEmpty,
  seatCountWords,
  seatSummary,
  type SeatCheckPlan,
  type SeatRow,
  type SeatSummary,
} from "../seats";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
import { readSeatsLocked } from "./seat-lock";

/**
 * Every query on the SeatAllocation table: who holds a surgeon seat at a
 * clinic. The rules are in lib/seats.ts; read the top of that file first.
 *
 * THE ONE RULE HERE: a seat is only ever given inside a transaction that
 * holds the clinic's row lock (readClinicLocked, the same lock every change
 * to a clinic's plan takes). Inside it the seats in use are counted and
 * compared with the seats on the plan, and only then is the row written. Two
 * requests for one clinic therefore happen one after the other, and the
 * second one counts the seat the first one took. A plan being lowered takes
 * the same lock, so it and a seat being given can never cross either.
 *
 * Nothing here talks to Clerk, and no transaction here is held open across a
 * call to Clerk: a lock held while waiting on another company's server would
 * make a surgeon's Send button wait too. lib/seat-changes.ts reserves a seat
 * here, writes the label to Clerk with no lock held, then confirms here.
 *
 * Every function takes the clinic id first (rule 1), and that id always comes
 * from the server's own check of who is signed in, never from the browser.
 */

/** The longest list of seats ever read. A clinic is at most 20 people on Clerk's plan; this only bounds the query (rule 8). */
const MAX_ROWS = 1000;

/** Who the log says did it, when the app let seats go or gave them on its own. */
export const SEATS_AUTHOR = "seats";

/** An entry for the clinic's log. The sentence is built under the lock, so its "2 of 3 in use" is the count that was really there. */
export type SeatLog = {
  authorName: string;
  describe: (summary: SeatSummary) => string;
};

function checkUserId(clerkUserId: string) {
  if (!isClerkUserId(clerkUserId)) throw new Error("Seats: that is not a Clerk user id.");
}

/** Count the seats in use at one clinic, inside a transaction that already holds its lock. For the plan and billing writers. */
export async function countSeatsInUseIn(tx: Prisma.TransactionClient, clinicId: string): Promise<number> {
  return tx.seatAllocation.count({ where: { clinicId } });
}

/** The seats in use at one clinic, for a page to show. A plain read: never decide anything from it, decide under the lock. */
export async function getSeatSummary(clinicId: string): Promise<SeatSummary | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { surgeonSeats: true, _count: { select: { seatAllocations: true } } },
  });
  return clinic ? seatSummary(clinic.surgeonSeats, clinic._count.seatAllocations) : null;
}

/** What lib/seat-changes.ts needs to know about a clinic before it talks to Clerk. Null for an unknown id. */
export async function getSeatClinic(clinicId: string) {
  return prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, clerkOrgId: true, surgeonSeats: true } });
}

/** One clinic's seats, as the rules read them. */
export async function listSeatRows(clinicId: string): Promise<SeatRow[]> {
  return prisma.seatAllocation.findMany({
    where: { clinicId },
    select: { clerkUserId: true, syncState: true, reservedAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });
}

// ---------------------------------------------------------------------------
// Taking a seat: reserve, then (after Clerk has the label) confirm
// ---------------------------------------------------------------------------

export type ReserveResult =
  /** The person holds a seat. `fresh` is true when THIS call made it, false when they already had one (a repeat, a second tab, a retry). */
  | { held: true; fresh: boolean; summary: SeatSummary }
  /** No seat was free. Nothing was written. */
  | { held: false; summary: SeatSummary };

/**
 * Reserve a seat for one person, if the clinic has one free.
 *
 * Safe to repeat: a person who already holds a seat is simply told so, and
 * is not counted twice (the table allows one row per person per clinic). A
 * repeat of a reservation that was never confirmed gets its clock reset, so
 * a "Try again" is not let go halfway through.
 *
 * The seat is PENDING until confirmSeat() is called. Throws if the clinic
 * does not exist.
 */
export async function reserveSeat(clinicId: string, clerkUserId: string, now: Date = new Date()): Promise<ReserveResult> {
  checkUserId(clerkUserId);
  return prisma.$transaction(async (tx) => {
    // The lock, then the count, in one step (see seat-lock.ts). Everything
    // below trusts `inUse`, and may: nobody else can add a seat until this
    // transaction ends.
    const clinic = await readSeatsLocked(tx, clinicId);
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const { inUse } = clinic;

    const key = { clinicId_clerkUserId: { clinicId, clerkUserId } };
    const existing = await tx.seatAllocation.findUnique({ where: key, select: { syncState: true } });

    if (existing) {
      if (existing.syncState === "PENDING") {
        await tx.seatAllocation.update({ where: key, data: { reservedAt: now }, select: { id: true } });
      }
      return { held: true, fresh: false, summary: seatSummary(clinic.surgeonSeats, inUse) };
    }

    const before = seatSummary(clinic.surgeonSeats, inUse);
    if (!hasFreeSeat(before)) return { held: false, summary: before };

    await tx.seatAllocation.create({ data: { clinicId, clerkUserId, syncState: "PENDING", reservedAt: now }, select: { id: true } });
    return { held: true, fresh: true, summary: seatSummary(clinic.surgeonSeats, inUse + 1) };
  });
}

/**
 * Mark a reserved seat as confirmed, once Clerk has the "surgeon" label, and
 * write the log entry for it. The entry is written only when this call is
 * the one that confirmed it, so a repeated request logs once.
 *
 * `confirmed: false` means there was no reserved seat to confirm: it was
 * already confirmed (a repeat), or it is gone. `holdsSeat` tells those apart.
 */
export async function confirmSeat(clinicId: string, clerkUserId: string, log?: SeatLog) {
  checkUserId(clerkUserId);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

    const changed = await tx.seatAllocation.updateMany({ where: { clinicId, clerkUserId, syncState: "PENDING" }, data: { syncState: "SYNCED" } });
    const summary = seatSummary(clinic.surgeonSeats, await countSeatsInUseIn(tx, clinicId));
    const confirmed = changed.count === 1;
    const holdsSeat = confirmed || (await tx.seatAllocation.count({ where: { clinicId, clerkUserId } })) === 1;

    if (confirmed && log) {
      await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body: log.describe(summary), authorName: log.authorName }, select: { id: true } });
    }
    return { confirmed, holdsSeat, summary };
  });
}

/**
 * Let one person's seat go. Safe to repeat: letting go of a seat that is not
 * there changes nothing and logs nothing. The log entry is written only for
 * a CONFIRMED seat; a reservation that never completed was never really
 * theirs, so undoing it is not news.
 */
export async function releaseSeat(clinicId: string, clerkUserId: string, log?: SeatLog) {
  checkUserId(clerkUserId);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

    const key = { clinicId_clerkUserId: { clinicId, clerkUserId } };
    const existing = await tx.seatAllocation.findUnique({ where: key, select: { syncState: true } });
    if (existing) await tx.seatAllocation.delete({ where: key, select: { id: true } });

    const summary = seatSummary(clinic.surgeonSeats, await countSeatsInUseIn(tx, clinicId));
    if (existing?.syncState === "SYNCED" && log) {
      await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body: log.describe(summary), authorName: log.authorName }, select: { id: true } });
    }
    return { released: existing !== null, summary };
  });
}

// ---------------------------------------------------------------------------
// Bringing the table back into line with Clerk
// ---------------------------------------------------------------------------

export type SeatCheckResult = {
  confirmed: number;
  released: number;
  adopted: number;
  summary: SeatSummary;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Apply a plan from planSeatCheck() (lib/seats.ts), in one transaction under
 * the clinic's lock, with one log entry when anything real changed.
 *
 * The plan was worked out from a snapshot taken a moment ago, so every step
 * is guarded against what may have happened since:
 *
 *   - a seat is only let go if it is STILL in the state the plan saw (a
 *     stale reservation that has just been tried again has a new clock and
 *     is left alone);
 *   - a seat is only given while the count, read again here under the lock,
 *     is below the seats on the plan. So this can never put a clinic over.
 *
 * Safe to run twice: the second run finds nothing to do.
 */
export async function applySeatCheck(clinicId: string, plan: SeatCheckPlan, now: Date = new Date()): Promise<SeatCheckResult> {
  for (const userId of [...plan.confirm, ...plan.adopt, ...plan.release.map((entry) => entry.userId)]) checkUserId(userId);

  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

    let confirmed = 0;
    let released = 0;
    let adopted = 0;
    const because: string[] = [];

    if (!seatCheckIsEmpty(plan)) {
      if (plan.confirm.length > 0) {
        confirmed = (await tx.seatAllocation.updateMany({ where: { clinicId, clerkUserId: { in: plan.confirm }, syncState: "PENDING" }, data: { syncState: "SYNCED" } })).count;
      }

      const usersFor = (reason: string) => plan.release.filter((entry) => entry.reason === reason).map((entry) => entry.userId);
      const left = usersFor("left");
      const notSurgeon = usersFor("not-surgeon");
      const stale = usersFor("stale");
      const cutoff = new Date(now.getTime() - PENDING_WINDOW_MS);

      const gone = left.length > 0 ? (await tx.seatAllocation.deleteMany({ where: { clinicId, clerkUserId: { in: left } } })).count : 0;
      const relabelled =
        notSurgeon.length > 0 ? (await tx.seatAllocation.deleteMany({ where: { clinicId, clerkUserId: { in: notSurgeon }, syncState: "SYNCED" } })).count : 0;
      const abandoned =
        stale.length > 0
          ? (await tx.seatAllocation.deleteMany({ where: { clinicId, clerkUserId: { in: stale }, syncState: "PENDING", reservedAt: { lt: cutoff } } })).count
          : 0;
      released = gone + relabelled + abandoned;
      if (gone > 0) because.push(`${plural(gone, "seat", "seats")} let go because the person is no longer in the clinic`);
      if (relabelled > 0) because.push(`${plural(relabelled, "seat", "seats")} let go because the person is marked as staff`);
      // A reservation that never completed was never really anyone's seat, so it is counted but not written up.

      // Someone in the plan may have been given a seat by another request since
      // the snapshot. Every writer holds this lock, so reading who has one now
      // is enough: nobody can be added between this read and the inserts below.
      // (Inserting and catching the duplicate would not do: in Postgres a
      // failed insert spoils the rest of its transaction.)
      const alreadySeated = new Set(
        plan.adopt.length > 0
          ? (await tx.seatAllocation.findMany({ where: { clinicId, clerkUserId: { in: plan.adopt } }, select: { clerkUserId: true } })).map((row) => row.clerkUserId)
          : [],
      );
      for (const userId of plan.adopt) {
        if (alreadySeated.has(userId)) continue;
        const inUse = await countSeatsInUseIn(tx, clinicId);
        if (!hasFreeSeat(seatSummary(clinic.surgeonSeats, inUse))) break;
        await tx.seatAllocation.create({ data: { clinicId, clerkUserId: userId, syncState: "SYNCED", reservedAt: now }, select: { id: true } });
        adopted += 1;
      }
      if (adopted > 0) because.push(`${plural(adopted, "surgeon who was waiting was", "surgeons who were waiting were")} given a seat`);
    }

    const summary = seatSummary(clinic.surgeonSeats, await countSeatsInUseIn(tx, clinicId));
    if (because.length > 0) {
      const body = `Seats checked against the clinic's people: ${because.join("; ")}. Now ${seatCountWords(summary)}.`;
      await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body, authorName: SEATS_AUTHOR }, select: { id: true } });
    }
    return { confirmed, released, adopted, summary };
  });
}
