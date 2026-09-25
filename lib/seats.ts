/**
 * The seat rules. Pure: no database, no Clerk, safe for the browser.
 * lib/db/seats.ts does the writes and lib/seat-changes.ts talks to Clerk;
 * both ask this file what is allowed.
 *
 * THE MODEL (decided by Evan and Van on 2026-09-21):
 *
 *   The ACCOUNT OWNER   One person per clinic: whoever created it, until they
 *                       hand it to someone else. Always an admin. The only
 *                       person who does not need a seat, and who may still
 *                       take one (a solo surgeon buys one seat and takes it).
 *   Everyone else       Holds one of the seats the clinic pays for
 *                       (Clinic.surgeonSeats). There is no free "staff" kind
 *                       any more. Whether someone is an admin is a separate
 *                       switch and never changes the seat count.
 *
 * WHO HOLDS A SEAT is kept in our own tables, and they are the authority:
 *
 *   SeatAllocation   one row per person holding a seat.
 *   SeatInvitation   one row per invitation that has not been accepted yet.
 *                    An open invitation holds a seat, so an admin can only
 *                    have as many open invitations as there are free seats.
 *
 * The two counted together are what is compared with the seats on the plan,
 * and a row in either is only ever added while the clinic's row is locked,
 * so two requests reaching for the last seat cannot both get it.
 *
 * Membership (who is in the clinic, who is an admin, what invitations are
 * open) lives in Clerk. The two can disagree, and every way they can is one
 * of these, which planSeatCheck() below puts right:
 *
 *   someone with no seat          WAITING for one. They joined through an
 *                                 invitation made outside our People page
 *                                 (Clerk's own panel or dashboard), or the
 *                                 clinic was full, or they were in the clinic
 *                                 before this model (people once marked
 *                                 "staff"). They are given a seat when one is
 *                                 free, oldest member first. Nobody is removed
 *                                 to make the numbers fit.
 *   a seat, person has left       The seat is let go.
 *   an invitation was accepted    The person's membership carries the hold's
 *                                 id (Clerk copies it from the invitation), so
 *                                 the hold becomes their seat.
 *   an invitation was revoked     The hold is let go.
 *   or expired
 *   a hold Clerk never made an    The server stopped between the two steps.
 *   invitation for                Let go after a few minutes.
 *   the owner has left            The clinic has no account owner. Pulse
 *                                 staff set a new one on /pulse.
 *
 * Letting a seat go is always safe: it can never put a clinic over its
 * limit and never changes a bill. No seat is ever a permission: what a
 * person may DO is their Clerk role (org:admin or org:member).
 */

/** How long a held seat may wait for Clerk to make its invitation before it is let go. Far longer than any request lasts. */
export const PENDING_WINDOW_MS = 2 * 60 * 1000;

/** What a Clerk user id looks like. Checked before one is stored or sent to Clerk. */
export function isClerkUserId(value: unknown): value is string {
  return typeof value === "string" && /^user_[A-Za-z0-9]{1,64}$/.test(value);
}

/** What one of our hold ids looks like (a cuid). Checked before one read from Clerk's metadata is used. */
export function isHoldId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{10,40}$/.test(value);
}

/** The key the hold's id is kept under on a Clerk invitation, and so on the membership it turns into. */
export const SEAT_HOLD_KEY = "seatHold";

