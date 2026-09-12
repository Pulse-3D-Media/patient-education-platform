import { randomInt } from "crypto";
import { prisma } from "./client";

/**
 * Queries for the Share table. A share is one link a clinic gives a patient:
 * /watch/<code>, tied to a procedure video and a clinic, never to a person.
 *
 * Functions used on the clinic side take clinicId as their first argument
 * and filter by it (rule 1 in CLAUDE.md). That is what keeps one clinic from
 * ever seeing another clinic's links. The two exceptions, getShareByCode and
 * recordShareView, serve the public patient page, where there is no clinic.
 */

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
 * Create a share link for one video that stops working after `days` days.
 * Returns the new Share row, including its code.
 */
export async function createShare(clinicId: string, videoId: string, days: number) {
  // Only published videos can be shared. Unpublished ones are Van's staging
  // area and must never reach a patient.
  const video = await prisma.video.findFirst({
    where: { id: videoId, isPublished: true },
    select: { id: true },
  });
  if (!video) {
    throw new Error("That video is not published, so it cannot be shared.");
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // There are about two billion possible codes, so a clash is very unlikely,
  // but the code column is unique, so check before saving and try again if
  // the code is already taken.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const taken = await prisma.share.findUnique({ where: { code }, select: { id: true } });
    if (taken) continue;

    return prisma.share.create({
      data: { code, clinicId, videoId, expiresAt },
    });
  }

  throw new Error("Could not find an unused share code. Please try again.");
}

/**
 * Every share link this clinic has created, newest first, with the title and
 * category of the video each one points at, whether that video is a
 * placeholder, and whether it is published (a link to an unpublished video
 * does not work). The category is what lets the admin page filter links
 * with the same pills it uses for procedures.
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

/** The numbers on the admin overview. Every one is a count or a sum done in the database. */
export type ShareSummary = {
  /** Links that work right now: not expired, and their video is published. */
  working: number;
  /** Working links that stop working within SUMMARY_SOON_DAYS. */
  expiringSoon: number;
  /** Links that have not expired but point at a video that is not published right now, so they do not work. */
  notWorking: number;
  /** Links made in the last SUMMARY_RECENT_DAYS days, whether or not they still work. */
  madeRecently: number;
  /** Play starts across every link this clinic has ever made. A play start is a play start: not a patient, not a completed watch. */
  playStarts: number;
};

/**
 * A handful of totals about one clinic's share links, for the admin
 * overview. Counts and a sum, all worked out in the database, so the
 * overview reads five numbers rather than the whole links table.
 */
export async function summarizeSharesForClinic(clinicId: string): Promise<ShareSummary> {
  const now = new Date();
  const soon = new Date(now.getTime() + SUMMARY_SOON_DAYS * 24 * 60 * 60 * 1000);
  const since = new Date(now.getTime() - SUMMARY_RECENT_DAYS * 24 * 60 * 60 * 1000);

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

/**
 * Count one view of a share: add one to viewCount and stamp lastViewedAt.
 * Called when the patient presses play. Does nothing for a code that does
 * not exist, has already expired, or points at a video that is not
 * published (the patient page shows nothing to play then), so an old link
 * can never move the numbers.
 */
export async function recordShareView(code: string) {
  await prisma.share.updateMany({
    where: { code, expiresAt: { gt: new Date() }, video: { isPublished: true } },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
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
