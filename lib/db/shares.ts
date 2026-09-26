import { randomInt } from "crypto";
import { accessRefusalMessage, decideVideoAccess, type AccessDecision, type AccessReason } from "../access";
import {
  addDays,
  canClaimFirstPlay,
  canRequestRenewal,
  expiryAfterFirstPlay,
  expiryAfterRenewal,
  finishedLinkMessage,
  isExpired,
  isValidRenewalCount,
  RENEWAL_REQUEST_GAP_MS,
  renewalState,
  resolveShareTerms,
  type ShareTerms,
} from "../expiry";
import { isClerkUserId } from "../seats";
import { effectiveSenderName } from "../sender-name";
import { lockClinicAccess, lockSenderSeat, lockShareForRenewal, lockVideoFacts } from "./access";
import { prisma } from "./client";
import { getSettings, lockSettings } from "./settings";

/**
 * Queries for the Share table. A share is one link a clinic gives a patient:
 * /watch/<code>, tied to a procedure video, a clinic and the surgeon it is
 * from, never to a patient.
 *
 * Functions used on the clinic side take clinicId as their first argument
 * and filter by it (rule 1 in CLAUDE.md). That is what keeps one clinic from
 * ever seeing another clinic's links. The three exceptions, getShareByCode,
 * recordSharePlay and requestShareRenewal, serve the public patient page,
 * where there is no clinic.
 *
 * How long a link works is decided by the rule in lib/expiry.ts. A link made
 * here stops after the platform's unclaimed days if nobody plays it, and the
 * first real play (recordSharePlay) moves its deadline to that moment plus
 * the days copied onto the link when it was made. When those days run out
 * the link pauses, the patient can ask the clinic to turn it back on
 * (requestShareRenewal), and an office admin can (renewShareForClinic), a
 * limited number of times. Links made before the first-play rule keep the
 * fixed date they were issued with and are never paused.
 */

/**
 * createShare() said no. The message is the plain sentence to show the
 * person who asked (see accessRefusalMessage in lib/access.ts); `reason`
 * says which check failed, for tests and logs.
 */
export class ShareRefusedError extends Error {
  readonly reason: AccessReason;

  constructor(reason: AccessReason) {
    super(accessRefusalMessage(reason));
    this.name = "ShareRefusedError";
    this.reason = reason;
  }
}

/**
 * createShare() was asked to make a link from someone who does not hold a
 * seat at this clinic right now: never seated, seat let go, in another
 * clinic, or not a Clerk user id at all. Nothing was written. The message is
 * the plain sentence to show.
 */
export class SenderRefusedError extends Error {
  constructor() {
    super("That person does not hold a seat in your clinic right now, so links cannot be sent from them. Choose someone who does.");
    this.name = "SenderRefusedError";
  }
}

/**
 * Who a new link is from. `clerkUserId` is the surgeon; `fallbackName` is
 * the name to show when no name has been typed for them on /admin/people
 * ("Dr. First Last" from Clerk, or null). Worked out on the server
 * (lib/senders.ts), never taken from the browser as it stands.
 */
export type ShareSender = { clerkUserId: string; fallbackName: string | null };

/** The characters a share code is made from: lowercase letters and digits. */
const CODE_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 6;

/** A random six-character code such as "k7m2xq". */
function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARACTERS[randomInt(CODE_CHARACTERS.length)];
  }
  return code;
}

/**
 * The two numbers a link made for this clinic right now would carry: the
 * platform's unclaimed days, and the days after the first play (the
 * clinic's own override when Pulse staff have set one, else the platform's
 * viewDays). The pages that say "works for 7 days after the first play"
 * read this, and createShare() resolves the very same numbers when it
 * writes a link, so the words and the link cannot disagree. Null for an
 * unknown clinic.
 */
export async function getShareTerms(clinicId: string): Promise<ShareTerms | null> {
  const [settings, clinic] = await Promise.all([
    getSettings(),
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { viewDaysOverride: true } }),
  ]);
  return clinic ? resolveShareTerms(settings, clinic) : null;
}

