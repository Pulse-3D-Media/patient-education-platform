import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { createShare, getShareByCode, recordShareView } from "./shares";
import {
  countPublishedVideosByCategory,
  createVideo,
  getVideoForPulse,
  listPublishedVideos,
  listPublishedVideosByCategory,
  listVideosForPulse,
  updateVideo,
  type VideoInput,
} from "./videos";

/**
 * The catalogue against the real test database: editing a video keeps its
 * id and the share links pointing at it, an unpublished video never reaches
 * the clinic-side lists, and the per-category count leaves out what is not
 * published. Videos and clinics made here are deleted afterwards (shares
 * first, since a share points at both).
 */

const createdVideoIds: string[] = [];
const createdClinicIds: string[] = [];

function tag() {
  return randomBytes(4).toString("hex");
}

function input(overrides: Partial<VideoInput> = {}): VideoInput {
  return {
    title: `Vitest video ${tag()}`,
    category: "KNEE",
    videoUrl: "https://cdn.prod.website-files.com/test/vitest.mp4",
    durationSeconds: 110,
    posterUrl: null,
    isPlaceholder: true,
    isPublished: true,
    notes: null,
    ...overrides,
  };
}

async function makeVideo(overrides: Partial<VideoInput> = {}) {
  const video = await createVideo(input(overrides));
  createdVideoIds.push(video.id);
  return video;
}

async function makeClinic() {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest videos clinic ${tag()}` }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

afterAll(async () => {
  await prisma.share.deleteMany({ where: { videoId: { in: createdVideoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("updateVideo", () => {
  it("keeps the same id, and the shares pointing at it, when a placeholder becomes the real animation", async () => {
    const video = await makeVideo({ isPlaceholder: true });
    const clinicId = await makeClinic();
    const share = await createShare(clinicId, video.id, 90);

    const updated = await updateVideo(video.id, {
      ...input(),
      title: video.title,
      videoUrl: "https://cdn.prod.website-files.com/test/finished.mp4",
      isPlaceholder: false,
      posterUrl: "https://cdn.prod.website-files.com/test/poster.jpg",
      notes: "Swapped in the finished file.",
    });

    expect(updated.id).toBe(video.id);
    expect(updated.isPlaceholder).toBe(false);
    expect(updated.videoUrl).toBe("https://cdn.prod.website-files.com/test/finished.mp4");
    expect(updated.posterUrl).toBe("https://cdn.prod.website-files.com/test/poster.jpg");

    // The share still points at the same row and now sees the new file.
    const stillThere = await prisma.share.findUnique({ where: { id: share.id }, include: { video: true } });
    expect(stillThere?.videoId).toBe(video.id);
    expect(stillThere?.video.videoUrl).toBe("https://cdn.prod.website-files.com/test/finished.mp4");

    // And the Pulse view counts that link.
    expect((await getVideoForPulse(video.id))?._count.shares).toBe(1);
  });

  it("throws for an id that does not exist", async () => {
    await expect(updateVideo("no-such-video", input())).rejects.toThrow();
  });
});

describe("published-only lists", () => {
  it("leave an unpublished video out, and include it once published", async () => {
    const hidden = await makeVideo({ isPublished: false, category: "HIP" });

    const ids = (videos: { id: string }[]) => videos.map((v) => v.id);
    expect(ids(await listPublishedVideos())).not.toContain(hidden.id);
    expect(ids(await listPublishedVideosByCategory("HIP"))).not.toContain(hidden.id);

    // The Pulse table sees everything.
    expect(ids(await listVideosForPulse())).toContain(hidden.id);
    expect(ids(await listVideosForPulse({ status: "unpublished" }))).toContain(hidden.id);
    expect(ids(await listVideosForPulse({ status: "published" }))).not.toContain(hidden.id);

    await updateVideo(hidden.id, { ...input({ category: "HIP" }), title: hidden.title, isPublished: true });
    expect(ids(await listPublishedVideos())).toContain(hidden.id);
    expect(ids(await listPublishedVideosByCategory("HIP"))).toContain(hidden.id);
  });

  it("an unpublished video does not count towards its category, so a category with nothing published reports as empty", async () => {
    const before = (await countPublishedVideosByCategory())["FOOT_ANKLE"] ?? 0;

    const hidden = await makeVideo({ isPublished: false, category: "FOOT_ANKLE" });
    expect((await countPublishedVideosByCategory())["FOOT_ANKLE"] ?? 0).toBe(before);

    await updateVideo(hidden.id, { ...input({ category: "FOOT_ANKLE" }), title: hidden.title, isPublished: true });
    expect((await countPublishedVideosByCategory())["FOOT_ANKLE"] ?? 0).toBe(before + 1);

    // A category is reported only when something is published in it: the
    // count is a partial record, and a missing key is what the library reads
    // as "Coming soon". Proven here on the count itself, since the shared
    // test database may already hold published videos in every category.
    const counts = await countPublishedVideosByCategory();
    for (const [category, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThan(0);
      expect(await prisma.video.count({ where: { category: category as never, isPublished: true } })).toBe(count);
    }
  });

  it("a clinic shown no placeholders sees a placeholder-only category as empty", async () => {
    // A category holding only this placeholder (as far as this test can see):
    // with placeholders excluded, the placeholder itself never appears.
    const sample = await makeVideo({ isPlaceholder: true, category: "SHOULDER" });
    const ids = (videos: { id: string }[]) => videos.map((v) => v.id);
    expect(ids(await listPublishedVideosByCategory("SHOULDER", { includePlaceholders: true }))).toContain(sample.id);
    expect(ids(await listPublishedVideosByCategory("SHOULDER", { includePlaceholders: false }))).not.toContain(sample.id);
  });
});

describe("unpublishing a video", () => {
  it("stops the links already sent: the share reports the video unpublished and a view is not counted", async () => {
    const video = await makeVideo({ isPublished: true, category: "HIP" });
    const clinicId = await makeClinic();
    const share = await createShare(clinicId, video.id, 90);

    // Published: the patient page plays it and a view counts.
    await recordShareView(share.code);
    expect((await getShareByCode(share.code))?.viewCount).toBe(1);

    // Unpublished on /pulse/videos: the same link now reads as not available, and a view does not count.
    await updateVideo(video.id, { ...input({ category: "HIP" }), title: video.title, isPublished: false });
    const takenDown = await getShareByCode(share.code);
    expect(takenDown?.video.isPublished).toBe(false);
    await recordShareView(share.code);
    expect((await getShareByCode(share.code))?.viewCount).toBe(1);

    // Published again: the old link works again.
    await updateVideo(video.id, { ...input({ category: "HIP" }), title: video.title, isPublished: true });
    await recordShareView(share.code);
    expect((await getShareByCode(share.code))?.viewCount).toBe(2);
  });
});
