import { OwnerChangeRefusedError, setClinicOwner } from "./db/clinics";
import { addClinicNote } from "./db/notes";
import {
  applySeatCheck,
  getSeatClinic,
  getSeatHoldForInvitation,
  getSeatSummary,
  holdSeatForInvitation,
  linkSeatHold,
  listSeatHolds,
  listSeatNames,
  listSeatRows,
  releaseSeat,
  releaseSeatHold,
  reserveSeat,
  setSeatDisplayName,
  type SeatLog,
} from "./db/seats";
import {
  getMember,
  invitationIsOpen,
  listOpenInvitations,
  listPeople,
  parseEmail,
  removeFromClerk,
  revokeInvitationInClerk,
  sendInvitationFromClerk,
  setRoleInClerk,
  type OpenInvitation,
  type Person,
} from "./people";
import { ROLE_WORDS, parseRole, type Role } from "./role-names";
import {
  isClerkUserId,
  planSeatCheck,
  seatCheckIsEmpty,
  seatCountWords,
  seatStateOf,
  seatSummary,
  seatsFullMessage,
  type InvitationFacts,
  type SeatState,
  type SeatSummary,
} from "./seats";
import { effectiveSenderName, parseDisplayName } from "./sender-name";

/**
 * THE ONLY WAY ANYONE'S SEAT, ROLE, INVITATION OR OWNERSHIP IS CHANGED.
 * SERVER ONLY.
 *
 * Read the top of lib/seats.ts first. In short: everyone in a clinic except
 * the account owner holds one of the seats the clinic pays for, an open
 * invitation holds one too, and our own tables are the authority on who
 * holds what. Membership, roles and invitations live in Clerk. The writes to
 * Clerk (lib/people.ts) may only be called from here; a test checks that.
 *
 * A database transaction cannot make a call to Clerk part of itself, and this
 * file does not pretend it can. Instead every change is ordered so that each
 * way it can fail halfway leaves something harmless, which checkSeats() then
 * puts right:
 *
 *   Inviting        1. hold a seat in our table, under the clinic's lock
 *                      (refused here if none is free);
 *                   2. ask Clerk to send the invitation, carrying the hold's
 *                      id, with no lock held;
 *                   3. record Clerk's invitation id on the hold.
 *                   If 2 fails the hold is let go. If that fails too, or the
 *                   server dies, the hold lets itself go after a few minutes.
 *                   If 3 fails, the check finds the invitation by the hold id
 *                   it carries and records it then.
 *   Revoking        1. revoke in Clerk; 2. let the hold go. If 2 fails, the
 *                   check sees Clerk says revoked and lets it go.
 *   Removing        1. remove in Clerk; 2. let the seat go. If 2 fails, the
 *                   check sees they have left and lets it go.
 *   Admin on/off    one write to Clerk. Seats are not touched.
 *   Giving a seat   one write here, under the lock. Clerk is not touched.
 *   Name patients   one write here (on the seat), under the lock, after Clerk
 *   see             has confirmed the person is in the clinic.
 *   Handing over    one write here (the owner), under the lock, after Clerk
 *   the owner       has confirmed the new owner is an admin of the clinic.
 *
 * In no order of events can more seats be taken than the plan pays for,
 * because the only things that take one (a hold, a seat given, a waiting
 * person seated by the check) count under the lock first.
 *
 * The clinic id is always the server's own (the signed-in person's clinic, or
 * a clinic Pulse staff opened). The organization is read from that clinic's
 * row here, so the two can never be a mismatched pair, and every person is
 * checked to be a member of THAT organization before anything is written.
 */

/** Who is asking: a clinic admin, already checked on the server by the action. */
export type Actor = { userId: string; name: string };

export type Outcome = { ok: true; message?: string } | { ok: false; message: string };

const NOT_SAVED = "That could not be saved just now. Nothing was changed. Try again in a moment.";
const NOT_IN_CLINIC = "That person is not in your clinic.";

/** Only the kind of error goes to the server log: never a message, which could carry an id or an address. */
function logFailure(what: string, error: unknown) {
  console.error(`Seats: ${what}`, error instanceof Error ? error.name : "unknown error");
}

const byAdmin = (actor: Actor) => `${actor.name} (clinic admin)`;

/** The clinic and its organization, or a refusal. */
async function clinicFor(clinicId: string) {
  const clinic = await getSeatClinic(clinicId);
  return clinic?.clerkOrgId ? { ...clinic, orgId: clinic.clerkOrgId } : null;
}

