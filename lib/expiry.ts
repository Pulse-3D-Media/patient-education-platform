import type { ExpiryPolicy } from "@prisma/client";

/**
 * The expiry rule for share links, with no database in it.
 *
 * lib/db/shares.ts reads a share and hands it here; the admin pages do the
 * same for what they list. Every one of them asks this file, so the rule
 * cannot drift between the page that says "6 days left" and the write that
 * decides whether a play may move the deadline.
 *
 * Two rules exist side by side, and a link carries the one it was made
 * under (Share.expiryPolicy):
 *
 *   FIXED       Phase 1. expiresAt was set when the link was made and never
 *               moves, played or not. Every link made before this rule
 *               shipped is FIXED, and it stays exactly as it was issued.
 *
 *   FIRST_PLAY  From this rule on. When the link is made, expiresAt is set
 *               to "made + unclaimedDays" (90 by default) so a link nobody
 *               ever plays stops on its own. The first time the video really
 *               plays, expiresAt moves to "that moment + daysAfterFirstPlay"
 *               (7 by default), and it never moves again: later plays are
 *               counted, but they do not extend anything. The number of
 *               days is copied onto the link when it is made
 *               (Share.daysAfterFirstPlay), so a settings edit afterwards
 *               changes links made from then on, not a link already given
 *               to a patient.
 *
 * PAUSING AND REACTIVATION (from September 2026; the build plan calls a
 * paused link "dormant"). When a FIRST_PLAY link that has been played runs
 * out, it is not over: it PAUSES. The patient page offers one button, "ask
 * my clinic", and an office admin can turn the link back on for the same
 * number of days it was issued with (Share.daysAfterFirstPlay), up to the
 * platform's maximum number of renewals (AppSettings.maxRenewals, read at
 * the moment it is needed, so a change applies to every link at once). A
 * link that has used them all is FINISHED: the calm page with no button. A
 * link nobody ever played that ran out is finished too (decided by Evan on
 * 2026-09-25): it was never opened, so there is nothing to give back. And a
 * FIXED (legacy) link is never paused: expired means expired, exactly as
 * before. The rule is renewalState() below; lib/db/shares.ts asks it before
 * every request and every reactivation.
 *
 * Time here is the server's UTC clock, and a "day" is 24 elapsed hours, not
 * a calendar day. Every function takes `now` so the tests can hand in a
 * clock of their own.
 */

/** Milliseconds in one 24-hour day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` elapsed 24-hour days after `from`. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * The smallest and largest number of days any link setting may hold: one
 * day to one year. The same limit the clinic's own number already had on
 * /pulse; the platform settings form and the override form both refuse
 * anything outside it, and resolveShareTerms() below refuses it again
 * before any date arithmetic, so a number that slipped past the forms (a
 * hand edit in Neon) can never become a deadline.
 */
export const MIN_LINK_DAYS = 1;
export const MAX_LINK_DAYS = 365;

/** True for a whole number of days from MIN_LINK_DAYS to MAX_LINK_DAYS. Anything else never reaches the date arithmetic. */
export function isValidLinkDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= MIN_LINK_DAYS && days <= MAX_LINK_DAYS;
}

/**
 * A settings value that is not a usable number of days, found when a link
 * was about to be made. Nothing is written when this is thrown; the message
 * is the plain sentence for the person who tried.
 */
export class ShareTermsError extends Error {
  constructor(setting: string) {
    super(
      `Links cannot be made right now: the "${setting}" setting is not a whole number of days from ${MIN_LINK_DAYS} to ${MAX_LINK_DAYS}. Ask Pulse 3D to check the platform settings.`,
    );
    this.name = "ShareTermsError";
  }
}

/**
 * The two numbers a new link is made with: how long it lasts if nobody
 * plays it, and how long it lasts after the first play. Resolved from the
 * settings at the moment the link is made and copied onto it.
 */
export type ShareTerms = {
  /** Days a link works if nobody ever plays it. The platform's unclaimedDays. */
  unclaimedDays: number;
  /** Days a link keeps working after the first play. The clinic's override when it has one, else the platform's viewDays. */
  daysAfterFirstPlay: number;
};

/**
 * Work out a clinic's share terms from the platform settings and the
 * clinic's own override. The clinic's number wins when it has one; there is
 * no clinic override for the unclaimed days. getShareTerms() and
 * createShare() in lib/db/shares.ts both call this.
 *
 * Both numbers are checked here, right before they are used to set a date:
 * a value that is not a whole number of days from MIN_LINK_DAYS to
 * MAX_LINK_DAYS throws a ShareTermsError and no link is made. The forms
 * refuse such values too; this is the check that holds even if they did not.
 */
