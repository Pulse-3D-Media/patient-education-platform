import type { Category } from "@prisma/client";
import type { ClinicAccess, PublishedCounts } from "../access";
import { CATEGORIES } from "../categories";
import { prisma } from "./client";

/**
 * Queries for the Video table.
 *
 * Videos belong to Pulse 3D, not to a clinic, so these functions do not take a
 * clinicId (rule 1 only requires it for clinic-owned data such as shares).
 *
 * Everything here returns published videos only. Unpublished ones are Van's
 * staging area and must never reach a surgeon's screen.
 */

/**
 * Whether placeholder videos are wanted. A clinic whose showPlaceholders is
 * off (set by Pulse staff) sees only finished animations.
 */
export type VideoFilter = { includePlaceholders: boolean };

const ANY_VIDEO: VideoFilter = { includePlaceholders: true };

/** The extra where-clause that leaves placeholders out when they are not wanted. */
function placeholderClause(filter: VideoFilter) {
  return filter.includePlaceholders ? {} : { isPlaceholder: false };
}

/** The published videos in one category, newest first. */
export async function listPublishedVideosByCategory(category: Category, filter: VideoFilter = ANY_VIDEO) {
  return prisma.video.findMany({
    where: { category, isPublished: true, ...placeholderClause(filter) },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * How many published videos each category has. Used by the library home so a
 * surgeon can see which categories have something in them before tapping.
 * Categories with nothing published are simply missing from the result.
 */
export async function countPublishedVideosByCategory(filter: VideoFilter = ANY_VIDEO) {
  const rows = await prisma.video.groupBy({
    by: ["category"],
    where: { isPublished: true, ...placeholderClause(filter) },
    _count: { _all: true },
  });

  const counts: Partial<Record<Category, number>> = {};
  for (const row of rows) {
    counts[row.category] = row._count._all;
  }
  return counts;
}

/**
 * How many published videos each category holds, split into finished
 * animations and placeholders. One query. The library needs both numbers
 * to tell "nothing is published here" (Coming soon) from "everything here
 * is a placeholder this clinic is not shown" (an honest empty state); the
 * rule that reads them is categoryState() in lib/access.ts. A category
 * with nothing published is missing from the result. Pass a category to
 * count just that one.
 */
export async function countPublishedVideosByKind(category?: Category): Promise<Partial<Record<Category, PublishedCounts>>> {
  const rows = await prisma.video.groupBy({
    by: ["category", "isPlaceholder"],
    where: { isPublished: true, ...(category ? { category } : {}) },
    _count: { _all: true },
  });

  const counts: Partial<Record<Category, PublishedCounts>> = {};
  for (const row of rows) {
    const entry = counts[row.category] ?? (counts[row.category] = { real: 0, placeholder: 0 });
    if (row.isPlaceholder) entry.placeholder += row._count._all;
    else entry.real += row._count._all;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// What one clinic may use. The same rule createShare() applies when a link
// is made (lib/access.ts), applied here in the query itself: published, in
// a category on the clinic's plan, and a placeholder only while the clinic
// is shown placeholders. Filtering in the database, not after, is what
// keeps an off-plan video's address from ever leaving the server.
// ---------------------------------------------------------------------------

/** The where-clause for "this clinic may use it". Callers have already checked the clinic is open and has categories. */
function usableClause(access: ClinicAccess) {
  return {
    isPublished: true,
    category: { in: access.categories },
    ...placeholderClause({ includePlaceholders: access.showPlaceholders }),
  };
}

/**
 * The videos in one category that this clinic may use, newest first, for
 * the category page. Empty, without a query, when the clinic is not open
 * or the category is not on its plan.
 */
export async function listUsableVideosInCategory(access: ClinicAccess, category: Category) {
  if (!access.open || !access.categories.includes(category)) return [];
  return prisma.video.findMany({
    where: { ...usableClause(access), category },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Every video this clinic may use, across the categories on its plan, for
 * the procedure picker on /admin/links. Sorted by category in the order
 * lib/categories lists them, then by title. Empty, without a query, when
 * the clinic is not open or has no categories yet.
 */
export async function listUsableVideos(access: ClinicAccess) {
  if (!access.open || access.categories.length === 0) return [];
  const videos = await prisma.video.findMany({
    where: usableClause(access),
    orderBy: { title: "asc" },
  });
  return sortByLibraryOrder(videos);
}

/**
 * What a player needs to know about one video to be handed a source
 * (lib/playback-auth.ts): where its file lives, how long it runs, and
 * whether it is published. No clinic here: whether a clinic may play it is
 * decided first, with canUseVideo(), and nothing is read for a video it
 * may not. Null for an unknown id.
 */
export async function getVideoForPlayback(videoId: string) {
  return prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, videoUrl: true, muxPlaybackId: true, durationSeconds: true, isPublished: true },
  });
}

/**
 * Every published video across all categories, whichever clinic is asking.
 * Sorted by category in the order lib/categories lists them (the same order
 * as the library tiles and the drawer), then by title. The clinic-side
 * pages use listUsableVideos() instead, which also applies the clinic's
 * plan; this is the whole published catalogue.
 */
export async function listPublishedVideos() {
  const videos = await prisma.video.findMany({
    where: { isPublished: true },
    orderBy: { title: "asc" },
  });
  return sortByLibraryOrder(videos);
}

/**
 * Sort videos by category in the on-screen order, keeping the order they
 * arrived in within a category (the sort is stable). Done here rather than
 * in the database because Postgres keeps enum values in the order they
 * were added, so Complex Spine would land after Foot & Ankle instead of
 * next to Orthopedic Spine.
 */
function sortByLibraryOrder<T extends { category: Category }>(videos: T[]): T[] {
  const position = new Map(CATEGORIES.map((c, index) => [c.value, index]));
  return videos.sort((a, b) => (position.get(a.category) ?? 99) - (position.get(b.category) ?? 99));
}

// ---------------------------------------------------------------------------
// The catalogue, as Pulse staff edit it on /pulse/videos. Staff only: every
// caller has already passed requirePulseStaff() in lib/pulse.ts. These see
// unpublished videos too, which nothing on the clinic side ever does.
// ---------------------------------------------------------------------------

/** How the Videos table on /pulse can be narrowed. */
export type PulseVideoFilter = {
  category?: Category;
  /** Published or not, placeholder or finished. Leave out for every video. */
  status?: "published" | "unpublished" | "placeholder" | "real";
};

/** The where-clause for one status choice. */
function statusClause(status: PulseVideoFilter["status"]) {
  switch (status) {
    case "published":
      return { isPublished: true };
    case "unpublished":
      return { isPublished: false };
    case "placeholder":
      return { isPlaceholder: true };
    case "real":
      return { isPlaceholder: false };
    default:
      return {};
  }
}

/**
 * Every video, published or not, for the Videos table on /pulse, each with
 * the number of share links pointing at it. Sorted the way the library
 * shows categories, then by title (see listPublishedVideos for why the sort
 * happens here and not in the database).
 */
export async function listVideosForPulse(filter: PulseVideoFilter = {}) {
  const videos = await prisma.video.findMany({
    where: { ...(filter.category ? { category: filter.category } : {}), ...statusClause(filter.status) },
    include: { _count: { select: { shares: true } } },
    orderBy: { title: "asc" },
  });
  return sortByLibraryOrder(videos);
}

/** One video with every field, plus how many share links point at it, or null for an unknown id. */
export async function getVideoForPulse(id: string) {
  return prisma.video.findUnique({
    where: { id },
    include: { _count: { select: { shares: true } } },
  });
}

/** Everything a staff member can set about a video. Callers check the values first (see saveVideoAction). */
export type VideoInput = {
  title: string;
  category: Category;
  /** The MP4 on the CDN, or null for a video that lives in Mux only (uploaded from the app, or about to be). */
  videoUrl: string | null;
  durationSeconds: number | null;
  posterUrl: string | null;
  isPlaceholder: boolean;
  isPublished: boolean;
  notes: string | null;
  /** The signed Mux playback id once the video has moved to Mux, checked with Mux before it gets here (see saveVideoAction). Null plays the file at videoUrl. */
  muxPlaybackId: string | null;
  /** The Mux asset the id belongs to, as a note for staff. */
  muxAssetId: string | null;
};

/** Add a video to the catalogue. Returns the new row. */
export async function createVideo(input: VideoInput) {
  return prisma.video.create({ data: input });
}

/**
 * Change a video in place. The row keeps its id, so every share link and QR
 * code already pointing at it keeps working and simply plays whatever the
 * row now says. Swapping a placeholder for the finished animation is this
 * function with the new address and isPlaceholder false. Throws if the id
 * is unknown.
 */
export async function updateVideo(id: string, input: VideoInput) {
  return prisma.video.update({ where: { id }, data: input });
}

// ---------------------------------------------------------------------------
// An upload to Mux in flight for a video (lib/mux-uploads.ts is the flow;
// lib/mux-upload.ts explains the two columns). The one rule of every write
// below: it names the upload it is about, so a write for an upload the row
// has since stopped waiting for changes nothing. `updateMany` with the
// upload id in its WHERE is how that is said; it answers how many rows it
// changed, which is one or none. Staff only, through the flow.
// ---------------------------------------------------------------------------

/** What the flow needs to know about a video's upload, or null for an unknown id. */
export async function getVideoUpload(videoId: string) {
  return prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, muxUploadId: true, muxUploadState: true, muxPlaybackId: true, videoUrl: true },
  });
}

/** The video waiting for this upload, or null when no row is (the upload was replaced, or was never this app's). */
export async function findVideoIdByUploadId(uploadId: string): Promise<string | null> {
  const row = await prisma.video.findUnique({ where: { muxUploadId: uploadId }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * The row now waits for this upload, at "waiting". Answers what it was
 * waiting for before, so the flow can cancel a replaced upload at Mux. One
 * transaction, so two staff members starting an upload at once each learn
 * the other's id and the row ends waiting for exactly one.
 */
export async function markUploadStarted(videoId: string, uploadId: string): Promise<{ muxUploadId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.video.findUniqueOrThrow({ where: { id: videoId }, select: { muxUploadId: true } });
    await tx.video.update({ where: { id: videoId }, data: { muxUploadId: uploadId, muxUploadState: "waiting" } });
    return before;
  });
}

/** Record where the upload stands, if the row still waits for it. */
export async function setUploadState(videoId: string, uploadId: string, state: "waiting" | "preparing"): Promise<boolean> {
  const result = await prisma.video.updateMany({ where: { id: videoId, muxUploadId: uploadId }, data: { muxUploadState: state } });
  return result.count === 1;
}

/**
 * The upload is over without a new file: cancelled (nothing to report) or
 * failed (the word stays on the row until it is dismissed). The playback
 * columns are not touched: the video is exactly as it was.
 */
export async function clearUpload(videoId: string, uploadId: string, state: "failed" | null): Promise<boolean> {
  const result = await prisma.video.updateMany({ where: { id: videoId, muxUploadId: uploadId }, data: { muxUploadId: null, muxUploadState: state } });
  return result.count === 1;
}

/**
 * The new file is ready: put its signed playback id and asset id on the
 * row, and the upload is over. The one write that changes what plays, and
 * only if the row still waits for this upload. The video's length is filled
 * in from the asset when the row has none; a length a staff member typed is
 * kept. Answers false when nothing was written (a newer upload replaced
 * this one).
 */
export async function applyReadyUpload(videoId: string, uploadId: string, asset: { playbackId: string; assetId: string; durationSeconds: number | null }): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.video.findUnique({ where: { id: videoId, muxUploadId: uploadId }, select: { durationSeconds: true } });
    if (!row) return false;
    const result = await tx.video.updateMany({
      where: { id: videoId, muxUploadId: uploadId },
      data: {
        muxPlaybackId: asset.playbackId,
        muxAssetId: asset.assetId,
        muxUploadId: null,
        muxUploadState: null,
        ...(row.durationSeconds === null && asset.durationSeconds !== null ? { durationSeconds: asset.durationSeconds } : {}),
      },
    });
    return result.count === 1;
  });
}

/** Take the "failed" word off a row. Nothing else is touched, and a row waiting for an upload is left alone. */
export async function dismissUploadFailure(videoId: string): Promise<void> {
  await prisma.video.updateMany({ where: { id: videoId, muxUploadState: "failed", muxUploadId: null }, data: { muxUploadState: null } });
}