/** Is this person in the clinic's organization? Asked of Clerk about the clinic's own organization. Null on a failed call. */
async function memberOf(orgId: string, userId: string): Promise<Person | "not-a-member" | null> {
  if (!isClerkUserId(userId)) return "not-a-member";
  try {
    return (await getMember(orgId, userId)) ?? "not-a-member";
  } catch (error) {
    logFailure("could not read the person from Clerk", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inviting and revoking
// ---------------------------------------------------------------------------

/**
 * Invite someone by email, as a Member or a Member with admin. Holds a seat
 * first; refused, with nothing sent, when none is free.
 */
export async function inviteSomeone(args: { clinicId: string; email: unknown; role: unknown; actor: Actor; acceptUrl?: string | null }): Promise<Outcome> {
  const email = parseEmail(args.email);
  if (!email) return { ok: false, message: "Enter an email address, like name@clinic.com." };
  const role = parseRole(args.role);
  if (!role) return { ok: false, message: "Choose Member or Member with admin." };

  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };

  // Already here, or already invited? A sentence is kinder than Clerk's refusal.
  try {
    const [people, invitations] = await Promise.all([listPeople(clinic.orgId), listOpenInvitations(clinic.orgId)]);
    if (people.some((person) => person.email.toLowerCase() === email)) return { ok: false, message: `${email} is already in your clinic.` };
    if (invitations.some((invitation) => invitation.email.toLowerCase() === email)) {
      return { ok: false, message: `${email} already has an open invitation. Revoke it first to send a new one.` };
    }
  } catch (error) {
    logFailure("could not read the clinic's people before inviting", error);
    return { ok: false, message: NOT_SAVED };
  }

  let hold = await holdSeatForInvitation(args.clinicId);
  if (!hold.held) {
    // Before saying no: a seat may be held by someone who has left, or by an
    // invitation that was revoked in Clerk. Check once, and try once more.
    const board = await checkSeats(args.clinicId).catch((error) => {
      logFailure("the seats could not be checked against Clerk", error);
      return null;
    });
    if (board && board.released > 0) hold = await holdSeatForInvitation(args.clinicId);
  }
  if (!hold.held) return { ok: false, message: seatsFullMessage(hold.summary) };

  let invitationId: string;
  try {
    invitationId = await sendInvitationFromClerk(clinic.orgId, { email, role, inviterUserId: args.actor.userId, seatHoldId: hold.holdId, acceptUrl: args.acceptUrl ?? null });
  } catch (error) {
    logFailure("Clerk did not send the invitation", error);
    await releaseSeatHold(args.clinicId, hold.holdId).catch((releaseError) => logFailure("a hold could not be let go; it lets itself go in a few minutes", releaseError));
    return { ok: false, message: "The invitation could not be sent. Check the address and try again. No seat was used." };
  }

  const log: SeatLog = {
    authorName: byAdmin(args.actor),
    describe: (summary) => `Invitation sent as ${ROLE_WORDS[role]}, holding a seat until it is accepted, revoked or expires. Now ${seatCountWords(summary)}.`,
  };
  await linkSeatHold(args.clinicId, hold.holdId, invitationId, log).catch((error) =>
    // The invitation is out and carries the hold's id: the next check records it.
    logFailure("the invitation id could not be recorded on its hold", error),
  );
  return { ok: true, message: `Invitation sent to ${email}. It holds a seat until it is accepted, revoked or expires.` };
}

/** Revoke one of the clinic's open invitations, and free the seat it held. */
export async function revokeInvitation(args: { clinicId: string; invitationId: unknown; actor: Actor }): Promise<Outcome> {
  const invitationId = typeof args.invitationId === "string" ? args.invitationId.trim() : "";
  if (!/^[A-Za-z0-9_]{1,100}$/.test(invitationId)) return { ok: false, message: "That invitation could not be found." };

  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };

  try {
    // Asked about THIS clinic's organization: another clinic's invitation id is "not open" here.
    if (!(await invitationIsOpen(clinic.orgId, invitationId))) {
      // Already gone (revoked, expired or accepted). Free its seat if it still holds one: the check would too.
      await checkSeats(args.clinicId).catch((error) => logFailure("the seats could not be checked against Clerk", error));
      return { ok: true, message: "That invitation is no longer open." };
    }
    await revokeInvitationInClerk(clinic.orgId, invitationId, args.actor.userId);
  } catch (error) {
    logFailure("Clerk did not revoke the invitation", error);
    return { ok: false, message: NOT_SAVED };
  }

  const hold = await getSeatHoldForInvitation(args.clinicId, invitationId).catch(() => null);
  if (hold) {
    await releaseSeatHold(args.clinicId, hold.id, {
      authorName: byAdmin(args.actor),
      describe: (summary) => `An invitation was revoked, so the seat it held is free. Now ${seatCountWords(summary)}.`,
    }).catch((error) => logFailure("a revoked invitation's hold could not be let go; the next check does it", error));
  }
  return { ok: true, message: "Invitation revoked." };
}

// ---------------------------------------------------------------------------
// People already in the clinic
// ---------------------------------------------------------------------------

/**
 * Switch admin on or off for one person. Never touches seats. The account
 * owner cannot have admin switched off (they hand the account over first),
 * and the last admin cannot be made a plain member.
 */
export async function setAdmin(args: { clinicId: string; targetUserId: unknown; admin: boolean; actor: Actor }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  const targetUserId = typeof args.targetUserId === "string" ? args.targetUserId : "";

  const member = await memberOf(clinic.orgId, targetUserId);
  if (member === null) return { ok: false, message: NOT_SAVED };
  if (member === "not-a-member") return { ok: false, message: NOT_IN_CLINIC };

  const role: Role = args.admin ? "admin" : "member";
  if (member.role === role) return { ok: true };

  if (!args.admin) {
    if (member.userId === clinic.ownerClerkUserId) {
      return { ok: false, message: "The account owner always has admin. To switch it off, make someone else the account owner first." };
    }
    try {
      const admins = (await listPeople(clinic.orgId)).filter((person) => person.role === "admin");
      if (admins.length <= 1) return { ok: false, message: "Your clinic needs at least one admin. Switch admin on for someone else first." };
    } catch (error) {
      logFailure("could not count the clinic's admins", error);
      return { ok: false, message: NOT_SAVED };
    }
  }

  try {
    await setRoleInClerk(clinic.orgId, member.userId, role);
  } catch (error) {
    logFailure("Clerk did not change the role", error);
    return { ok: false, message: NOT_SAVED };
  }
  await addClinicNote(args.clinicId, {
    kind: "STATUS",
    authorName: byAdmin(args.actor),
    body: `Admin switched ${args.admin ? "on" : "off"} for ${member.name}. Seats were not changed.`,
  }).catch((error) => logFailure("a role change could not be written to the log", error));
  return { ok: true };
}

/** Take one person out of the clinic and free their seat. Not the account owner, and not yourself. */
export async function removePerson(args: { clinicId: string; targetUserId: unknown; actor: Actor }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  const targetUserId = typeof args.targetUserId === "string" ? args.targetUserId : "";

  const member = await memberOf(clinic.orgId, targetUserId);
  if (member === null) return { ok: false, message: NOT_SAVED };
  if (member === "not-a-member") return { ok: false, message: NOT_IN_CLINIC };
  if (member.userId === clinic.ownerClerkUserId) {
    return { ok: false, message: "The account owner cannot be removed. Make someone else the account owner first." };
  }
  if (member.userId === args.actor.userId) return { ok: false, message: "You cannot remove yourself here. Ask another admin to do it." };

  try {
    await removeFromClerk(clinic.orgId, member.userId);
  } catch (error) {
    logFailure("Clerk did not remove the person", error);
    return { ok: false, message: NOT_SAVED };
  }

  const authorName = byAdmin(args.actor);
  try {
    const { released } = await releaseSeat(args.clinicId, member.userId, {
      authorName,
      describe: (summary) => `${member.name} was removed from the clinic, so their seat is free. Now ${seatCountWords(summary)}.`,
    });
    if (!released) await addClinicNote(args.clinicId, { kind: "STATUS", authorName, body: `${member.name} was removed from the clinic. They held no seat.` });
  } catch (error) {
    // They are out of the clinic; the next check lets their seat go.
    logFailure("a removed person's seat could not be let go; the next check does it", error);
  }
  return { ok: true, message: `${member.name} was removed from your clinic.` };
}

/**
 * Give a seat to someone who is waiting for one, if a seat is free. The
 * account owner decides for themselves: only the owner may give the owner a
 * seat.
 */
export async function giveSeat(args: { clinicId: string; targetUserId: unknown; actor: Actor }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  const targetUserId = typeof args.targetUserId === "string" ? args.targetUserId : "";

  if (targetUserId === clinic.ownerClerkUserId && targetUserId !== args.actor.userId) {
    return { ok: false, message: "Only the account owner decides whether they take a seat." };
  }
  const member = await memberOf(clinic.orgId, targetUserId);
  if (member === null) return { ok: false, message: NOT_SAVED };
  if (member === "not-a-member") return { ok: false, message: NOT_IN_CLINIC };

  const self = member.userId === args.actor.userId;
  const log: SeatLog = {
    authorName: byAdmin(args.actor),
    describe: (summary) => `${self ? `${member.name} took a seat` : `Seat given to ${member.name}`}. Now ${seatCountWords(summary)}.`,
  };
  let result = await reserveSeat(args.clinicId, member.userId, log);
  if (!result.held) {
    const board = await checkSeats(args.clinicId).catch((error) => {
      logFailure("the seats could not be checked against Clerk", error);
      return null;
    });
    if (board && board.released > 0) result = await reserveSeat(args.clinicId, member.userId, log);
  }
  if (!result.held) return { ok: false, message: seatsFullMessage(result.summary) };
  return { ok: true };
}

/**
 * The account owner gives up their own seat. Only the owner, and only their
 * own: everyone else needs a seat, and leaves one by being removed.
 */
export async function releaseOwnSeat(args: { clinicId: string; actor: Actor }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  if (clinic.ownerClerkUserId !== args.actor.userId) {
    return { ok: false, message: "Only the account owner can go without a seat. Everyone else in the clinic needs one." };
  }
  await releaseSeat(args.clinicId, args.actor.userId, {
    authorName: byAdmin(args.actor),
    describe: (summary) => `${args.actor.name} (account owner) gave up their seat. Now ${seatCountWords(summary)}.`,
  });
  return { ok: true };
}

/**
 * Set how a seated person's name appears to patients on the links they send
 * ("Jane Smith, PA-C"), or clear it (an empty box) to go back to "Dr. First
 * Last" from Clerk. Only for someone holding a seat, since only they send
 * links. Links already sent keep the name they were made with. Clerk is only
 * read (is this person in the clinic?), never written.
 */
export async function setPatientName(args: { clinicId: string; targetUserId: unknown; name: unknown; actor: Actor }): Promise<Outcome> {
  const parsed = parseDisplayName(args.name);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  const member = await memberOf(clinic.orgId, typeof args.targetUserId === "string" ? args.targetUserId : "");
  if (member === null) return { ok: false, message: NOT_SAVED };
  if (member === "not-a-member") return { ok: false, message: NOT_IN_CLINIC };

  const fallback = member.defaultPatientName ?? null;
  const shown = (name: string | null) => (name ? `"${name}"` : fallback ? `the default, "${fallback}"` : "no name");
  const result = await setSeatDisplayName(args.clinicId, member.userId, parsed.name, {
    authorName: byAdmin(args.actor),
    describe: (before, after) => `Name patients see for ${member.name} changed from ${shown(before)} to ${shown(after)}. Links already sent keep the old name.`,
  });
  if (!result.found) return { ok: false, message: `${member.name} does not hold a seat, and only people with a seat send links. Give them a seat first.` };
  const now = effectiveSenderName(parsed.name, fallback);
  return {
    ok: true,
    message: now ? `Patients will see "${now}" on links from ${member.name} from now on.` : `Links from ${member.name} will name only your clinic until a name is set.`,
  };
}

// ---------------------------------------------------------------------------
// The account owner
// ---------------------------------------------------------------------------

/**
 * The owner hands the account to another admin. The free spot moves: if the
 * new owner holds a seat and the old owner does not, that seat passes to the
 * old owner in the same save (setClinicOwner in lib/db/clinics.ts), so nobody
 * ends up waiting. If the new owner has no seat to pass on, the old owner
 * waits for one like everyone else (given one by the check that follows, if
 * one is free).
 */
export async function handOffOwner(args: { clinicId: string; toUserId: unknown; actor: Actor }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "Your clinic could not be found. Sign in again and try once more." };
  if (clinic.ownerClerkUserId !== args.actor.userId) return { ok: false, message: "Only the account owner can hand the account over." };

  const toUserId = typeof args.toUserId === "string" ? args.toUserId : "";
  if (toUserId === args.actor.userId) return { ok: false, message: "You are already the account owner." };
  const member = await memberOf(clinic.orgId, toUserId);
  if (member === null) return { ok: false, message: NOT_SAVED };
  if (member === "not-a-member") return { ok: false, message: NOT_IN_CLINIC };
  if (member.role !== "admin") return { ok: false, message: `Switch admin on for ${member.name} first. The account owner is always an admin.` };

  try {
    await setClinicOwner(
      args.clinicId,
      member.userId,
      { newOwnerName: member.name, oldOwnerName: args.actor.name, how: `handed over by ${args.actor.name}` },
      byAdmin(args.actor),
      { expectedOwner: args.actor.userId, oldOwnerStays: true },
    );
  } catch (error) {
    if (error instanceof OwnerChangeRefusedError) return { ok: false, message: error.message };
    logFailure("the account owner could not be changed", error);
    return { ok: false, message: NOT_SAVED };
  }

  const board = await checkSeats(args.clinicId).catch((error) => {
    logFailure("the seats could not be checked after a handoff", error);
    return null;
  });
  const me = board?.people.find((person) => person.userId === args.actor.userId);
  const waiting = me?.seat === "waiting" ? " You now need a seat like everyone else, and none is free, so you are waiting for one." : "";
  return { ok: true, message: `${member.name} is now the account owner.${waiting}` };
}

