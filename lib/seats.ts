import type { Kind } from "./roles";

/**
 * The surgeon seat rules. Pure: no database, no Clerk, safe for the browser.
 * lib/db/seats.ts does the writes and lib/seat-changes.ts talks to Clerk;
 * both ask this file what is allowed.
 *
 * TWO FACTS, TWO HOMES. Keep them apart:
 *
 *   The LABEL    "surgeon" or "staff". What a person said they are, or what
 *                their admin marked them as. It lives on the person's Clerk
 *                membership (lib/roles.ts) and Clerk is the authority on it.
 *
 *   The SEAT     whether that person holds one of the surgeon seats the
 *                clinic pays for. It lives in our SeatAllocation table, and
 *                THAT TABLE IS THE AUTHORITY on it. The number of rows a
 *                clinic has there is what is compared with the seats on its
 *                plan (Clinic.surgeonSeats), and a row is only ever added
 *                while the clinic's row is locked, so two people reaching for
 *                the last seat cannot both get it.
 *
 * Neither grants a permission. What a person may DO is their Clerk role
 * (org:admin or org:member), and nothing here changes that: a surgeon who is
 * waiting for a seat uses the library exactly as before. Staff never take a
 * seat and are never charged for.
 *
 * Because there are two homes, they can disagree. Every way they can is one
 * of these, and planSeatCheck() below says what to do about each:
 *
 *   label surgeon, no seat     A surgeon WAITING for a seat. This is how a
 *                              "Yes, I am a surgeon" is kept when the clinic
 *                              has not paid yet, or is full: the answer is
 *                              recorded, no seat is taken, nobody is billed.
 *                              Also every surgeon marked before seats existed,
 *                              and a label set by hand in Clerk's dashboard.
 *                              Given a seat when one is free, oldest member
 *                              first. Never relabelled.
 *   seat, person has left      The seat is let go.
 *   seat, label is not surgeon Marked staff (here or in Clerk's dashboard)
 *                              and the second half of the change did not
 *                              land. The seat is let go.
 *   seat reserved, not yet     A change that is on its way, or whose Clerk
 *   confirmed (PENDING)        write failed. Left alone for a few minutes,
 *                              then let go, so a failure can never hold a
 *                              seat for ever.
 *
 * Letting a seat go is always safe: it can never put a clinic over its
 * limit and never changes a bill.
 */

/** How long a reserved seat may wait for Clerk's confirmation before it is let go. Far longer than any request lasts. */
export const PENDING_WINDOW_MS = 2 * 60 * 1000;

