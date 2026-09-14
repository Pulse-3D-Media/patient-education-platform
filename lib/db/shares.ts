import { randomInt } from "crypto";
import { accessRefusalMessage, decideVideoAccess, type AccessDecision, type AccessReason } from "../access";
import { addDays, canClaimFirstPlay, expiryAfterFirstPlay, isExpired, resolveShareTerms, type ShareTerms } from "../expiry";
import { lockClinicAccess, lockVideoFacts } from "./access";
import { prisma } from "./client";
import { getSettings, lockSettings } from "./settings";

/**
 * Queries for the Share table. A share is one link a clinic gives a patient:
 * /watch/<code>, tied to a procedure video and a clinic, never to a person.
 *
 * Functions used on the clinic side take clinicId as their first argument
 * and filter by it (rule 1 in CLAUDE.md). That is what keeps one clinic from
 * ever seeing another clinic's links. The two exceptions, getShareByCode and
 * recordSharePlay, serve the public patient page, where there is no clinic.
 *
 * How long a link works is decided by the rule in lib/expiry.ts. A link made
 * here stops after the platform's unclaimed days if nobody plays it, and the
 * first real play (recordSharePlay) moves its deadline to that moment plus
 * the days copied onto the link when it was made. Links made before that
 * rule keep the fixed date they were issued with.
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
 */
export async function createShare(clinicId: string, videoId: string, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const access = await lockClinicAccess(tx, clinicId);
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
 * Look a share up by the code in its URL, with the video it plays and the
 * name of the clinic that made it. Returns null for a code that does not exist.
 *
 * Public on purpose: the patient is not signed in and belongs to no clinic,
 * so this is the one function here that does not take a clinicId. The rules
 * file allows exactly this for the watch page.
 */
export async function getShareByCode(code: string) {
  return prisma.share.findUnique({
    where: { code },
    include: { video: true, clinic: { select: { name: true } } },
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
 * One of this clinic's shares, by code, for the admin pages. Returns null if
 * the code does not exist or belongs to another clinic; the admin pages
 * treat both the same way.
 */
export async function getShareForClinic(clinicId: string, code: string) {
  return prisma.share.findFirst({
    where: { code, clinicId },
    include: { video: { select: { title: true } } },
  });
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