/**
 * Pulse staff make any current member the account owner: the backup for an
 * owner who left without handing over. A member who is not an admin is made
 * one first, because the owner is always an admin.
 */
export async function setOwnerByStaff(args: { clinicId: string; toUserId: unknown; staffName: string }): Promise<Outcome> {
  const clinic = await clinicFor(args.clinicId);
  if (!clinic) return { ok: false, message: "This clinic has no Clerk organization, so it has no people to choose from." };

  const member = await memberOf(clinic.orgId, typeof args.toUserId === "string" ? args.toUserId : "");
  if (member === null) return { ok: false, message: "Could not reach Clerk to check that person. Nothing was changed. Try again in a moment." };
  if (member === "not-a-member") return { ok: false, message: "That person is not a member of this clinic." };

  if (member.role !== "admin") {
    try {
      await setRoleInClerk(clinic.orgId, member.userId, "admin");
    } catch (error) {
      logFailure("Clerk did not make the new owner an admin", error);
      return { ok: false, message: "Could not switch admin on for that person in Clerk. Nothing was changed. Try again in a moment." };
    }
    await addClinicNote(args.clinicId, { kind: "STATUS", authorName: args.staffName, body: `Admin switched on for ${member.name}, to make them the account owner.` }).catch(
      (error) => logFailure("a role change could not be written to the log", error),
    );
  }

  // The old owner, if still in the clinic, gets the new owner's seat the same way as in a handoff.
  let oldOwnerName: string | null = null;
  if (clinic.ownerClerkUserId && clinic.ownerClerkUserId !== member.userId) {
    const old = await memberOf(clinic.orgId, clinic.ownerClerkUserId);
    oldOwnerName = typeof old === "object" && old !== null ? old.name : null;
  }
  const { logged } = await setClinicOwner(
    args.clinicId,
    member.userId,
    { newOwnerName: member.name, oldOwnerName, how: "set by Pulse 3D staff" },
    args.staffName,
    { oldOwnerStays: oldOwnerName !== null },
  );
  await checkSeats(args.clinicId).catch((error) => logFailure("the seats could not be checked after an owner change", error));
  return { ok: true, message: logged ? `${member.name} is now the account owner.` : `${member.name} was already the account owner.` };
}

