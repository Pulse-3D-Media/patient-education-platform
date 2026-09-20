import { addClinicNote } from "./db/notes";
import { applySeatCheck, confirmSeat, getSeatClinic, getSeatSummary, listSeatRows, releaseSeat, reserveSeat, type SeatLog } from "./db/seats";
import { getMember, listPeople, writeKindToClerk, type Person } from "./people";
import type { Kind } from "./roles";
import { isClerkUserId, planSeatCheck, seatCheckIsEmpty, seatCountWords, seatStateOf, seatSummary, seatsFullMessage, type SeatState, type SeatSummary } from "./seats";

/**
 * THE ONLY WAY A PERSON BECOMES A SURGEON OR STAFF. SERVER ONLY.
 *
 * Every route that can change someone's kind comes through changeKind():
 * the surgeon question at /onboarding/kind and the Surgeon / Staff control
 * on /admin/people. Nothing else writes the label (writeKindToClerk in
 * lib/people.ts), and a test checks that nothing else imports it.
 *
 * Read the top of lib/seats.ts first. In short: the LABEL lives in Clerk, the
 * SEAT lives in our SeatAllocation table, and the table is the authority on
 * who holds a paid seat.
 *
 * A database transaction cannot make a call to Clerk part of itself, and this
 * file does not pretend it can. Instead every change is ordered so that each
 * way it can fail halfway leaves something harmless, which checkSeats() then
 * puts right:
 *
 *   Becoming a surgeon   1. reserve a seat in our table, under the clinic's
 *                           lock (refused here if none is free);
 *                        2. write "surgeon" to Clerk, with no lock held;
 *                        3. mark the seat confirmed.
 *                        If 2 fails, the reservation made in 1 is let go. If
 *                        that fails too, or the server dies, a PENDING seat
 *                        is left: the People page shows "Try again", and the
 *                        seat is let go by itself after a few minutes.
 *                        If 3 fails, Clerk says surgeon and the seat is
 *                        PENDING: the next check confirms it.
 *
 *   Becoming staff       1. write "staff" to Clerk;
 *                        2. let the seat go.
 *                        If 1 fails nothing has changed. If 2 fails, a seat
 *                        is left with a staff label: the next check lets it go.
 *
 * In no order of events can more people hold a seat than the plan pays for,
 * because step 1 of becoming a surgeon is the only thing that adds a seat and
 * it counts under the lock.
 *
 * The clinic id is always the server's own (the signed-in person's clinic, or
 * a clinic Pulse staff opened). The organization the label is written to is
 * read from that clinic's row here, so the two can never be a mismatched pair,
 * and the person is checked to be a member of THAT organization before
 * anything is written for them.
 */

/** Who is asking. */
export type KindActor =
  /** The person themselves, answering the surgeon question. Allowed once, and only about themselves. */
  | { type: "self" }
  /** An office admin of the clinic, on the People page. */
  | { type: "admin"; name: string };

export type KindChange =
  | { ok: true; kind: Kind; seat: SeatState; summary: SeatSummary | null }
  | {
      ok: false;
      reason: "no-clinic" | "not-a-member" | "already-answered" | "full" | "not-saved";
      /** A plain sentence, safe to show. */
      message: string;
    };

const NOT_SAVED = "That could not be saved just now. Nothing was changed. Try again in a moment.";

/** Only the kind of error goes to the server log: never a message, which could carry an id or an address. */
function logFailure(what: string, error: unknown) {
  console.error(`Seats: ${what}`, error instanceof Error ? error.name : "unknown error");
}

