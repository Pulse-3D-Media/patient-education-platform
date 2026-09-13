import type { Category, ClinicStatus, Prisma, PrismaClient } from "@prisma/client";
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
 * createShare() in lib/db/shares.ts uses the two `lock` helpers below
 * inside its own transaction. They read the same facts but hold the rows
 * against change until the transaction ends, so the check and the write
 * are one moment: a form rendered when a video was on the plan cannot
 * create a link after the plan changed, and a plan change cannot slip in
 * between the check and the write either.
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

// ---------------------------------------------------------------------------
// The same two reads, taken with a share lock, for the transaction that
// creates a share link. Postgres's "FOR SHARE" means: this transaction may
// read the row, other transactions may read it too, but nothing may CHANGE
// it until this transaction ends. So a plan change, a pause, a
// placeholder-setting change or an unpublish that arrives while a link is
// being made either waits until the link is committed (and then applies,
// leaving the issued link usable, as issued links always are), or has
// already committed, in which case the read here sees it and the link is
// refused. There is no moment in between. Two links being made at once for
// the same clinic do not block each other: share locks are compatible with
// each other, only with a change.
//
// Prisma's own query builder cannot ask for a row lock, so these two are
// written as SQL. The values are bound as parameters, never pasted into
// the text. The enum columns are read as text and turned back into the
// app's types the same way accessFromClinic() does for an ordinary read.
// ---------------------------------------------------------------------------

/** What the locking clinic read returns: the same four fields, enum values as text. */
type LockedClinicRow = { id: string; status: string; categories: string[]; showPlaceholders: boolean };

/** What the locking video read returns. */
type LockedVideoRow = { category: string; isPublished: boolean; isPlaceholder: boolean };

/** Read one clinic's access facts and hold the row against change until the transaction ends. Null for an unknown clinic. */
export async function lockClinicAccess(tx: Prisma.TransactionClient, clinicId: string): Promise<ClinicAccess | null> {
  const rows = await tx.$queryRaw<LockedClinicRow[]>`
    SELECT "id", "status"::text AS "status", "categories"::text[] AS "categories", "showPlaceholders"
    FROM "Clinic"
    WHERE "id" = ${clinicId}
    FOR SHARE`;
  const row = rows[0];
  if (!row) return null;
  return accessFromClinic({
    id: row.id,
    status: row.status as ClinicStatus,
    categories: row.categories as Category[],
    showPlaceholders: row.showPlaceholders,
  });
}

/** Read the three facts about one video and hold the row against change until the transaction ends. Null when no video has that id. */
export async function lockVideoFacts(tx: Prisma.TransactionClient, videoId: string): Promise<VideoFacts | null> {
  const rows = await tx.$queryRaw<LockedVideoRow[]>`
    SELECT "category"::text AS "category", "isPublished", "isPlaceholder"
    FROM "Video"
    WHERE "id" = ${videoId}
    FOR SHARE`;
  const row = rows[0];
  if (!row) return null;
  return { category: row.category as Category, isPublished: row.isPublished, isPlaceholder: row.isPlaceholder };
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