export function resolveShareTerms(
  settings: { unclaimedDays: number; viewDays: number },
  clinic: { viewDaysOverride: number | null },
): ShareTerms {
  const unclaimedDays = settings.unclaimedDays;
  const daysAfterFirstPlay = clinic.viewDaysOverride ?? settings.viewDays;
  if (!isValidLinkDays(unclaimedDays)) throw new ShareTermsError("Unclaimed link days");
  if (!isValidLinkDays(daysAfterFirstPlay)) {
    throw new ShareTermsError(clinic.viewDaysOverride === null ? "Days after first play" : "Days a link works after the first play (this clinic)");
  }
  return { unclaimedDays, daysAfterFirstPlay };
}

/** The fields of a share the rule reads. A Share row from Prisma satisfies this as it is. */
export type ShareExpiryFacts = {
  expiryPolicy: ExpiryPolicy;
  expiresAt: Date;
  firstPlayedAt: Date | null;
  daysAfterFirstPlay: number | null;
};

/**
 * Has the link stopped working? True from the deadline itself onward: a
 * link whose expiresAt is exactly `now` is expired, so a claim at the exact
 * deadline fails. lib/db/shares.ts asks the database the same question with
 * `expiresAt > now`, which is the same line drawn from the other side.
 */
export function isExpired(share: { expiresAt: Date }, now: Date): boolean {
  return share.expiresAt.getTime() <= now.getTime();
}

/** A share the next real play may claim: FIRST_PLAY, never played, and carrying its number of days. */
export type ClaimableShare = ShareExpiryFacts & { expiryPolicy: "FIRST_PLAY"; firstPlayedAt: null; daysAfterFirstPlay: number };

/**
 * May the next real play move this link's deadline? Only a FIRST_PLAY link
 * that has never been played and carries a usable days-after-first-play
 * number (a whole number from MIN_LINK_DAYS to MAX_LINK_DAYS, which is all
 * createShare ever writes). The policy and firstPlayedAt decide this, never
 * the view count: a FIXED link with no plays is still a FIXED link. A
 * FIRST_PLAY link with no number copied onto it, or a number outside the
 * limits (nothing in the app makes either), behaves as FIXED, which keeps
 * whatever date it has rather than turning a bad number into a deadline.
 */
export function canClaimFirstPlay(share: ShareExpiryFacts): share is ClaimableShare {
  return share.expiryPolicy === "FIRST_PLAY" && share.firstPlayedAt === null && isValidLinkDays(share.daysAfterFirstPlay);
}

/**
 * Where the deadline moves to when a link is first played at `now`: that
 * moment plus the days copied onto the link. May be later than the
 * unclaimed deadline it replaces; that is the point of the rule.
 */
export function expiryAfterFirstPlay(share: { daysAfterFirstPlay: number }, now: Date): Date {
  return addDays(now, share.daysAfterFirstPlay);
}

/**
 * What a link is doing right now, for the pages that describe it in words:
 *
 *   expired    it has stopped working (at or past its deadline).
 *   awaiting   a FIRST_PLAY link nobody has played yet: it stops at
 *              `unclaimedUntil` unless it is played first, and a first play
 *              gives it `daysAfterFirstPlay` more days from that moment.
 *   played     a FIRST_PLAY link that has been played: the deadline moved
 *              once and is now fixed.
 *   fixed      a FIXED (legacy) link: its date was set when it was made and
 *              playing it changes nothing.
 */
export type ShareExpiryState =
  | { kind: "expired"; expiresAt: Date }
  | { kind: "awaiting"; unclaimedUntil: Date; daysAfterFirstPlay: number }
  | { kind: "played"; firstPlayedAt: Date; expiresAt: Date }
  | { kind: "fixed"; expiresAt: Date };

export function shareExpiryState(share: ShareExpiryFacts, now: Date): ShareExpiryState {
  if (isExpired(share, now)) return { kind: "expired", expiresAt: share.expiresAt };
  if (canClaimFirstPlay(share)) {
    return { kind: "awaiting", unclaimedUntil: share.expiresAt, daysAfterFirstPlay: share.daysAfterFirstPlay };
  }
  if (share.expiryPolicy === "FIRST_PLAY" && share.firstPlayedAt !== null) {
    return { kind: "played", firstPlayedAt: share.firstPlayedAt, expiresAt: share.expiresAt };
  }
  return { kind: "fixed", expiresAt: share.expiresAt };
}

/** "6 days left", "1 day left", or "Less than a day left". Rounded to the nearest day, for reading, not for deciding. */
export function daysLeftText(expiresAt: Date, now: Date): string {
  const days = Math.round((expiresAt.getTime() - now.getTime()) / DAY_MS);
  if (days < 1) return "Less than a day left";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

// ---------------------------------------------------------------------------
// Pausing and reactivation.
// ---------------------------------------------------------------------------

/**
 * The smallest and largest number the "maximum renewals" setting may hold.
 * Zero is allowed and means no link can ever be turned back on. The
 * settings form refuses anything outside this, and renewalState() below
 * treats a stored number outside it as zero: a setting that cannot be read
 * means no renewals, never unlimited ones.
 */
export const MIN_RENEWALS = 0;
export const MAX_RENEWALS = 10;

/** True for a whole number from MIN_RENEWALS to MAX_RENEWALS. */
export function isValidRenewalCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_RENEWALS && value <= MAX_RENEWALS;
}

