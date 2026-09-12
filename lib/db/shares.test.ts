import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { createShare, listRecentSharesForClinic, summarizeSharesForClinic } from "./shares";

/**
 * The two reads the admin overview makes: a handful of totals and the
 * newest few links, both for one clinic only. Against the real test
 * database; every row is made here and deleted by id afterwards.
 */

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const createdShareIds: string[] = [];

let clinicA = "";
let clinicB = "";
let publishedVideo = "";
let unpublishedVideo = "";

async function makeClinic(name: string) {
  const clinic = await prisma.clinic.create({ data: { name: `${name} ${randomBytes(4).toString("hex")}` }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeVideo(isPublished: boolean) {
  const video = await prisma.video.create({
    data: { title: "Vitest overview video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

/** A link with a chosen expiry and view count, the way real ones end up after use. */
async function makeShare(clinicId: string, videoId: string, expiresInDays: number, viewCount = 0) {
  const share = await createShare(clinicId, videoId, 90);
  createdShareIds.push(share.id);
  await prisma.share.update({
    where: { id: share.id },
    data: { expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000), viewCount },
  });
  return share;
}

beforeAll(async () => {
  clinicA = await makeClinic("Vitest overview clinic A");
  clinicB = await makeClinic("Vitest overview clinic B");
  publishedVideo = await makeVideo(true);
  unpublishedVideo = await makeVideo(true);

  // Clinic A: two working links (one expiring in 3 days), one expired, and
  // one whose video is unpublished below. Clinic B: one working link.
  await makeShare(clinicA, publishedVideo, 60, 4);
  await makeShare(clinicA, publishedVideo, 3, 1);
  await makeShare(clinicA, publishedVideo, -2, 7);
  await makeShare(clinicA, unpublishedVideo, 30, 2);
  await makeShare(clinicB, publishedVideo, 60, 9);

  // Unpublish after the links exist (createShare refuses an unpublished video).
  await prisma.video.update({ where: { id: unpublishedVideo }, data: { isPublished: false } });
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { id: { in: createdShareIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("summarizeSharesForClinic", () => {
  it("counts only the clinic's own links, by what they are doing right now", async () => {
    const summary = await summarizeSharesForClinic(clinicA);
    expect(summary).toEqual({
      working: 2,
      expiringSoon: 1,
      notWorking: 1,
      madeRecently: 4,
      playStarts: 14,
    });
  });

  it("gives another clinic its own numbers, and an empty clinic zeros", async () => {
    expect(await summarizeSharesForClinic(clinicB)).toEqual({ working: 1, expiringSoon: 0, notWorking: 0, madeRecently: 1, playStarts: 9 });
    const empty = await makeClinic("Vitest overview clinic empty");
    expect(await summarizeSharesForClinic(empty)).toEqual({ working: 0, expiringSoon: 0, notWorking: 0, madeRecently: 0, playStarts: 0 });
  });
});

describe("listRecentSharesForClinic", () => {
  it("returns only the clinic's own links, newest first, no more than asked for", async () => {
    const recent = await listRecentSharesForClinic(clinicA, 2);
    expect(recent).toHaveLength(2);
    expect(recent.every((share) => share.clinicId === clinicA)).toBe(true);
    expect(recent[0].createdAt.getTime()).toBeGreaterThanOrEqual(recent[1].createdAt.getTime());
    // The video fields the overview shows come with each link.
    expect(recent[0].video).toMatchObject({ title: "Vitest overview video", isPlaceholder: true });
  });

  it("never returns more than twenty, whatever limit is asked for, and at least one", async () => {
    expect((await listRecentSharesForClinic(clinicA, 1000)).length).toBeLessThanOrEqual(20);
    expect(await listRecentSharesForClinic(clinicA, 0)).toHaveLength(1);
  });
});