export async function changeKind(args: { clinicId: string; targetUserId: string; kind: Kind; actor: KindActor }): Promise<KindChange> {
  const { clinicId, targetUserId, kind, actor } = args;

  if (!isClerkUserId(targetUserId)) return { ok: false, reason: "not-a-member", message: "That person is not in your clinic." };

  const clinic = await getSeatClinic(clinicId);
  if (!clinic?.clerkOrgId) return { ok: false, reason: "no-clinic", message: "Your clinic could not be found. Sign in again and try once more." };
  const orgId = clinic.clerkOrgId;

  // Is this person in THIS clinic? Asked of Clerk, about the clinic's own
  // organization, before anything is reserved or written for them.
  let member: Person | null;
  try {
    member = await getMember(orgId, targetUserId);
  } catch (error) {
    logFailure("could not read the person from Clerk", error);
    return { ok: false, reason: "not-saved", message: NOT_SAVED };
  }
  if (!member) return { ok: false, reason: "not-a-member", message: "That person is not in your clinic." };

  // The surgeon question is asked once. An answer that is already there is
  // never changed from here, whatever is sent: that is the admin's job.
  if (actor.type === "self" && member.kind !== null) {
    return { ok: false, reason: "already-answered", message: "You have already answered this. Your office admin can change it on the People page." };
  }

  return kind === "staff" ? makeStaff(clinicId, orgId, member, actor) : makeSurgeon(clinicId, orgId, member, actor);
}

function authorOf(actor: KindActor, member: Person) {
  return actor.type === "admin" ? `${actor.name} (clinic admin)` : member.name;
}

async function makeStaff(clinicId: string, orgId: string, member: Person, actor: KindActor): Promise<KindChange> {
  try {
    if (member.kind !== "staff") await writeKindToClerk(orgId, member.userId, "staff");
  } catch (error) {
    logFailure("the staff label could not be written to Clerk", error);
    return { ok: false, reason: "not-saved", message: NOT_SAVED };
  }

  const log: SeatLog = {
    authorName: authorOf(actor, member),
    describe: (summary) => `${member.name} marked as staff, so their surgeon seat was let go. Now ${seatCountWords(summary)}.`,
  };
  try {
    const { summary } = await releaseSeat(clinicId, member.userId, log);
    return { ok: true, kind: "staff", seat: "none", summary };
  } catch (error) {
    // The label is saved. The seat is still held under a staff label, which the next check lets go.
    logFailure("a seat could not be let go after the staff label was saved", error);
    return { ok: true, kind: "staff", seat: "none", summary: null };
  }
}

async function makeSurgeon(clinicId: string, orgId: string, member: Person, actor: KindActor): Promise<KindChange> {
  let reserved = await reserveSeat(clinicId, member.userId);

  if (!reserved.held) {
    // Before saying no: the count may include someone who has left the clinic
    // since anyone last looked. Check against Clerk once, and try once more.
    const board = await checkSeats(clinicId).catch((error) => {
      logFailure("the seats could not be checked against Clerk", error);
      return null;
    });
    if (board && board.released > 0) reserved = await reserveSeat(clinicId, member.userId);
  }

  if (!reserved.held) {
    if (actor.type === "admin") return { ok: false, reason: "full", message: seatsFullMessage(reserved.summary) };

    // The person's own first answer, with no seat free (the clinic has not
    // paid yet, or is full). Their answer is kept and they are let in: a
    // surgeon WAITING for a seat. No seat is taken and nobody is charged.
    try {
      await writeKindToClerk(orgId, member.userId, "surgeon");
    } catch (error) {
      logFailure("the surgeon label could not be written to Clerk", error);
      return { ok: false, reason: "not-saved", message: NOT_SAVED };
    }
    const summary = reserved.summary;
    await addClinicNote(clinicId, {
      kind: "STATUS",
      authorName: member.name,
      body: `${member.name} said they are a surgeon. No seat was free (${seatCountWords(summary)}), so they are waiting for one. No seat was taken and no charge was changed.`,
    }).catch((error) => logFailure("a waiting surgeon could not be written to the log", error));
    return { ok: true, kind: "surgeon", seat: "waiting", summary };
  }

  try {
    if (member.kind !== "surgeon") await writeKindToClerk(orgId, member.userId, "surgeon");
  } catch (error) {
    logFailure("the surgeon label could not be written to Clerk", error);
    // Only the request that MADE the reservation undoes it. A repeat that
    // found one already there leaves it for the request it belongs to.
    if (reserved.fresh) {
      await releaseSeat(clinicId, member.userId).catch((releaseError) => logFailure("a failed reservation could not be let go; it lets itself go in a few minutes", releaseError));
    }
    return { ok: false, reason: "not-saved", message: NOT_SAVED };
  }

  const log: SeatLog = {
    authorName: authorOf(actor, member),
    describe: (summary) =>
      actor.type === "admin"
        ? `Surgeon seat given to ${member.name}. Now ${seatCountWords(summary)}.`
        : `${member.name} said they are a surgeon and was given a seat. Now ${seatCountWords(summary)}.`,
  };
  try {
    const confirmed = await confirmSeat(clinicId, member.userId, log);
    if (confirmed.holdsSeat) return { ok: true, kind: "surgeon", seat: "held", summary: confirmed.summary };

    // The reservation vanished between steps 1 and 3 (it can only have been
    // let go as stale, minutes later). The label is saved; take a seat again
    // if there still is one, and say honestly if there is not.
    const again = await reserveSeat(clinicId, member.userId);
    if (!again.held) return { ok: true, kind: "surgeon", seat: "waiting", summary: again.summary };
    const second = await confirmSeat(clinicId, member.userId, log);
    return { ok: true, kind: "surgeon", seat: "held", summary: second.summary };
  } catch (error) {
    // The seat is reserved and the label is saved. The next check confirms it.
    logFailure("a seat could not be confirmed after the surgeon label was saved", error);
    return { ok: true, kind: "surgeon", seat: "held", summary: null };
  }
}

