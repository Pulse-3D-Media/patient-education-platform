import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { shownBoxesFor, readShownVideoValues } from "../video-form-guard";
import { prisma } from "./client";
import { VideoSaveRefusedError, countWorkingLinksForVideo, updateVideoKeepingOthers, type VideoInput } from "./videos";

/**
 * Two guard rails on /pulse/videos, against the real test database:
 *   - countWorkingLinksForVideo(), the number the yes before an unpublish
 *     shows: links to THIS video that work right now, nothing else;
 *   - updateVideoKeepingOthers(), the save that keeps a colleague's change a
 *     stale page did not see (lib/video-form-guard.ts), while a deliberate
 *     change still wins. The forced overlap is lib/db/videos.race.test.ts.
 */

const DAY = 86_400_000;
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const tag = () => randomBytes(4).toString("hex");

async function makeVideo(data: Partial<{ isPublished: boolean; isPlaceholder: boolean; videoUrl: string | null }> = {}) {
  const video = await prisma.video.create({
    data: { title: `Vitest guard ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, ...data },
  });
  createdVideoIds.push(video.id);
  return video;
}

async function makeClinic() {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest guard clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeLink(clinicId: string, videoId: string, expiresAt: Date, extra: Record<string, unknown> = {}) {
  await prisma.share.create({ data: { code: `vg${randomBytes(8).toString("hex")}`, clinicId, videoId, expiresAt, ...extra } });
}

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("countWorkingLinksForVideo", () => {
  it("counts this video's links that still work, and not another video's, an expired one, or a paused one", async () => {
    const clinic = await makeClinic();
    const otherClinic = await makeClinic();
    const video = await makeVideo();
    const other = await makeVideo();
    const now = Date.now();
    // Working: an unplayed first-play link, a played one with time left, and one at another clinic.
    await makeLink(clinic, video.id, new Date(now + 90 * DAY), { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7 });
    await makeLink(clinic, video.id, new Date(now + 3 * DAY), { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7, firstPlayedAt: new Date(now - 4 * DAY), viewCount: 2 });
    await makeLink(otherClinic, video.id, new Date(now + DAY));
    // Not working: expired, and paused (played, ran out, waiting for its clinic: its deadline has passed).
    await makeLink(clinic, video.id, new Date(now - DAY));
    await makeLink(clinic, video.id, new Date(now - 60_000), { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7, firstPlayedAt: new Date(now - 8 * DAY), renewalRequestedAt: new Date(now - 30_000) });
    // Another video's working links are not this one's.
    await makeLink(clinic, other.id, new Date(now + 90 * DAY));
    await makeLink(clinic, other.id, new Date(now + 90 * DAY));

    expect(await countWorkingLinksForVideo(video.id)).toBe(3);
    expect(await countWorkingLinksForVideo(other.id)).toBe(2);
  });

  it("is 0 for a video that is not published (none of its links works) and for one with no links", async () => {
    const clinic = await makeClinic();
    const hidden = await makeVideo({ isPublished: false });
    await makeLink(clinic, hidden.id, new Date(Date.now() + 90 * DAY));
    expect(await countWorkingLinksForVideo(hidden.id)).toBe(0);
    expect(await countWorkingLinksForVideo((await makeVideo()).id)).toBe(0);
  });
});

describe("updateVideoKeepingOthers", () => {
  /** The form a page drawn from `row` would send, with `changes` typed on top of what it showed. */
  function sendFrom(row: Awaited<ReturnType<typeof makeVideo>>, changes: Partial<VideoInput> = {}) {
    const input: VideoInput = {
      title: row.title,
      category: row.category,
      videoUrl: row.videoUrl,
      durationSeconds: row.durationSeconds,
      posterUrl: row.posterUrl,
      isPlaceholder: row.isPlaceholder,
      isPublished: row.isPublished,
      notes: row.notes,
      muxPlaybackId: row.muxPlaybackId,
      muxAssetId: row.muxAssetId,
      ...changes,
    };
    const boxes = new FormData();
    for (const [name, value] of Object.entries(shownBoxesFor(row))) boxes.append(name, value);
    return [input, readShownVideoValues(boxes)] as const;
  }

  it("a stale page saving only its notes does not undo a colleague's unpublish, publish, placeholder change, title, category or poster", async () => {
    const video = await makeVideo({ isPlaceholder: true });
    const [input, shown] = sendFrom(video, { notes: "Typed on the stale page" });
    // The colleague's save lands after the page was drawn.
    await prisma.video.update({
      where: { id: video.id },
      data: { isPublished: false, isPlaceholder: false, title: `${video.title} renamed`, category: "HIP", posterUrl: "https://image.mux.com/x/thumbnail.jpg" },
    });

    const saved = await updateVideoKeepingOthers(video.id, input, shown);
    expect(saved).toMatchObject({ before: { isPublished: false }, after: { isPublished: false } });
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({
      isPublished: false,
      isPlaceholder: false,
      title: `${video.title} renamed`,
      category: "HIP",
      posterUrl: "https://image.mux.com/x/thumbnail.jpg",
      notes: "Typed on the stale page",
    });

    // And the other way round: a colleague publishes, a stale page that showed it unpublished saves a title.
    const [again, shownAgain] = sendFrom(await prisma.video.findUniqueOrThrow({ where: { id: video.id } }), { title: "Typed title" });
    await prisma.video.update({ where: { id: video.id }, data: { isPublished: true } });
    await updateVideoKeepingOthers(video.id, again, shownAgain);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ isPublished: true, title: "Typed title" });
  });

  it.each([
    ["Published unticked", { isPublished: false }],
    ["Placeholder unticked", { isPlaceholder: false }],
    ["a typed title", { title: "Deliberate title" }],
    ["another category", { category: "SHOULDER" }],
    ["a cleared poster", { posterUrl: null }],
    ["cleared notes", { notes: null }],
  ] as const)("a deliberate change on a stale page still wins: %s", async (_name, change) => {
    const video = await makeVideo({ isPlaceholder: true });
    await prisma.video.update({ where: { id: video.id }, data: { posterUrl: "https://image.mux.com/p/thumbnail.jpg", notes: "Note" } });
    const drawn = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    const [input, shown] = sendFrom(drawn, change);
    // A colleague changes the notes meanwhile (except where this test clears them on purpose).
    if (!("notes" in change)) await prisma.video.update({ where: { id: video.id }, data: { notes: "Colleague's note" } });

    const saved = await updateVideoKeepingOthers(video.id, input, shown);
    const row = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    for (const [field, value] of Object.entries(change)) expect(row[field as keyof typeof row]).toEqual(value);
    if (!("notes" in change)) expect(row.notes).toBe("Colleague's note");
    expect(saved?.before.isPublished).toBe(true);
    expect(saved?.after.isPublished).toBe(row.isPublished);
  });

  it("refuses, writing nothing, when a colleague published the video while this page cleared its only file", async () => {
    const video = await makeVideo({ isPublished: false });
    const [input, shown] = sendFrom(video, { videoUrl: null, notes: "cleared the file" });
    await prisma.video.update({ where: { id: video.id }, data: { isPublished: true } });
    await expect(updateVideoKeepingOthers(video.id, input, shown)).rejects.toBeInstanceOf(VideoSaveRefusedError);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ isPublished: true, videoUrl: video.videoUrl, notes: null });
  });

  it("answers null for a video that does not exist, writing nothing", async () => {
    const video = await makeVideo();
    const [input, shown] = sendFrom(video);
    expect(await updateVideoKeepingOthers("clnotavideo000000000000", input, shown)).toBeNull();
  });
});
