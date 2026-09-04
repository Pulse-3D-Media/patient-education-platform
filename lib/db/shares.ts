import { randomInt } from "crypto";
import { prisma } from "./client";

/**
 * Queries for the Share table. A share is one link a clinic gives a patient:
 * /watch/<code>, tied to a procedure video and a clinic, never to a person.
 *
 * Every function here takes clinicId as its first argument and filters by it
 * (rule 1 in CLAUDE.md). That is what keeps one clinic from ever seeing
 * another clinic's links.
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
 * Every share link this clinic has created, newest first, with the title of
 * the video each one points at.
 */
export async function listSharesForClinic(clinicId: string) {
  return prisma.share.findMany({
    where: { clinicId },
    include: { video: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });
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
 * not exist or has already expired, so an old link can never move the numbers.
 */
export async function recordShareView(code: string) {
  await prisma.share.updateMany({
    where: { code, expiresAt: { gt: new Date() } },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
}