// ---------------------------------------------------------------------------
// Checking the seats against the clinic's people
// ---------------------------------------------------------------------------

export type SeatedPerson = Person & {
  seat: SeatState;
  isOwner: boolean;
  /** For someone holding a seat: the name patients see on links they send (typed, else "Dr. First Last", else null). Null without a seat. */
  patientName: string | null;
  /** The name an admin typed for them, or null when they use the default. */
  typedPatientName: string | null;
};

/** An open invitation, as the People page shows it. */
export type InvitationView = OpenInvitation & {
  /** False for an invitation made outside our People page: it holds no seat, and its person arrives waiting for one. */
  holdsSeat: boolean;
};

/** Everyone in a clinic with where each stands, after the seats have been brought into line. */
export type SeatBoard = {
  people: SeatedPerson[];
  /** Open invitations, or null when Clerk could not list them this time. */
  invitations: InvitationView[] | null;
  summary: SeatSummary;
  /** People who need a seat and have none. */
  waiting: number;
  /** The account owner's user id, or null when the clinic has none. */
  ownerUserId: string | null;
  /** The owner on record is in the clinic but is not an admin (switched off in Clerk's own panel). */
  ownerNotAdmin: boolean;
  /** Seats and holds this check let go. */
  released: number;
};

/**
 * What Clerk says about the invitations behind our holds. Open ones come from
 * one list call; a held invitation missing from that list is asked about on
 * its own before it is called closed, so a hold is only ever let go on
 * Clerk's positive word. Null when the list itself could not be read.
 */
