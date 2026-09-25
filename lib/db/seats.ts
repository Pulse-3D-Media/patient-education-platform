import type { Prisma } from "@prisma/client";
import {
  PENDING_WINDOW_MS,
  hasFreeSeat,
  isClerkUserId,
  isHoldId,
  seatCheckIsEmpty,
  seatCountWords,
  seatSummary,
  type HoldRow,
  type SeatCheckPlan,
  type SeatRow,
  type SeatSummary,
} from "../seats";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
import { readSeatsLocked } from "./seat-lock";

/**
 * Every query on who holds a seat at a clinic: the SeatAllocation table (a
 * person's seat) and the SeatInvitation table (a seat held by an invitation
 * that has not been accepted yet). The rules are in lib/seats.ts; read the
 * top of that file first.
 *
 * THE ONE RULE HERE: a seat, for a person or an invitation, is only ever
 * taken inside a transaction that holds the clinic's row lock
 * (readSeatsLocked, which takes the same lock every change to a clinic's
 * plan takes). Inside it the taken seats are counted and compared with the
 * seats on the plan, and only then is the row written. Two requests for one
 * clinic therefore happen one after the other, and the second one counts the
 * seat the first one took. A plan being lowered takes the same lock, so it
 * and a seat being taken can never cross either.
 *
 * Nothing here talks to Clerk, and no transaction here is held open across a
 * call to Clerk: a lock held while waiting on another company's server would
 * make a surgeon's Send button wait too. lib/seat-changes.ts does the Clerk
 * half, in an order where every way it can stop halfway is harmless.
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

function checkHoldId(holdId: string) {
  if (!isHoldId(holdId)) throw new Error("Seats: that is not a seat hold id.");
}

/** Count the seats taken at one clinic (people and open invitations), inside a transaction that already holds its lock. For the plan and billing writers. */
export async function countSeatsInUseIn(tx: Prisma.TransactionClient, clinicId: string): Promise<number> {
  return (await tx.seatAllocation.count({ where: { clinicId } })) + (await tx.seatInvitation.count({ where: { clinicId } }));
}

/** The summary, read inside a transaction, for a clinic whose seats the caller has already read under the lock. */
async function summaryIn(tx: Prisma.TransactionClient, clinicId: string, paid: number): Promise<SeatSummary> {
  const seated = await tx.seatAllocation.count({ where: { clinicId } });
  const invited = await tx.seatInvitation.count({ where: { clinicId } });
  return seatSummary(paid, seated, invited);
}

async function note(tx: Prisma.TransactionClient, clinicId: string, log: SeatLog | undefined, summary: SeatSummary) {
  if (!log) return;
  await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body: log.describe(summary), authorName: log.authorName }, select: { id: true } });
}

/** The seats taken at one clinic, for a page to show. A plain read: never decide anything from it, decide under the lock. */
export async function getSeatSummary(clinicId: string): Promise<SeatSummary | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { surgeonSeats: true, _count: { select: { seatAllocations: true, seatInvitations: true } } },
  });
  return clinic ? seatSummary(clinic.surgeonSeats, clinic._count.seatAllocations, clinic._count.seatInvitations) : null;
}

/** What lib/seat-changes.ts needs to know about a clinic before it talks to Clerk. Null for an unknown id. */
export async function getSeatClinic(clinicId: string) {
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, clerkOrgId: true, surgeonSeats: true, ownerClerkUserId: true },
  });
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

/** One clinic's seats held by invitations, as the rules read them. */
export async function listSeatHolds(clinicId: string): Promise<HoldRow[]> {
  return prisma.seatInvitation.findMany({
    where: { clinicId },
    select: { id: true, clerkInvitationId: true, reservedAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });
}

// ---------------------------------------------------------------------------
// A person's seat
// ---------------------------------------------------------------------------

export type ReserveResult =
  /** The person holds a seat. `fresh` is true when THIS call gave it, false when they already had one (a repeat, a second tab, a retry). */
  | { held: true; fresh: boolean; summary: SeatSummary }
  /** No seat was free. Nothing was written. */
  | { held: false; summary: SeatSummary };

/**
 * Give one person a seat, if the clinic has one free, and write the log
 * entry in the same transaction.
 *
 * Safe to repeat: a person who already holds a seat is simply told so, is
 * not counted twice (the table allows one row per person per clinic), and
 * nothing is logged again. Throws if the clinic does not exist.
 */
export async function reserveSeat(clinicId: string, clerkUserId: string, log?: SeatLog, now: Date = new Date()): Promise<ReserveResult> {
  checkUserId(clerkUserId);
  return prisma.$transaction(async (tx) => {
    // The lock, then the count, in one step (see seat-lock.ts). Everything
    // below trusts the count, and may: nobody else can take a seat until this
    // transaction ends.
    const clinic = await readSeatsLocked(tx, clinicId);
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const before = seatSummary(clinic.surgeonSeats, clinic.seated, clinic.invited);

    const key = { clinicId_clerkUserId: { clinicId, clerkUserId } };
    const existing = await tx.seatAllocation.findUnique({ where: key, select: { id: true } });
    if (existing) return { held: true, fresh: false, summary: before };

    if (!hasFreeSeat(before)) return { held: false, summary: before };

    await tx.seatAllocation.create({ data: { clinicId, clerkUserId, syncState: "SYNCED", reservedAt: now }, select: { id: true } });
    const after = seatSummary(clinic.surgeonSeats, clinic.seated + 1, clinic.invited);
    await note(tx, clinicId, log, after);
    return { held: true, fresh: true, summary: after };
  });
}

/**
 * Let one person's seat go, and log it in the same transaction. Safe to
 * repeat: letting go of a seat that is not there changes nothing and logs
 * nothing.
 */
export async function releaseSeat(clinicId: string, clerkUserId: string, log?: SeatLog) {
  checkUserId(clerkUserId);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

    const removed = await tx.seatAllocation.deleteMany({ where: { clinicId, clerkUserId } });
    const summary = await summaryIn(tx, clinicId, clinic.surgeonSeats);
    if (removed.count > 0) await note(tx, clinicId, log, summary);
    return { released: removed.count > 0, summary };
  });
}