/**
 * How long after one "ask my clinic" tap the next one counts: one day. A
 * second tap inside that time shows the same confirmation and sends nothing.
 */
export const RENEWAL_REQUEST_GAP_MS = DAY_MS;

/** The fields the reactivation rule reads. A Share row from Prisma satisfies this as it is. */
export type RenewalFacts = ShareExpiryFacts & {
  /** How many times the clinic has turned this link back on. */
  renewalsUsed: number;
};

/**
 * What can happen to a link that has run out:
 *
 *   working    it has not run out; nothing to reactivate.
 *   paused     it ran out after being played, and the clinic may turn it
 *              back on `renewalsLeft` more times, `daysPerRenewal` days
 *              each time (the days the link was issued with).
 *   finished   it ran out and cannot be turned back on. `reason` says why,
 *              for the admin page and the tests; the patient is only told
 *              to ask the practice for a new link:
 *                legacy            a FIXED link, made before the first-play
 *                                  rule: its date was always final.
 *                never-played      nobody ever played it, so there is
 *                                  nothing to give back (decided 2026-09-25).
 *                no-renewals-left  it has been turned back on the maximum
 *                                  number of times already (or the maximum
 *                                  is zero, or could not be read).
 *                no-days           it carries no usable number of days to
 *                                  give (nothing in the app writes such a
 *                                  link; the case exists so a bad number
 *                                  can never become a deadline).
 */
export type RenewalState =
  | { kind: "working" }
  | { kind: "paused"; renewalsLeft: number; daysPerRenewal: number }
  | { kind: "finished"; reason: "legacy" | "never-played" | "no-renewals-left" | "no-days" };

/**
 * The reactivation rule. `maxRenewals` is the platform setting as it is
 * right now, not a number copied onto the link: raising or lowering it
 * changes what every paused link may do, at once.
 */
export function renewalState(share: RenewalFacts, maxRenewals: number, now: Date): RenewalState {
  if (!isExpired(share, now)) return { kind: "working" };
  if (share.expiryPolicy !== "FIRST_PLAY") return { kind: "finished", reason: "legacy" };
  if (share.firstPlayedAt === null) return { kind: "finished", reason: "never-played" };
  if (!isValidLinkDays(share.daysAfterFirstPlay)) return { kind: "finished", reason: "no-days" };
  const allowed = isValidRenewalCount(maxRenewals) ? maxRenewals : 0;
  if (share.renewalsUsed >= allowed) return { kind: "finished", reason: "no-renewals-left" };
  return { kind: "paused", renewalsLeft: allowed - share.renewalsUsed, daysPerRenewal: share.daysAfterFirstPlay };
}

/**
 * The sentence an office admin reads for a link that cannot be turned back
 * on. `renewalsUsed` is how many times it already was, for the wording.
 * Plain words, no technical terms: it is shown on the screen as it is.
 */
export function finishedLinkMessage(reason: Extract<RenewalState, { kind: "finished" }>["reason"], renewalsUsed: number): string {
  switch (reason) {
    case "legacy":
      return "This link was made under the older rule, with a fixed date, so it cannot be turned back on. Make the patient a new link.";
    case "never-played":
      return "This link was never played, so it cannot be turned back on. Make the patient a new link.";
    case "no-renewals-left":
      return renewalsUsed === 0
        ? "Links cannot be turned back on right now: the maximum number of renewals is set to zero. Make the patient a new link."
        : `This link has been turned back on ${renewalsUsed} ${renewalsUsed === 1 ? "time" : "times"} already, the maximum, so it cannot be turned back on again. Make the patient a new link.`;
    case "no-days":
      return "This link carries no number of days to give, so it cannot be turned back on. Make the patient a new link.";
  }
}

/** Where the deadline moves to when the clinic turns a paused link back on at `now`: that moment plus the days the link was issued with. */
export function expiryAfterRenewal(share: { daysAfterFirstPlay: number }, now: Date): Date {
  return addDays(now, share.daysAfterFirstPlay);
}

/**
 * May a tap on "ask my clinic" send a request right now? Yes when the link
 * has never been asked about, or the last request is at least a day old.
 * The database write asks the same question in its WHERE, so two taps at
 * once send one request.
 */
export function canRequestRenewal(share: { renewalRequestedAt: Date | null }, now: Date): boolean {
  if (share.renewalRequestedAt === null) return true;
  return share.renewalRequestedAt.getTime() + RENEWAL_REQUEST_GAP_MS <= now.getTime();
}