/**
 * Create a share link for one video. Returns the new Share row, including
 * its code.
 *
 * The link is made under the first-play rule (lib/expiry.ts): it stops
 * after the platform's unclaimed days if nobody plays it, and the days it
 * gets after its first play are copied onto it here, from the settings as
 * they are at this moment. The settings are read inside the transaction
 * with the settings lock held (lockSettings in lib/db/settings.ts), so a
 * save that lands at the same moment either came first and is what the
 * link gets, or waits until the link is written: a link never carries
 * numbers that were already out of date when it was made. A settings edit
 * later changes links made from then on, never this one. Both numbers are
 * checked before they become dates (resolveShareTerms), and a value outside
 * the limits throws a ShareTermsError with nothing written. `now` is the
 * server's clock unless a test hands in its own.
 *
 * This is the one place a share is written, and it is where access is
 * enforced: the clinic must be open, the video published and in a
 * category on the clinic's plan, and a placeholder video only while the
 * clinic is shown placeholders (the rule is decideVideoAccess in
 * lib/access.ts). Anything else throws a ShareRefusedError carrying a
 * plain message, and nothing is written. The admin form and the library's
 * Send button both land here, so a hidden button or a filtered list is
 * never the only thing standing between a clinic and a link.
 *
 * The check and the write happen inside one transaction, and the clinic
 * and video rows are read with a share lock (lockClinicAccess and
 * lockVideoFacts in lib/db/access.ts), which holds them against change
 * until the transaction ends. So the facts are as they are at that moment,
 * not as they were when the page was drawn, and a change cannot slip in
 * between the check and the write either: a plan removal, a pause, a
 * placeholder-setting change or an unpublish that arrives during this
 * transaction waits for it to finish (the link is issued, and stays
 * usable, as issued links do), or landed first and is seen here (the link
 * is refused). A form rendered while a video was on the plan, and
 * submitted after the plan changed, is refused.
 *
 * WHO IT IS FROM. Both places that make links (the admin's Create link and
 * the library's Send) pass `sender`, the surgeon the link is from. Inside
 * the same transaction their seat at THIS clinic is read with a share lock
 * (lockSenderSeat); no seat, and a SenderRefusedError is thrown with nothing
 * written. The name the patient will see is the one typed for them on
 * /admin/people, else `fallbackName`, and it is copied onto the link with
 * their user id, so a later name change or their leaving never changes a
 * link already sent. Only the tests and the seed scripts make links with no
 * sender; such a link says only which clinic sent it, as every link made
 * before surgeons were recorded does.
 */
export async function createShare(clinicId: string, videoId: string, options: { now?: Date; sender?: ShareSender } = {}) {
  const now = options.now ?? new Date();
  const sender = options.sender;
  // A malformed id could never match a seat; refused here before any lock is taken.
  if (sender && !isClerkUserId(sender.clerkUserId)) throw new SenderRefusedError();

  return prisma.$transaction(async (tx) => {
    const access = await lockClinicAccess(tx, clinicId, now);
    // An unknown clinic id has nothing to grant, so it answers as closed.
    const decision: AccessDecision = access
      ? decideVideoAccess(access, await lockVideoFacts(tx, videoId))
      : { allowed: false, reason: "clinic-closed" };
    if (!decision.allowed) throw new ShareRefusedError(decision.reason);

    // The platform's numbers, read here inside the transaction with the
    // settings lock held, and the clinic's own number, whose row is held by
    // the lock above. Both are as they are at this moment, and neither can
    // change until the link is written. What is copied onto the link here
    // is what it carries for good.
    const settings = await lockSettings(tx);
    const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { viewDaysOverride: true } });
    const terms = resolveShareTerms(settings, clinic);

    // The surgeon must hold a seat at this clinic at this moment, and the
    // seat is held against change until the link is written.
    let senderName: string | null = null;
    if (sender) {
      const seat = await lockSenderSeat(tx, clinicId, sender.clerkUserId);
      if (!seat) throw new SenderRefusedError();
      senderName = effectiveSenderName(seat.displayName, sender.fallbackName);
    }

    // There are about two billion possible codes, so a clash is very unlikely,
    // but the code column is unique, so check before saving and try again if
    // the code is already taken.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const taken = await tx.share.findUnique({ where: { code }, select: { id: true } });
      if (taken) continue;

      return tx.share.create({
        data: {
          code,
          clinicId,
          videoId,
          expiryPolicy: "FIRST_PLAY",
          expiresAt: addDays(now, terms.unclaimedDays),
          daysAfterFirstPlay: terms.daysAfterFirstPlay,
          senderUserId: sender?.clerkUserId ?? null,
          senderName,
        },
      });
    }

    throw new Error("Could not find an unused share code. Please try again.");
  });
}