// ---------------------------------------------------------------------------
// A seat held by an invitation
// ---------------------------------------------------------------------------

export type HoldResult = { held: true; holdId: string; summary: SeatSummary } | { held: false; summary: SeatSummary };

/**
 * Hold a seat for an invitation that is about to be sent, if the clinic has
 * one free. Step one of inviting someone (lib/seat-changes.ts): the hold is
 * written here, under the lock, BEFORE Clerk is asked to send anything, so
 * no invitation ever goes out without a seat behind it.
 *
 * The hold has no Clerk invitation id yet; linkSeatHold() records it once
 * Clerk has made the invitation. A hold that never gets one is let go by the
 * seat check after a few minutes. Nothing is logged here: the invitation is
 * logged when it has really been sent.
 */
export async function holdSeatForInvitation(clinicId: string, now: Date = new Date()): Promise<HoldResult> {
  return prisma.$transaction(async (tx) => {
    const clinic = await readSeatsLocked(tx, clinicId);
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const before = seatSummary(clinic.surgeonSeats, clinic.seated, clinic.invited);
    if (!hasFreeSeat(before)) return { held: false, summary: before };

    const hold = await tx.seatInvitation.create({ data: { clinicId, reservedAt: now }, select: { id: true } });
    return { held: true, holdId: hold.id, summary: seatSummary(clinic.surgeonSeats, clinic.seated, clinic.invited + 1) };
  });
}

/**
 * Record the Clerk invitation a hold belongs to, and log the invitation.
 * Returns false (and logs nothing) when the hold is not there any more: it
 * was let go in the meantime, which only happens minutes later.
 */
export async function linkSeatHold(clinicId: string, holdId: string, clerkInvitationId: string, log?: SeatLog): Promise<boolean> {
  checkHoldId(holdId);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const changed = await tx.seatInvitation.updateMany({ where: { id: holdId, clinicId, clerkInvitationId: null }, data: { clerkInvitationId } });
    if (changed.count === 1) await note(tx, clinicId, log, await summaryIn(tx, clinicId, clinic.surgeonSeats));
    return changed.count === 1;
  });
}

/** The hold behind one of this clinic's Clerk invitations, or null. Scoped by clinic, so another clinic's invitation id finds nothing. */
export async function getSeatHoldForInvitation(clinicId: string, clerkInvitationId: string) {
  return prisma.seatInvitation.findFirst({ where: { clinicId, clerkInvitationId }, select: { id: true } });
}

/** Let a held seat go, and log it in the same transaction. Safe to repeat: a hold that is not there changes nothing and logs nothing. */
export async function releaseSeatHold(clinicId: string, holdId: string, log?: SeatLog) {
  checkHoldId(holdId);
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const removed = await tx.seatInvitation.deleteMany({ where: { id: holdId, clinicId } });
    const summary = await summaryIn(tx, clinicId, clinic.surgeonSeats);
    if (removed.count > 0) await note(tx, clinicId, log, summary);
    return { released: removed.count > 0, summary };
  });
}

// ---------------------------------------------------------------------------
// Bringing the tables back into line with Clerk
// ---------------------------------------------------------------------------

