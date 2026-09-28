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

/** The five fields the access rule reads about a clinic. */
const ACCESS_FIELDS = { id: true, status: true, graceEndsAt: true, categories: true, showPlaceholders: true } as const;

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
type LockedClinicRow = { id: string; status: string; graceEndsAt: Date | null; categories: string[]; showPlaceholders: boolean };

/** What the locking video read returns. */
type LockedVideoRow = { category: string; isPublished: boolean; isPlaceholder: boolean };

/** Read one clinic's access facts and hold the row against change until the transaction ends. Null for an unknown clinic. */
export async function lockClinicAccess(tx: Prisma.TransactionClient, clinicId: string, now: Date = new Date()): Promise<ClinicAccess | null> {
  const rows = await tx.$queryRaw<LockedClinicRow[]>`
    SELECT "id", "status"::text AS "status", "graceEndsAt", "categories"::text[] AS "categories", "showPlaceholders"
    FROM "Clinic"
    WHERE "id" = ${clinicId}
    FOR SHARE`;
  const row = rows[0];
  if (!row) return null;
  // `now` decides whether a past-due clinic is still inside its grace period.
  return accessFromClinic(
    {
      id: row.id,
      status: row.status as ClinicStatus,
      graceEndsAt: row.graceEndsAt,
      categories: row.categories as Category[],
      showPlaceholders: row.showPlaceholders,
    },
    now,
  );
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
 * The seat of the surgeon a link is from, read with a share lock, for the
 * transaction that creates the link. Null when that person holds no seat at
 * THIS clinic: the clinic id is in the WHERE, so a seat at another clinic
 * finds nothing here.
 *
 * Every write that takes or lets go a seat already waits for createShare,
 * because it locks the clinic row first (readClinicLocked, readSeatsLocked)
 * and createShare holds that row FOR SHARE. The lock here holds the seat row
 * itself as well, so the seat, and the name typed for it on /admin/people,
 * stay as read until the link is written, whatever path a change comes by.
 * In the same file as the other two locks so the overlap test can wrap it
 * (shares.sender.race.test.ts).
 */
export async function lockSenderSeat(tx: Prisma.TransactionClient, clinicId: string, clerkUserId: string): Promise<{ displayName: string | null } | null> {
  const rows = await tx.$queryRaw<{ displayName: string | null }[]>`
    SELECT "displayName"
    FROM "SeatAllocation"
    WHERE "clinicId" = ${clinicId} AND "clerkUserId" = ${clerkUserId}
    FOR SHARE`;
  return rows[0] ?? null;
}

/** What the locking share read returns: the facts the reactivation rule reads, plus what the log entry and the email say. */
export type LockedShareRow = {
  id: string;
  code: string;
  expiryPolicy: "FIXED" | "FIRST_PLAY";
  expiresAt: Date;
  firstPlayedAt: Date | null;
  daysAfterFirstPlay: number | null;
  renewalsUsed: number;
  renewalRequestedAt: Date | null;
  videoTitle: string;
  videoIsPublished: boolean;
};

/**
 * One of this clinic's share links, read for a reactivation with the row
 * held against every other change until the transaction ends. Null when no
 * link of THIS clinic has that code: the clinic id is in the WHERE, so
 * another clinic's link finds nothing, and so does a code nobody has.
 *
 * "FOR NO KEY UPDATE" is the lock an ordinary UPDATE takes, on the Share
 * row only (the video row is joined for its title and published flag, but
 * not locked: an unpublish that lands a moment later stops the link like
 * any other, as issued links always follow the video). A second
 * reactivation of the same link, from another admin or a double click,
 * waits here until the first has committed, then reads the link already
 * turned back on and does nothing. In this file with the other locking
 * reads so the overlap test can wrap it (shares.renewal.race.test.ts).
 */
export async function lockShareForRenewal(tx: Prisma.TransactionClient, clinicId: string, code: string): Promise<LockedShareRow | null> {
  const rows = await tx.$queryRaw<LockedShareRow[]>`
    SELECT s."id", s."code", s."expiryPolicy"::text AS "expiryPolicy", s."expiresAt", s."firstPlayedAt", s."daysAfterFirstPlay",
           s."renewalsUsed", s."renewalRequestedAt", v."title" AS "videoTitle", v."isPublished" AS "videoIsPublished"
    FROM "Share" s
    JOIN "Video" v ON v."id" = s."videoId"
    WHERE s."code" = ${code} AND s."clinicId" = ${clinicId}
    FOR NO KEY UPDATE OF s`;
  return rows[0] ?? null;
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