async function readInvitationFacts(orgId: string, heldInvitationIds: string[]): Promise<{ facts: InvitationFacts; open: OpenInvitation[] } | null> {
  let open: OpenInvitation[];
  try {
    open = await listOpenInvitations(orgId);
  } catch (error) {
    logFailure("the clinic's invitations could not be read from Clerk", error);
    return null;
  }
  const openIds = new Set(open.map((invitation) => invitation.id));
  const closed: string[] = [];
  for (const invitationId of heldInvitationIds) {
    if (openIds.has(invitationId)) continue;
    try {
      if (!(await invitationIsOpen(orgId, invitationId))) closed.push(invitationId);
    } catch (error) {
      logFailure("an invitation could not be looked up in Clerk; its hold is kept for now", error);
    }
  }
  return { facts: { pending: open.map((invitation) => ({ id: invitation.id, seatHoldId: invitation.seatHoldId })), closed }, open };
}

/**
 * Read a clinic's people and invitations from Clerk, bring its seats into
 * line with them (planSeatCheck in lib/seats.ts says how, applySeatCheck in
 * lib/db/seats.ts does it under the lock), and return everyone with where
 * they stand.
 *
 * This is what turns an accepted invitation into a seat, notices a person
 * removed or an invitation revoked in Clerk's own panel, seats people who
 * were waiting when a seat comes free, and notices that the account owner
 * has left. There are no background jobs, so it runs where it matters:
 * whenever the People page or a clinic's /pulse page is opened, and before
 * anyone is told a clinic is full.
 *
 * Safe to run at any time and any number of times: it only ever lets seats
 * go or fills free ones, never removes or relabels anyone, and never goes
 * over the plan. A check that finds nothing to do writes nothing.
 *
 * Throws when Clerk's member list cannot be read; nothing is changed then.
 */
