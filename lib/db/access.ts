import type { Prisma, PrismaClient } from "@prisma/client";
import { accessFromClinic, decideVideoAccess, type AccessDecision, type ClinicAccess, type VideoFacts } from "../access";
import { prisma } from "./client";

/**
 * What a clinic may use, read from the database and decided by the rule in
 * lib/access.ts. This is the one place a page or an action asks "may this
 * clinic use this?"; nothing re-implements the checks.
 *
 *   getClinicAccess(clinicId)        the clinic's status, plan and
 *                                    placeholder setting, in one read.
 *                                    Pages call it once per request and
 *                                    then decide for every video in memory.
 *   canUseVideo(clinicId, videoId)   one video, with the reason when the
 *                                    answer is no.
 *
 * Both take a clinicId that came from the server's own check of who is
 * signed in (getCurrentClinicId() in lib/clinic.ts), never from the
 * browser: a clinic id in a form is a request, not an identity, and a
 * forged one cannot borrow another clinic's plan because the actions never
 * read it.
 *
 * createShare() in lib/db/shares.ts uses the two `read` helpers below
 * inside its own transaction, so the check and the write see the same
 * moment: a form rendered when a video was on the plan cannot create a
 * link after the plan changed.
 */

/** The ordinary client, or the client inside an interactive transaction. */
type Db = PrismaClient | Prisma.TransactionClient;

/** The four fields the access rule reads about a clinic. */
const ACCESS_FIELDS = { id: true, status: true, categories: true, showPlaceholders: true } as const;

/** The three fields the access rule reads about a video. */
const VIDEO_FACTS = { category: true, isPublished: true, isPlaceholder: true } as const;

/** Read one clinic's access facts with the client given. Null for an unknown clinic. */
export async function readClinicAccess(db: Db, clinicId: string): Promise<ClinicAccess | null> {
  const clinic = await db.clinic.findUnique({ where: { id: clinicId }, select: ACCESS_FIELDS });
  return clinic ? accessFromClinic(clinic) : null;
}

/** Read the three facts about one video with the client given. Null when no video has that id. */
export async function readVideoFacts(db: Db, videoId: string): Promise<VideoFacts | null> {
  return db.video.findUnique({ where: { id: videoId }, select: VIDEO_FACTS });
}

/**
 * What one clinic may use right now: open or not, the categories on its
 * plan, and whether it is shown placeholders. Null for an unknown clinic.
 * One query; the pages then apply the rule to whatever they list.
 */
export async function getClinicAccess(clinicId: string): Promise<ClinicAccess | null> {
  return readClinicAccess(prisma, clinicId);
}

/**
 * May this clinic use this video? Reads the clinic and the video and asks
 * the rule. An unknown clinic can use nothing, and answers as closed.
 */
export async function canUseVideo(clinicId: string, videoId: string): Promise<AccessDecision> {
  const access = await readClinicAccess(prisma, clinicId);
  if (!access) return { allowed: false, reason: "clinic-closed" };
  const video = await readVideoFacts(prisma, videoId);
  return decideVideoAccess(access, video);
}