/** What a Clerk user id looks like. Checked before one is stored or sent to Clerk. */
export function isClerkUserId(value: unknown): value is string {
  return typeof value === "string" && /^user_[A-Za-z0-9]{1,64}$/.test(value);
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** One clinic's seats, in numbers. */
export type SeatSummary = {
  /** Seats on the plan. */
  seats: number;
  /** People holding one (rows in SeatAllocation, confirmed or not). */
  inUse: number;
  /** Seats nobody holds. Never below zero. */
  free: number;
  /** How many more people hold a seat than the plan pays for. Zero unless Pulse staff set the plan below what was in use. */
  overBy: number;
};

/** A stored seat count that is not a whole number of zero or more counts as zero: when in doubt, no seats. */
function wholeSeats(seats: unknown): number {
  return typeof seats === "number" && Number.isInteger(seats) && seats > 0 ? seats : 0;
}

export function seatSummary(seats: unknown, inUse: number): SeatSummary {
  const paid = wholeSeats(seats);
  return { seats: paid, inUse, free: Math.max(0, paid - inUse), overBy: Math.max(0, inUse - paid) };
}

/** May one more person be given a seat? The one question every route asks, always under the clinic's lock. */
export function hasFreeSeat(summary: SeatSummary): boolean {
  return summary.inUse < summary.seats;
}

/** "2 of 3 surgeon seats in use", for the log and the pages. */
export function seatCountWords(summary: SeatSummary): string {
  return `${summary.inUse} of ${summary.seats} surgeon ${summary.seats === 1 ? "seat" : "seats"} in use`;
}

/** What an admin is told when nobody else can be given a seat. */
export function seatsFullMessage(summary: SeatSummary): string {
  if (summary.seats === 0) {
    return "Your clinic has no surgeon seats yet, so nobody can be given one. Choose a plan on the Billing page first.";
  }
  if (summary.overBy > 0) {
    return `${summary.inUse} people hold a surgeon seat and your plan pays for ${summary.seats}. Nobody else can be given one until a surgeon is marked as Staff or a seat is added.`;
  }
  return `All ${summary.seats} surgeon ${summary.seats === 1 ? "seat is" : "seats are"} in use. Mark another surgeon as Staff first, or get in touch with Pulse 3D to add a seat.`;
}

// ---------------------------------------------------------------------------
// Lowering the seats on a plan
// ---------------------------------------------------------------------------

export type SeatReductionCheck = { ok: true } | { ok: false; short: number; message: string };

/**
 * May a plan be set to `newSeats` while `inUse` people hold a seat?
 *
 * Asked wherever seats can go down: at checkout, when Pulse staff edit a plan,
 * and (when plan changes are built) both when a reduction is SCHEDULED and
 * again when it TAKES EFFECT, because people can be given seats in between.
 * Always asked under the clinic's row lock, with a count read under that lock.
 */
export function checkSeatReduction(inUse: number, newSeats: number): SeatReductionCheck {
  if (newSeats >= inUse) return { ok: true };
  const short = inUse - newSeats;
  return {
    ok: false,
    short,
    message: `${inUse} ${inUse === 1 ? "person holds" : "people hold"} a surgeon seat, so the plan needs at least ${inUse} ${inUse === 1 ? "seat" : "seats"}. Mark ${short === 1 ? "a surgeon" : `${short} surgeons`} as Staff on the People page first, or choose ${inUse} or more.`,
  };
}

/** The sentence that goes in the log when a plan takes effect, or is set by hand, with fewer seats than are in use. */
export function overAllocatedWords(summary: SeatSummary): string | null {
  if (summary.overBy === 0) return null;
  return `${summary.inUse} ${summary.inUse === 1 ? "person holds" : "people hold"} a surgeon seat, ${summary.overBy} more than the ${summary.seats} the plan now pays for. Nobody was relabelled and no charge was changed; nobody else can be given a seat until that is settled.`;
}

// ---------------------------------------------------------------------------
// Bringing the seats and Clerk back into line
// ---------------------------------------------------------------------------

/** One person in the clinic, as Clerk reports them. Only what the rules need. */
export type SeatMember = {
  userId: string;
  kind: Kind | null;
  /** When they joined the clinic (Clerk's membership createdAt, in milliseconds). Decides who is given a free seat first. */
  joinedAt: number;
};

/** One row of SeatAllocation. Only what the rules need. */
export type SeatRow = {
  clerkUserId: string;
  syncState: "PENDING" | "SYNCED";
  reservedAt: Date;
};

/** Why a seat is being let go. */
export type ReleaseReason = "left" | "not-surgeon" | "stale";

export type SeatCheckPlan = {
  /** Reserved seats that Clerk has since confirmed: mark them confirmed. */
  confirm: string[];
  /** Seats to let go, and why. */
  release: { userId: string; reason: ReleaseReason }[];
  /** Surgeons with no seat who get one now, in the order to give them (oldest member first). */
  adopt: string[];
};

/**
 * Compare a clinic's people (from Clerk) with its seats (from our table) and
 * say what to change. Decides nothing about labels: it never suggests
 * relabelling anyone, and it never suggests more seats than the plan has.
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
export function planSeatCheck(input: { seats: unknown; members: SeatMember[]; rows: SeatRow[]; now: Date }): SeatCheckPlan {
  const { members, rows, now } = input;
  const plan: SeatCheckPlan = { confirm: [], release: [], adopt: [] };
  if (members.length === 0) return plan;

  const byUser = new Map(members.map((member) => [member.userId, member]));
  const seated = new Set<string>();

  for (const row of rows) {
    const member = byUser.get(row.clerkUserId);
    if (!member) {
      plan.release.push({ userId: row.clerkUserId, reason: "left" });
      continue;
    }
    if (member.kind === "surgeon") {
      if (row.syncState === "PENDING") plan.confirm.push(row.clerkUserId);
      seated.add(row.clerkUserId);
      continue;
    }
    // The label is not surgeon. A confirmed seat means the person was marked
    // staff since; a reserved one may simply be on its way to Clerk.
    if (row.syncState === "SYNCED") {
      plan.release.push({ userId: row.clerkUserId, reason: "not-surgeon" });
    } else if (now.getTime() - row.reservedAt.getTime() > PENDING_WINDOW_MS) {
      plan.release.push({ userId: row.clerkUserId, reason: "stale" });
    } else {
      seated.add(row.clerkUserId); // still in flight: it keeps its seat for now
    }
  }

  const free = Math.max(0, wholeSeats(input.seats) - seated.size);
  plan.adopt = members
    .filter((member) => member.kind === "surgeon" && !seated.has(member.userId))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId))
    .slice(0, free)
    .map((member) => member.userId);

  return plan;
}

/** True when a plan would change nothing, so no transaction is opened for it. */
export function seatCheckIsEmpty(plan: SeatCheckPlan): boolean {
  return plan.confirm.length === 0 && plan.release.length === 0 && plan.adopt.length === 0;
}

// ---------------------------------------------------------------------------
// What the pages show about one person
// ---------------------------------------------------------------------------

/**
 * Where one person stands:
 *
 *   held      labelled surgeon, holds a seat.
 *   waiting   labelled surgeon, no seat: none was free when they said so.
 *   pending   a seat is reserved for them and Clerk has not confirmed the
 *             label. The People page offers "Try again".
 *   none      staff, or not answered yet. No seat, none wanted.
 */
export type SeatState = "held" | "waiting" | "pending" | "none";

/** Each state in a few words, for a table. */
export const SEAT_STATE_WORDS: Record<SeatState, string> = {
  held: "Holds a seat",
  waiting: "Waiting for a seat",
  pending: "Reserved, not confirmed yet",
  none: "None",
};

export function seatStateOf(member: Pick<SeatMember, "userId" | "kind">, rows: SeatRow[]): SeatState {
  const row = rows.find((candidate) => candidate.clerkUserId === member.userId);
  if (member.kind === "surgeon") return row ? "held" : "waiting";
  return row ? "pending" : "none";
}