export async function checkSeats(clinicId: string, now: Date = new Date()): Promise<SeatBoard> {
  const clinic = await getSeatClinic(clinicId);
  if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);

  const people = clinic.clerkOrgId ? await listPeople(clinic.clerkOrgId) : [];
  let rows = await listSeatRows(clinicId);
  let holds = await listSeatHolds(clinicId);
  const invitationRead = clinic.clerkOrgId
    ? await readInvitationFacts(
        clinic.clerkOrgId,
        holds.flatMap((hold) => (hold.clerkInvitationId ? [hold.clerkInvitationId] : [])),
      )
    : null;

  let released = 0;
  let owner = clinic.ownerClerkUserId;
  const plan = planSeatCheck({
    seats: clinic.surgeonSeats,
    ownerUserId: owner,
    members: people,
    rows,
    holds,
    invitations: invitationRead?.facts ?? null,
    now,
  });
  if (!seatCheckIsEmpty(plan)) {
    try {
      const result = await applySeatCheck(clinicId, plan, owner, now);
      released = result.released;
      if (result.ownerCleared) owner = null;
      rows = await listSeatRows(clinicId);
      holds = await listSeatHolds(clinicId);
    } catch (error) {
      // The page still shows where everyone stands; the check runs again next time.
      logFailure("the seat check could not be applied", error);
    }
  }

  const heldHoldIds = new Set(holds.map((hold) => hold.id));
  const typed = new Map((await listSeatNames(clinicId)).map((seat) => [seat.clerkUserId, seat.displayName]));
  const seated = people.map((person) => {
    const seat = seatStateOf(person.userId, rows, owner);
    const typedPatientName = typed.get(person.userId) ?? null;
    return {
      ...person,
      seat,
      isOwner: person.userId === owner,
      patientName: seat === "held" ? effectiveSenderName(typedPatientName, person.defaultPatientName) : null,
      typedPatientName,
    };
  });
  return {
    people: seated,
    invitations: invitationRead
      ? invitationRead.open.map((invitation) => ({ ...invitation, holdsSeat: invitation.seatHoldId !== null && heldHoldIds.has(invitation.seatHoldId) }))
      : null,
    summary: (await getSeatSummary(clinicId)) ?? seatSummary(clinic.surgeonSeats, rows.length, holds.length),
    waiting: seated.filter((person) => person.seat === "waiting").length,
    ownerUserId: owner,
    ownerNotAdmin: seated.some((person) => person.isOwner && person.role !== "admin"),
    released,
  };
}