// ---------------------------------------------------------------------------
// Checking the seats against the clinic's people
// ---------------------------------------------------------------------------

export type SeatedPerson = Person & { seat: SeatState };

/** Everyone in a clinic with where each stands, after the seats have been brought into line. */
export type SeatBoard = {
  people: SeatedPerson[];
  summary: SeatSummary;
  /** Surgeons with no seat. */
  waiting: number;
  /** Reserved seats Clerk has not confirmed: "Try again" on the People page. */
  pending: number;
  /** Seats this check let go. */
  released: number;
};

/**
 * Read a clinic's people from Clerk, bring its seats into line with them
 * (planSeatCheck in lib/seats.ts says how, applySeatCheck in lib/db/seats.ts
 * does it under the lock), and return everyone with where they stand.
 *
 * This is what notices a person removed in Clerk's own panel, a label
 * changed in Clerk's dashboard, a surgeon who arrived already labelled (an
 * invitation can carry the label), surgeons marked before seats existed, and
 * a change of ours that failed halfway. There are no background jobs, so it
 * runs where it matters: whenever the People page or a clinic's /pulse page
 * is opened, and before anyone is told a clinic is full.
 *
 * Safe to run at any time and any number of times: it only ever lets seats
 * go or fills free ones, never relabels anyone, and never goes over the plan.
 * A check that finds nothing to do writes nothing.
 *
 * Throws when Clerk cannot be read; nothing is changed in that case.
 */
export async function checkSeats(clinicId: string, now: Date = new Date()): Promise<SeatBoard> {
  const clinic = await getSeatClinic(clinicId);
  if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

  const people = clinic.clerkOrgId ? await listPeople(clinic.clerkOrgId) : [];
  let rows = await listSeatRows(clinicId);
  let released = 0;

  const plan = planSeatCheck({ seats: clinic.surgeonSeats, members: people, rows, now });
  if (!seatCheckIsEmpty(plan)) {
    try {
      released = (await applySeatCheck(clinicId, plan, now)).released;
      rows = await listSeatRows(clinicId);
    } catch (error) {
      // The page still shows where everyone stands; the check runs again next time.
      logFailure("the seat check could not be applied", error);
    }
  }

  const seated = people.map((person) => ({ ...person, seat: seatStateOf(person, rows) }));
  return {
    people: seated,
    summary: (await getSeatSummary(clinicId)) ?? seatSummary(clinic.surgeonSeats, rows.length),
    waiting: seated.filter((person) => person.seat === "waiting").length,
    pending: seated.filter((person) => person.seat === "pending").length,
    released,
  };
}
