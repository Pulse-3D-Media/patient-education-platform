import { randomUUID } from "node:crypto";
import type { Video } from "@prisma/client";
import { decideVideoAccess, type AccessReason, type ClinicAccess } from "../access";
import { FAVORITES_LIMIT, MOST_WATCHED_LIMIT } from "../library-rows";
import { readClinicAccess, readVideoFacts } from "./access";
import { prisma } from "./client";
import { usableClause } from "./videos";

/**
 * One staff member's own favorites and library plays (the PersonalVideo
 * table). Read lib/library-rows.ts first for what the home page does with
 * them.
 *
 * Every function takes the clinic id first (rule 1), and the person's Clerk
 * user id second. Both come from the server's own look at who is signed in
 * (getCurrentClinicId() and Clerk's auth()), never from the browser, so a
 * person can only ever heart or count a play for themselves, at their own
 * clinic.
 *
 * WRITES ARE SAFE TO REPEAT. A heart says what it wants ("a favorite" or
 * "not a favorite"), never "flip it", and each write is ONE statement:
 * INSERT ... ON CONFLICT DO UPDATE on the unique (clinic, person, video).
 * Postgres decides between the insert and the update itself, so two taps at
 * the same moment, a tap sent twice by a flaky connection, or two open
 * tabs always end in one row, and a play counted at the same moment as
 * another is counted twice, never lost. Prisma's own upsert cannot say
 * "keep the first time it was hearted", so these two are written as SQL,
 * with every value bound as a parameter.
 *
 * WRITES CHECK ACCESS FIRST. A heart or a play is only recorded for a video
 * the clinic may use right now (decideVideoAccess, the same rule as
 * everywhere): a made-up id, an unpublished video, one off the plan, or a
 * hidden placeholder is refused and nothing is written. The check and the
 * write are not one locked moment, on purpose: a heart that lands a moment
 * after its category left the plan harms nothing, because the reads below
 * leave it out until the category returns.
 *
 * READS APPLY THE ACCESS RULE IN THE QUERY (usableClause, through the
 * relation to Video), so a favorite whose category left the plan is not
 * shown and nothing playable about it leaves the server. Its row is kept:
 * it is back the moment the category is. Both reads are bounded.
 */

/** The answer to a heart or a play: recorded, or why not. */
export type PersonalWrite = { ok: true } | { ok: false; reason: AccessReason };

/** May this clinic use this video right now? The same rule as everywhere, from two plain reads. */
async function checkUsable(clinicId: string, videoId: string): Promise<PersonalWrite> {
  const access = await readClinicAccess(prisma, clinicId);
  if (!access) return { ok: false, reason: "clinic-closed" };
  const decision = decideVideoAccess(access, await readVideoFacts(prisma, videoId));
  return decision.allowed ? { ok: true } : { ok: false, reason: decision.reason };
}

/**
 * Make a video one of this person's favorites, or not. Saying the same thing
 * twice changes nothing: hearting a video that is already a favorite keeps
 * the moment it was first hearted, and un-hearting one that is not a
 * favorite (or has no row) writes nothing.
 */
export async function setFavorite(clinicId: string, clerkUserId: string, videoId: string, favorite: boolean, now: Date = new Date()): Promise<PersonalWrite> {
  if (!favorite) {
    // Nothing to check: taking a heart away is allowed even after the video left the plan (it is not shown then anyway).
    await prisma.$executeRaw`
      UPDATE "PersonalVideo"
      SET "favoritedAt" = NULL, "updatedAt" = ${now}
      WHERE "clinicId" = ${clinicId} AND "clerkUserId" = ${clerkUserId} AND "videoId" = ${videoId} AND "favoritedAt" IS NOT NULL`;
    return { ok: true };
  }

  const usable = await checkUsable(clinicId, videoId);
  if (!usable.ok) return usable;

  // COALESCE keeps the first moment it was hearted when it already is a favorite; after an un-heart it is empty, so
  // hearting again sets a new moment and the video comes back to the front of "My favorites".
  await prisma.$executeRaw`
    INSERT INTO "PersonalVideo" ("id", "clinicId", "clerkUserId", "videoId", "favoritedAt", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${clinicId}, ${clerkUserId}, ${videoId}, ${now}, ${now}, ${now})
    ON CONFLICT ("clinicId", "clerkUserId", "videoId") DO UPDATE
    SET "favoritedAt" = COALESCE("PersonalVideo"."favoritedAt", EXCLUDED."favoritedAt"), "updatedAt" = EXCLUDED."updatedAt"`;
  return { ok: true };
}