export type SeatCheckResult = {
  released: number;
  converted: number;
  adopted: number;
  ownerCleared: boolean;
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
 *   - a hold is only turned into a seat, or let go, if it is still there;
 *   - a hold that was "never made" is only let go if it still has no
 *     invitation id and is still older than the window;
 *   - a seat is only given while the count, read again here under the lock,
 *     is below the seats on the plan. So this can never put a clinic over;
 *   - the owner is only cleared if the owner is still the person the plan saw.
 *
 * Safe to run twice: the second run finds nothing to do.
 */
export async function applySeatCheck(
  clinicId: string,
  plan: SeatCheckPlan,
  expectedOwner: string | null,
  now: Date = new Date(),
): Promise<SeatCheckResult> {
  for (const userId of [...plan.confirm, ...plan.release, ...plan.adopt, ...plan.convert.map((entry) => entry.userId)]) checkUserId(userId);
  for (const holdId of [...plan.dropHolds.map((entry) => entry.holdId), ...plan.convert.map((entry) => entry.holdId), ...plan.link.map((entry) => entry.holdId)]) {
    checkHoldId(holdId);
  }

  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, surgeonSeats: true, ownerClerkUserId: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

    let released = 0;
    let converted = 0;
    let adopted = 0;
    let ownerCleared = false;
    const because: string[] = [];

    if (!seatCheckIsEmpty(plan)) {
      if (plan.confirm.length > 0) {
        await tx.seatAllocation.updateMany({ where: { clinicId, clerkUserId: { in: plan.confirm }, syncState: "PENDING" }, data: { syncState: "SYNCED" } });
      }

      if (plan.release.length > 0) {
        released = (await tx.seatAllocation.deleteMany({ where: { clinicId, clerkUserId: { in: plan.release } } })).count;
        if (released > 0) because.push(`${plural(released, "seat", "seats")} let go because the person is no longer in the clinic`);
      }

      for (const { holdId, invitationId } of plan.link) {
        // Two holds cannot share one invitation (the column is unique); a clash means it is already recorded.
        const taken = await tx.seatInvitation.findUnique({ where: { clerkInvitationId: invitationId }, select: { id: true } });
        if (!taken) await tx.seatInvitation.updateMany({ where: { id: holdId, clinicId, clerkInvitationId: null }, data: { clerkInvitationId: invitationId } });
      }

      // An accepted invitation: the hold goes and the person's seat comes, in
      // one step, so the count does not change and nobody can slip in between.
      for (const { holdId, userId } of plan.convert) {
        const gone = (await tx.seatInvitation.deleteMany({ where: { id: holdId, clinicId } })).count;
        if (gone === 0) continue;
        const already = await tx.seatAllocation.findUnique({ where: { clinicId_clerkUserId: { clinicId, clerkUserId: userId } }, select: { id: true } });
        if (!already) {
          await tx.seatAllocation.create({ data: { clinicId, clerkUserId: userId, syncState: "SYNCED", reservedAt: now }, select: { id: true } });
          converted += 1;
        }
      }
      if (converted > 0) because.push(`${plural(converted, "invitation was", "invitations were")} accepted and turned into ${converted === 1 ? "a seat" : "seats"}`);

      const cutoff = new Date(now.getTime() - PENDING_WINDOW_MS);
      let closedHolds = 0;
      for (const { holdId, reason } of plan.dropHolds) {
        const where =
          reason === "never-made" ? { id: holdId, clinicId, clerkInvitationId: null, reservedAt: { lt: cutoff } } : { id: holdId, clinicId };
        const gone = (await tx.seatInvitation.deleteMany({ where })).count;
        if (gone > 0 && reason === "closed") closedHolds += 1;
        released += gone;
      }
      // A hold whose invitation was never made was never really anyone's seat, so it is counted but not written up.
      if (closedHolds > 0) because.push(`${plural(closedHolds, "seat", "seats")} let go because ${closedHolds === 1 ? "its invitation was" : "their invitations were"} revoked or expired`);

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
        if (alreadySeated.has(userId) || userId === clinic.ownerClerkUserId) continue;
        if (!hasFreeSeat(await summaryIn(tx, clinicId, clinic.surgeonSeats))) break;
        await tx.seatAllocation.create({ data: { clinicId, clerkUserId: userId, syncState: "SYNCED", reservedAt: now }, select: { id: true } });
        adopted += 1;
      }
      if (adopted > 0) because.push(`${plural(adopted, "person who was waiting was", "people who were waiting were")} given a seat`);

      if (plan.ownerLeft && expectedOwner !== null && clinic.ownerClerkUserId === expectedOwner) {
        await tx.clinic.update({ where: { id: clinicId }, data: { ownerClerkUserId: null }, select: { id: true } });
        ownerCleared = true;
        because.push("the account owner is no longer in the clinic, so it has no account owner until Pulse 3D sets one");
      }
    }

    const summary = await summaryIn(tx, clinicId, clinic.surgeonSeats);
    if (because.length > 0) {
      const body = `Seats checked against the clinic's people: ${because.join("; ")}. Now ${seatCountWords(summary)}.`;
      await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body, authorName: SEATS_AUTHOR }, select: { id: true } });
    }
    return { released, converted, adopted, ownerCleared, summary };
  });
}