/**
 * Every share link this clinic has created, newest first, with the title and
 * category of the video each one points at, whether that video is a
 * placeholder, and whether it is published (a link to an unpublished video
 * does not work). The category is what lets the admin page filter links
 * with the same pills it uses for procedures. The expiry fields come with
 * each row, so the page can describe the link with the rule in lib/expiry.ts.
 */
export async function listSharesForClinic(clinicId: string) {
  return prisma.share.findMany({
    where: { clinicId },
    include: { video: { select: { title: true, category: true, isPlaceholder: true, isPublished: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * The newest few share links this clinic has made, with the same video
 * fields as listSharesForClinic. For the admin overview, which shows a
 * short recent list and sends people to /admin/links for the rest. `limit`
 * caps the rows read, so the overview never loads the whole history.
 */
export async function listRecentSharesForClinic(clinicId: string, limit: number) {
  return prisma.share.findMany({
    where: { clinicId },
    include: { video: { select: { title: true, category: true, isPlaceholder: true, isPublished: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 20)),
  });
}

/** How far back "links made recently" looks on the admin overview, and how soon "expiring soon" is. */
export const SUMMARY_RECENT_DAYS = 30;
export const SUMMARY_SOON_DAYS = 7;

/**
 * The numbers on the admin overview. Every one is a count or a sum done in
 * the database, over the links that are on the list right now. Cancelling
 * a link deletes its row (deleteShareForClinic), so a cancelled link drops
 * out of every number here, its play starts included. None of these is a
 * lifetime total, and the overview says so beside them.
 */
export type ShareSummary = {
  /** Links that work right now: not expired, and their video is published. */
  working: number;
  /** Working links that stop working within SUMMARY_SOON_DAYS. */
  expiringSoon: number;
  /** Links that have not expired but point at a video that is not published right now, so they do not work. */
  notWorking: number;
  /** Links made in the last SUMMARY_RECENT_DAYS days that are still on the list, whether or not they still work. */
  madeRecently: number;
  /**
   * Play starts across the links still on the list. A play start is counted
   * once per page load, the first time the video actually starts playing on
   * the patient page (recordSharePlay, called from the player): not a
   * patient, not a completed watch, not every press of play.
   */
  playStarts: number;
};

/**
 * A handful of totals about one clinic's share links, for the admin
 * overview. Counts and a sum, all worked out in the database, so the
 * overview reads five numbers rather than the whole links table. Cancelled
 * links are gone from the table, so they are not in these numbers.
 */
export async function summarizeSharesForClinic(clinicId: string): Promise<ShareSummary> {
  const now = new Date();
  const soon = addDays(now, SUMMARY_SOON_DAYS);
  const since = addDays(now, -SUMMARY_RECENT_DAYS);

  const [working, expiringSoon, notWorking, madeRecently, views] = await Promise.all([
    prisma.share.count({ where: { clinicId, expiresAt: { gt: now }, video: { isPublished: true } } }),
    prisma.share.count({ where: { clinicId, expiresAt: { gt: now, lte: soon }, video: { isPublished: true } } }),
    prisma.share.count({ where: { clinicId, expiresAt: { gt: now }, video: { isPublished: false } } }),
    prisma.share.count({ where: { clinicId, createdAt: { gte: since } } }),
    prisma.share.aggregate({ where: { clinicId }, _sum: { viewCount: true } }),
  ]);

  return { working, expiringSoon, notWorking, madeRecently, playStarts: views._sum.viewCount ?? 0 };
}

/**
 * What the patient page may know about the clinic that sent the link: its
 * name and its branding (logo, phone, brand colour, font). Every one of
 * these is meant to be seen by the patient. Nothing else about the clinic
 * is read here: not its status, its plan, its notes or its notice.
 */
const PATIENT_CLINIC_FIELDS = { name: true, logoUrl: true, phone: true, brandColor: true, brandFont: true } as const;

/**
 * Look a share up by the code in its URL, with the video it plays and the
 * name and branding of the clinic that made it. Returns null for a code
 * that does not exist.
 *
 * Public on purpose: the patient is not signed in and belongs to no clinic,
 * so this is the one function here that does not take a clinicId. The rules
 * file allows exactly this for the watch page.
 */
export async function getShareByCode(code: string) {
  return prisma.share.findUnique({
    where: { code },
    include: { video: true, clinic: { select: PATIENT_CLINIC_FIELDS } },
  });
}

/** What recordSharePlay() did: counted the play (and whether it was the link's first), or why it wrote nothing. */
export type PlayRecord =
  | { recorded: true; firstPlay: boolean }
  | { recorded: false; reason: "no-such-link" | "expired" | "unpublished" };

/** The fields recordSharePlay reads before it writes. */
const PLAY_FIELDS = {
  expiryPolicy: true,
  expiresAt: true,
  firstPlayedAt: true,
  daysAfterFirstPlay: true,
  video: { select: { isPublished: true } },
} as const;

type PlayFacts = { expiryPolicy: "FIXED" | "FIRST_PLAY"; expiresAt: Date; firstPlayedAt: Date | null; daysAfterFirstPlay: number | null; video: { isPublished: boolean } };

/** Why a play cannot be counted, in the order the patient page checks: missing, expired, taken down. Null when it can. */
function whyNotWorking(share: PlayFacts | null, now: Date): PlayRecord | null {
  if (!share) return { recorded: false, reason: "no-such-link" };
  if (isExpired(share, now)) return { recorded: false, reason: "expired" };
  if (!share.video.isPublished) return { recorded: false, reason: "unpublished" };
  return null;
}

/** The link was there and working a moment ago, so a write that changed nothing means it expired in between. */
const EXPIRED_MEANWHILE: PlayRecord = { recorded: false, reason: "expired" };

/**
 * Count one play start of a share link, and, if it is a first-play link
 * that has never been played, move its deadline: firstPlayedAt is set to
 * `now`, expiresAt becomes `now` plus the days copied onto the link, and
 * the view count goes up by one, all in one write. Every later play only
 * adds to the count; the deadline never moves again, on any link.
 *
 * Called from the patient player the first time the video actually starts
 * playing on that page load (not when the page loads, not when a text
 * message previews it, not when the browser fetches the poster or the
 * first bytes, and not on pause or resume). `now` is the server's clock
 * unless a test hands in its own.
 *
 * Writes nothing, and says why, for a code that does not exist, a link
 * that has expired (at its deadline or past it), or a video that is not
 * published: an old link can never move the numbers, and a page that was
 * opened before the deadline cannot bring the link back after it. The
 * check is made twice: once on a fresh read, and again by the WHERE of
 * every write, so a link that expired or was cancelled between the two
 * changes nothing.
 *
 * Two first plays at once: the claim is one UPDATE whose WHERE says "and
 * firstPlayedAt is still empty". Postgres runs two updates to one row one
 * after the other and re-checks the WHERE for the second, so exactly one
 * of them moves the deadline; the other finds the claim gone, and counts
 * its play like any later one.
 *
 * A legacy link (expiryPolicy FIXED, every link made before this rule)
 * takes the counting path only. Its date was set when it was made and
 * stays where it is, played or not.
 */
export async function recordSharePlay(code: string, now: Date = new Date()): Promise<PlayRecord> {
  const share = await prisma.share.findUnique({ where: { code }, select: PLAY_FIELDS });
  if (!share) return { recorded: false, reason: "no-such-link" };
  const refusal = whyNotWorking(share, now);
  if (refusal) return refusal;

  // Every write below carries this: the link must still exist, still be
  // before its deadline, and its video still be published, at the moment
  // the write runs.
  const stillWorking = { code, expiresAt: { gt: now }, video: { isPublished: true } };

  if (canClaimFirstPlay(share)) {
    const claimed = await prisma.share.updateMany({
      where: { ...stillWorking, expiryPolicy: "FIRST_PLAY", firstPlayedAt: null },
      data: { firstPlayedAt: now, expiresAt: expiryAfterFirstPlay(share, now), viewCount: { increment: 1 }, lastViewedAt: now },
    });
    if (claimed.count === 1) return { recorded: true, firstPlay: true };
    // Another play claimed it a moment ago, or the link stopped working.
    // Fall through and count this play like any later one.
  }

  const counted = await prisma.share.updateMany({
    where: stillWorking,
    data: { viewCount: { increment: 1 }, lastViewedAt: now },
  });
  if (counted.count === 1) return { recorded: true, firstPlay: false };

  // Nothing was written: the link stopped working between the read and the write. Say why, from a fresh read.
  const again = await prisma.share.findUnique({ where: { code }, select: PLAY_FIELDS });
  return whyNotWorking(again, now) ?? EXPIRED_MEANWHILE;
}

/**
 * One of this clinic's shares, by code, for the admin pages (the QR picture
 * and the pamphlet), with its video's title and placeholder mark and the
 * clinic's name for "Sent by ...". Returns null if the code does not exist
 * or belongs to another clinic; the admin pages treat both the same way.
 */
export async function getShareForClinic(clinicId: string, code: string) {
  return prisma.share.findFirst({
    where: { code, clinicId },
    include: { video: { select: { title: true, isPlaceholder: true, isPublished: true } }, clinic: { select: { name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Pausing and reactivation. The rule is renewalState() in lib/expiry.ts;
// everything here asks it, so the patient page, the request, the admin page
// and the reactivation cannot disagree about whether a link is paused.
// ---------------------------------------------------------------------------

/** How many times a link may be turned back on, from the setting as it is now; a setting that cannot be read means zero. */
function renewalsAllowed(settings: { maxRenewals: number }): number {
  return isValidRenewalCount(settings.maxRenewals) ? settings.maxRenewals : 0;
}

/** The fields the reactivation rule reads, plus what the request needs to tell the clinic. */
const RENEWAL_REQUEST_FIELDS = {
  code: true,
  createdAt: true,
  expiryPolicy: true,
  expiresAt: true,
  firstPlayedAt: true,
  daysAfterFirstPlay: true,
  renewalsUsed: true,
  renewalRequestedAt: true,
  senderName: true,
  video: { select: { title: true, isPublished: true } },
  clinic: { select: { id: true, name: true, clerkOrgId: true } },
} as const;

/**
 * What the clinic is told when a patient asks for a paused link back. All
 * of it is about the link, the video, the surgeon and the clinic; nothing
 * about the patient exists to include (rule 2).
 */
export type RenewalRequestFacts = {
  code: string;
  videoTitle: string;
  /** "Dr. Jane Smith", or null for a link made before surgeons were recorded. */
  senderName: string | null;
  /** When the link was made. */
  createdAt: Date;
  /** How many more times the clinic may turn it back on, this time included. */
  renewalsLeft: number;
  /** How many days each reactivation gives. */
  daysPerRenewal: number;
  /** When this request was recorded. */
  requestedAt: Date;
  clinic: { id: string; name: string; clerkOrgId: string | null };
};

/** What requestShareRenewal() did. */
export type RenewalRequestOutcome =
  /** The request was written just now; the clinic should be told. */
  | { kind: "requested"; facts: RenewalRequestFacts }
  /** The link was asked about within the last day (by this tap's twin, or earlier). Nothing written; the patient sees the same confirmation. */
  | { kind: "already-asked" }
  /** No request can be made: the code is nobody's, the link is not paused, or its video is not available. */
  | { kind: "refused"; reason: "no-such-link" | "not-paused" | "unpublished" };

/**
 * A patient tapped "ask my clinic to turn it back on" on a paused link.
 * Records the request on the link (Share.renewalRequestedAt) and says
 * whether the clinic should be told.
 *
 * Public on purpose: the patient is not signed in and belongs to no clinic,
 * so this is the third function here that takes no clinicId (with
 * getShareByCode and recordSharePlay). It writes one timestamp on the link
 * and nothing else: no name, no address, nothing typed, because there is
 * nothing to type (rule 2).
 *
 * One request per link per day (RENEWAL_REQUEST_GAP_MS). The write is a
 * single UPDATE whose WHERE says "still paused, and not asked about within
 * the last day", so two taps at once, or a page opened twice, record one
 * request and the clinic is told once. A tap inside the day answers
 * already-asked and writes nothing; the patient page shows the same calm
 * confirmation either way.
 *
 * Only a paused link can be asked about (renewalState in lib/expiry.ts): a
 * working link, a finished one, a legacy link, one nobody played, and a
 * link whose video is not published right now are all refused, with the
 * reason for the page and the tests. `now` is the server's clock unless a
 * test hands in its own.
 */
export async function requestShareRenewal(code: string, now: Date = new Date()): Promise<RenewalRequestOutcome> {
  const [settings, share] = await Promise.all([getSettings(), prisma.share.findUnique({ where: { code }, select: RENEWAL_REQUEST_FIELDS })]);
  if (!share) return { kind: "refused", reason: "no-such-link" };

  const allowed = renewalsAllowed(settings);
  const state = renewalState(share, allowed, now);
  if (state.kind !== "paused") return { kind: "refused", reason: "not-paused" };
  if (!share.video.isPublished) return { kind: "refused", reason: "unpublished" };
  if (!canRequestRenewal(share, now)) return { kind: "already-asked" };

  // The same conditions again, in the WHERE of the one write, so what was
  // read a moment ago cannot have changed under it: the link must still be
  // paused, and nobody may have asked within the last day.
  const written = await prisma.share.updateMany({
    where: {
      code,
      expiryPolicy: "FIRST_PLAY",
      firstPlayedAt: { not: null },
      expiresAt: { lte: now },
      renewalsUsed: { lt: allowed },
      video: { isPublished: true },
      OR: [{ renewalRequestedAt: null }, { renewalRequestedAt: { lte: new Date(now.getTime() - RENEWAL_REQUEST_GAP_MS) } }],
    },
    data: { renewalRequestedAt: now },
  });
  // Nothing written means another tap got there first, or the clinic turned
  // the link back on in between. Either way the calm confirmation is right.
  if (written.count !== 1) return { kind: "already-asked" };

  return {
    kind: "requested",
    facts: {
      code: share.code,
      videoTitle: share.video.title,
      senderName: share.senderName,
      createdAt: share.createdAt,
      renewalsLeft: state.renewalsLeft,
      daysPerRenewal: state.daysPerRenewal,
      requestedAt: now,
      clinic: share.clinic,
    },
  };
}

/** What renewShareForClinic() did, or why it did nothing. Every message is a plain sentence for the admin's screen. */
export type RenewalOutcome =
  | { ok: true; expiresAt: Date; renewalsUsed: number; renewalsLeft: number; message: string }
  | { ok: false; reason: "no-such-link" | "clinic-closed" | "working" | "unpublished" | "finished"; message: string };

/** "Oct 6, 2026", in Utah time like the rest of the admin area, for the log entry and the message. */
function dayWords(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

/**
 * An office admin pressed Confirm on /admin/reactivate/<code>: turn one of
 * this clinic's paused links back on for the days it was issued with, and
 * count the renewal. Returns what happened, with a sentence for the screen.
 *
 * Takes clinicId first (rule 1): the code is looked up WITHIN this clinic,
 * so another clinic's admin, or a forged code, finds no link. `actorName`
 * is the admin's name from Clerk, for the clinic log; never from the browser.
 *
 * Read, decide and write in one transaction, under locks, because the
 * decision depends on what is read:
 *
 *   - the clinic row is read with a share lock (lockClinicAccess), so the
 *     clinic is open at this moment and a pause arriving now waits;
 *   - the link's row is read FOR NO KEY UPDATE (lockShareForRenewal), so a
 *     second reactivation of the same link, from another admin or a double
 *     click, waits until this one has committed, then finds the link
 *     already working and does nothing: two presses renew once;
 *   - the settings are read with the settings lock held shared, so the
 *     maximum renewals is the number in force at this moment.
 *
 * Then the rule (renewalState) decides. Only a PAUSED link is changed: its
 * deadline moves to now plus its own days, its renewals-used count goes up
 * by one, the patient's request is cleared (so the link is not listed as
 * waiting again the moment it next pauses), and one entry goes in the
 * clinic log, in the same transaction. A working link, a finished one, a
 * legacy link, one nobody played, one whose video is not published, or a
 * clinic that is not open: nothing is written, and the reason is returned.
 */
export async function renewShareForClinic(clinicId: string, code: string, actorName: string, now: Date = new Date()): Promise<RenewalOutcome> {
  return prisma.$transaction(async (tx) => {
    const access = await lockClinicAccess(tx, clinicId, now);
    if (!access || !access.open) {
      return {
        ok: false,
        reason: "clinic-closed",
        message: "Your clinic is not open right now, so links cannot be turned back on. The Billing page says where things stand.",
      };
    }

    const share = await lockShareForRenewal(tx, clinicId, code);
    if (!share) return { ok: false, reason: "no-such-link", message: "We couldn't find that link for your clinic." };

    const settings = await lockSettings(tx);
    const allowed = renewalsAllowed(settings);
    const state = renewalState(share, allowed, now);
    if (state.kind === "working") {
      return { ok: false, reason: "working", message: `This link is already working. It works until ${dayWords(share.expiresAt)}; nothing to do.` };
    }
    if (state.kind === "finished") return { ok: false, reason: "finished", message: finishedLinkMessage(state.reason, share.renewalsUsed) };
    if (!share.videoIsPublished) {
      return {
        ok: false,
        reason: "unpublished",
        message: "The video behind this link is not available right now, so the link cannot be turned back on. Ask Pulse 3D about the video.",
      };
    }

    const expiresAt = expiryAfterRenewal({ daysAfterFirstPlay: state.daysPerRenewal }, now);
    const renewalsUsed = share.renewalsUsed + 1;
    // An increment rather than the number worked out above: under the lock
    // the two are the same, and an increment stays an honest count even if
    // the lock were ever lost (the overlap test's control shows that case).
    await tx.share.update({
      where: { id: share.id },
      data: { expiresAt, renewalsUsed: { increment: 1 }, lastRenewedAt: now, renewalRequestedAt: null },
      select: { id: true },
    });
    await tx.clinicNote.create({
      data: {
        clinicId,
        kind: "STATUS",
        body: `Link ${share.code} (${share.videoTitle}) turned back on: renewal ${renewalsUsed} of ${allowed}. It works until ${dayWords(expiresAt)}.`,
        authorName: `${actorName} (clinic admin)`,
      },
      select: { id: true },
    });

    const renewalsLeft = allowed - renewalsUsed;
    return {
      ok: true,
      expiresAt,
      renewalsUsed,
      renewalsLeft,
      message: `Done. The link works again until ${dayWords(expiresAt)}. ${
        renewalsLeft === 0 ? "That was its last renewal." : `It can be turned back on ${renewalsLeft} more ${renewalsLeft === 1 ? "time" : "times"}.`
      }`,
    };
  });
}

/** One paused link a patient has asked about, for the overview's "Links waiting to be reactivated". */
export type RenewalRequestRow = {
  code: string;
  videoTitle: string;
  isPlaceholder: boolean;
  senderName: string | null;
  createdAt: Date;
  /** When the patient last asked. */
  requestedAt: Date;
  renewalsLeft: number;
  daysPerRenewal: number;
};

/**
 * This clinic's paused links that a patient has asked about and nobody has
 * turned back on yet, most recently asked first. This is where an admin
 * finds a request when no email reached them (no email service set up, or
 * an email missed). A link drops off the moment it is turned back on
 * (the request is cleared then) or can no longer be (finished). Bounded:
 * at most `limit` rows are read.
 */
export async function listRenewalRequestsForClinic(clinicId: string, limit: number, now: Date = new Date()): Promise<RenewalRequestRow[]> {
  const settings = await getSettings();
  const allowed = renewalsAllowed(settings);
  const rows = await prisma.share.findMany({
    where: {
      clinicId,
      expiryPolicy: "FIRST_PLAY",
      firstPlayedAt: { not: null },
      expiresAt: { lte: now },
      renewalRequestedAt: { not: null },
      renewalsUsed: { lt: allowed },
      video: { isPublished: true },
    },
    select: {
      code: true,
      createdAt: true,
      renewalRequestedAt: true,
      senderName: true,
      expiryPolicy: true,
      expiresAt: true,
      firstPlayedAt: true,
      daysAfterFirstPlay: true,
      renewalsUsed: true,
      video: { select: { title: true, isPlaceholder: true } },
    },
    orderBy: { renewalRequestedAt: "desc" },
    take: Math.max(1, Math.min(limit, 20)),
  });

  // The query narrowed the rows; the rule itself has the last word, so the list and the page can never disagree.
  const waiting: RenewalRequestRow[] = [];
  for (const row of rows) {
    const state = renewalState(row, allowed, now);
    if (state.kind !== "paused" || row.renewalRequestedAt === null) continue;
    waiting.push({
      code: row.code,
      videoTitle: row.video.title,
      isPlaceholder: row.video.isPlaceholder,
      senderName: row.senderName,
      createdAt: row.createdAt,
      requestedAt: row.renewalRequestedAt,
      renewalsLeft: state.renewalsLeft,
      daysPerRenewal: state.daysPerRenewal,
    });
  }
  return waiting;
}

/**
 * Cancel one of this clinic's share links by deleting it. The link stops
 * working at once: a patient who still has it sees the "we couldn't find
 * this link" page. Returns true if a link was removed, false if no link had
 * that code or it belongs to another clinic (the clinicId filter is what
 * stops one clinic cancelling another clinic's links).
 */
export async function deleteShareForClinic(clinicId: string, code: string) {
  const result = await prisma.share.deleteMany({ where: { code, clinicId } });
  return result.count > 0;
}