/**
 * Count one library play for this person: the player was opened and the
 * video actually started playing (the library player calls this once per
 * time it is opened). Adds one in the database itself, so two plays at the
 * same moment are both counted.
 */
export async function recordLibraryPlay(clinicId: string, clerkUserId: string, videoId: string, now: Date = new Date()): Promise<PersonalWrite> {
  const usable = await checkUsable(clinicId, videoId);
  if (!usable.ok) return usable;

  await prisma.$executeRaw`
    INSERT INTO "PersonalVideo" ("id", "clinicId", "clerkUserId", "videoId", "playCount", "lastPlayedAt", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${clinicId}, ${clerkUserId}, ${videoId}, 1, ${now}, ${now}, ${now})
    ON CONFLICT ("clinicId", "clerkUserId", "videoId") DO UPDATE
    SET "playCount" = "PersonalVideo"."playCount" + 1,
        "lastPlayedAt" = GREATEST("PersonalVideo"."lastPlayedAt", EXCLUDED."lastPlayedAt"),
        "updatedAt" = EXCLUDED."updatedAt"`;
  return { ok: true };
}

/** The access passed in must be this clinic's: a mix-up between the two is a bug, never something to quietly answer. */
function sameClinic(clinicId: string, access: ClinicAccess) {
  if (access.clinicId !== clinicId) throw new Error("The access facts belong to a different clinic.");
}

/**
 * This person's favorites that the clinic may use right now, the most
 * recently hearted first, at most FAVORITES_LIMIT. Empty, without a query,
 * when the clinic is not open or has no categories.
 */
export async function listFavoriteVideos(clinicId: string, clerkUserId: string, access: ClinicAccess, limit: number = FAVORITES_LIMIT): Promise<Video[]> {
  sameClinic(clinicId, access);
  if (!access.open || access.categories.length === 0) return [];
  const rows = await prisma.personalVideo.findMany({
    where: { clinicId, clerkUserId, favoritedAt: { not: null }, video: usableClause(access) },
    orderBy: [{ favoritedAt: "desc" }, { videoId: "asc" }],
    take: limit,
    select: { video: true },
  });
  return rows.map((row) => row.video);
}

/**
 * This person's most-played videos that the clinic may use right now, most
 * played first (the most recently played first among equals), at most
 * MOST_WATCHED_LIMIT. Whether the row is shown at all is showMostWatched()
 * in lib/library-rows.ts.
 */
export async function listMostWatchedVideos(clinicId: string, clerkUserId: string, access: ClinicAccess, limit: number = MOST_WATCHED_LIMIT): Promise<Video[]> {
  sameClinic(clinicId, access);
  if (!access.open || access.categories.length === 0) return [];
  const rows = await prisma.personalVideo.findMany({
    where: { clinicId, clerkUserId, playCount: { gt: 0 }, video: usableClause(access) },
    orderBy: [{ playCount: "desc" }, { lastPlayedAt: "desc" }, { videoId: "asc" }],
    take: limit,
    select: { video: true },
  });
  return rows.map((row) => row.video);
}

/** Which of these videos this person has hearted, for the hearts on a page's cards. Bounded by the list handed in. */
export async function listFavoriteIdsAmong(clinicId: string, clerkUserId: string, videoIds: string[]): Promise<string[]> {
  if (videoIds.length === 0) return [];
  const rows = await prisma.personalVideo.findMany({
    where: { clinicId, clerkUserId, videoId: { in: videoIds }, favoritedAt: { not: null } },
    select: { videoId: true },
  });
  return rows.map((row) => row.videoId);
}