/** Read a hold id out of an invitation's or a membership's public metadata. Anything else is null. */
export function holdIdFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.[SEAT_HOLD_KEY];
  return isHoldId(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** One clinic's seats, in numbers. */
export type SeatSummary = {
  /** Seats on the plan. */
  seats: number;
  /** People holding one. */
  seated: number;
  /** Open invitations holding one. */
  invited: number;
  /** Seats taken, by people and invitations together. What is compared with the plan. */
  inUse: number;
  /** Seats nobody holds. Never below zero. */
  free: number;
  /** How many more seats are taken than the plan pays for. Zero unless a plan was set below what was in use. */
  overBy: number;
};

/** A stored seat count that is not a whole number of zero or more counts as zero: when in doubt, no seats. */
function wholeSeats(seats: unknown): number {
  return typeof seats === "number" && Number.isInteger(seats) && seats > 0 ? seats : 0;
}

export function seatSummary(seats: unknown, seated: number, invited = 0): SeatSummary {
  const paid = wholeSeats(seats);
  const inUse = seated + invited;
  return { seats: paid, seated, invited, inUse, free: Math.max(0, paid - inUse), overBy: Math.max(0, inUse - paid) };
}

/** May one more seat be taken (by a person or an invitation)? The one question every route asks, always under the clinic's lock. */
export function hasFreeSeat(summary: SeatSummary): boolean {
  return summary.inUse < summary.seats;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 of 3 seats in use (1 by an invitation)", for the log and the pages. */
export function seatCountWords(summary: SeatSummary): string {
  const invites = summary.invited > 0 ? ` (${plural(summary.invited, "by an invitation", "by invitations")})` : "";
  return `${summary.inUse} of ${plural(summary.seats, "seat", "seats")} in use${invites}`;
}

/** What an admin is told when no seat is free for one more person or invitation. */
export function seatsFullMessage(summary: SeatSummary): string {
  if (summary.seats === 0) {
    return "Your clinic has no seats yet. Choose a plan on the Billing page first.";
  }
  if (summary.overBy > 0) {
    return `${summary.inUse} seats are taken and your plan pays for ${summary.seats}. Nobody else can be given one until someone is removed, an invitation is revoked, or a seat is added.`;
  }
  return `All ${plural(summary.seats, "seat is", "seats are")} taken. Revoke an invitation or remove someone first, or add seats on the Billing page.`;
}

// ---------------------------------------------------------------------------
// Lowering the seats on a plan
// ---------------------------------------------------------------------------

export type SeatReductionCheck = { ok: true } | { ok: false; short: number; message: string };

/**
 * May a plan be set to `newSeats` while `inUse` seats are taken (by people
 * and open invitations together)?
 *
 * Asked wherever seats can go down: at checkout, when Pulse staff edit a plan,
 * and (when plan changes are built) both when a reduction is SCHEDULED and
 * again when it TAKES EFFECT, because seats can be taken in between.
 * Always asked under the clinic's row lock, with a count read under that lock.
 */
export function checkSeatReduction(inUse: number, newSeats: number): SeatReductionCheck {
  if (newSeats >= inUse) return { ok: true };
  const short = inUse - newSeats;
  return {
    ok: false,
    short,
    message: `${plural(inUse, "seat is", "seats are")} taken, so the plan needs at least ${plural(inUse, "seat", "seats")}. Remove ${short === 1 ? "someone" : `${short} people`} or revoke ${short === 1 ? "an invitation" : "invitations"} on the People page first, or choose ${inUse} or more.`,
  };
}

/** The sentence that goes in the log when a plan takes effect, or is set by hand, with fewer seats than are taken. */
export function overAllocatedWords(summary: SeatSummary): string | null {
  if (summary.overBy === 0) return null;
  return `${plural(summary.inUse, "seat is", "seats are")} taken, ${summary.overBy} more than the ${summary.seats} the plan now pays for. Nobody was removed and no charge was changed; nobody else can be given a seat until that is settled.`;
}

// ---------------------------------------------------------------------------
// Bringing the seats and Clerk back into line
// ---------------------------------------------------------------------------

/** One person in the clinic, as Clerk reports them. Only what the rules need. */
export type SeatMember = {
  userId: string;
  /** When they joined the clinic (Clerk's membership createdAt, in milliseconds). Decides who is given a free seat first. */
  joinedAt: number;
  /** The hold id their membership carries, copied by Clerk from the invitation they accepted. Null when they did not come through our invite form. */
  seatHoldId: string | null;
};

/** One row of SeatAllocation. Only what the rules need. */
export type SeatRow = {
  clerkUserId: string;
  syncState: "PENDING" | "SYNCED";
  reservedAt: Date;
};

/** One row of SeatInvitation. Only what the rules need. */
export type HoldRow = {
  id: string;
  clerkInvitationId: string | null;
  reservedAt: Date;
};

/**
 * What Clerk says about the clinic's invitations, or null when it could not
 * be read (then no hold is let go on account of its invitation).
 */
export type InvitationFacts = {
  /** Invitations still open, with the hold id each carries (null for one made outside our form). */
  pending: { id: string; seatHoldId: string | null }[];
  /** Invitation ids Clerk has confirmed are no longer open (accepted, revoked or expired). */
  closed: string[];
};

/** Why a held seat is being let go. */
export type HoldReleaseReason = "closed" | "never-made" | "already-seated";

export type SeatCheckPlan = {
  /** Seats written by the earlier model and never confirmed, whose person is still here: mark them confirmed. Housekeeping only. */
  confirm: string[];
  /** Seats whose person has left the clinic: let them go. */
  release: string[];
  /** Accepted invitations: the hold becomes this person's seat. */
  convert: { holdId: string; userId: string }[];
  /** Holds whose Clerk invitation is now known: record its id. */
  link: { holdId: string; invitationId: string }[];
  /** Holds to let go, and why. */
  dropHolds: { holdId: string; reason: HoldReleaseReason }[];
  /** People waiting who get a free seat now, in the order to give them (oldest member first). */
  adopt: string[];
  /** The account owner is no longer in the clinic: clear the owner. */
  ownerLeft: boolean;
};

/**
 * Compare a clinic's people and invitations (from Clerk) with its seats and
 * holds (from our tables) and say what to change. It never suggests removing
 * anyone, never suggests more seats than the plan has, and never gives the
 * account owner a seat (the owner takes one only by choice).
 *
 * `members` must be the clinic's COMPLETE list of people. An empty list is
 * treated as "Clerk could not say" rather than "everyone left", and nothing
 * is changed: a clinic always has at least the person looking at it, and
 * letting every seat go on a bad answer would be the expensive mistake.
 *
 * The numbers here come from a snapshot. lib/db/seats.ts applies the plan
 * under the clinic's lock and counts again before each seat it gives, so a
 * plan worked out a moment ago can never put a clinic over its limit.
 */
export function planSeatCheck(input: {
  seats: unknown;
  ownerUserId: string | null;
  members: SeatMember[];
  rows: SeatRow[];
  holds: HoldRow[];
  invitations: InvitationFacts | null;
  now: Date;
}): SeatCheckPlan {
  const { members, rows, holds, invitations, now, ownerUserId } = input;
  const plan: SeatCheckPlan = { confirm: [], release: [], convert: [], link: [], dropHolds: [], adopt: [], ownerLeft: false };
  if (members.length === 0) return plan;

  const memberIds = new Set(members.map((member) => member.userId));
  const seated = new Set<string>();

  for (const row of rows) {
    if (!memberIds.has(row.clerkUserId)) {
      plan.release.push(row.clerkUserId);
      continue;
    }
    seated.add(row.clerkUserId);
    if (row.syncState === "PENDING") plan.confirm.push(row.clerkUserId);
  }

  // Invitations that were accepted: the person arrived carrying the hold's id.
  const holdsById = new Map(holds.map((hold) => [hold.id, hold]));
  const settled = new Set<string>();
  for (const member of members) {
    const hold = member.seatHoldId ? holdsById.get(member.seatHoldId) : undefined;
    if (!hold || settled.has(hold.id)) continue;
    settled.add(hold.id);
    if (seated.has(member.userId)) {
      plan.dropHolds.push({ holdId: hold.id, reason: "already-seated" });
    } else {
      plan.convert.push({ holdId: hold.id, userId: member.userId });
      seated.add(member.userId);
    }
  }

  // The holds still open.
  let openHolds = 0;
  const pendingByHold = new Map((invitations?.pending ?? []).filter((inv) => inv.seatHoldId).map((inv) => [inv.seatHoldId as string, inv.id]));
  const closed = new Set(invitations?.closed ?? []);
  for (const hold of holds) {
    if (settled.has(hold.id)) continue;
    if (hold.clerkInvitationId) {
      if (closed.has(hold.clerkInvitationId)) plan.dropHolds.push({ holdId: hold.id, reason: "closed" });
      else openHolds += 1;
      continue;
    }
    // Held, and Clerk's invitation id not recorded yet.
    const invitationId = pendingByHold.get(hold.id);
    if (invitationId) {
      plan.link.push({ holdId: hold.id, invitationId });
      openHolds += 1;
    } else if (invitations && now.getTime() - hold.reservedAt.getTime() > PENDING_WINDOW_MS) {
      plan.dropHolds.push({ holdId: hold.id, reason: "never-made" });
    } else {
      openHolds += 1; // still being made, or Clerk could not be asked: it keeps its seat for now
    }
  }

  const free = Math.max(0, wholeSeats(input.seats) - seated.size - openHolds);
  plan.adopt = members
    .filter((member) => member.userId !== ownerUserId && !seated.has(member.userId))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId))
    .slice(0, free)
    .map((member) => member.userId);

  plan.ownerLeft = ownerUserId !== null && !memberIds.has(ownerUserId);
  return plan;
}

/** True when a plan would change nothing, so no transaction is opened for it. */
export function seatCheckIsEmpty(plan: SeatCheckPlan): boolean {
  return (
    plan.confirm.length === 0 &&
    plan.release.length === 0 &&
    plan.convert.length === 0 &&
    plan.link.length === 0 &&
    plan.dropHolds.length === 0 &&
    plan.adopt.length === 0 &&
    !plan.ownerLeft
  );
}

// ---------------------------------------------------------------------------
// What the pages show about one person
// ---------------------------------------------------------------------------

/**
 * Where one person stands:
 *
 *   held      holds a seat.
 *   waiting   needs a seat and has none: none was free.
 *   none      the account owner without a seat. They do not need one.
 */
export type SeatState = "held" | "waiting" | "none";

/** Each state in a few words, for a table. */
export const SEAT_STATE_WORDS: Record<SeatState, string> = {
  held: "Holds a seat",
  waiting: "Waiting for a seat",
  none: "No seat (account owner)",
};

export function seatStateOf(userId: string, rows: Pick<SeatRow, "clerkUserId">[], ownerUserId: string | null): SeatState {
  if (rows.some((row) => row.clerkUserId === userId)) return "held";
  return userId === ownerUserId ? "none" : "waiting";
}
