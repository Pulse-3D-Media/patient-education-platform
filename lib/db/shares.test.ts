import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  createShare,
  deleteShareForClinic,
  getShareByCode,
  listRecentSharesForClinic,
  recordShareView,
  ShareRefusedError,
  summarizeSharesForClinic,
} from "./shares";

/**
 * The share table against the real test database: the two reads the admin
 * overview makes (a handful of totals and the newest few links, both for
 * one clinic only), and the one write, createShare, which refuses what the
 * clinic may not use and leaves links already issued alone when the plan
 * changes. Every row is made here and deleted by id afterwards.
 */

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const createdShareIds: string[] = [];

let clinicA = "";
let clinicB = "";
let publishedVideo = "";
let unpublishedVideo = "";

/** An open clinic with Knee on its plan, so createShare lets it share the Knee videos made below. */
async function makeClinic(name: string, data: Partial<Parameters<typeof prisma.clinic.create>[0]["data"]> = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `${name} ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], ...data },
    select: { id: true },
  });
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

  it("drops a cancelled link out of every number, play starts included, because cancelling deletes the row", async () => {
    const clinic = await makeClinic("Vitest overview clinic cancel");
    const kept = await makeShare(clinic, publishedVideo, 60, 2);
    const cancelled = await makeShare(clinic, publishedVideo, 60, 5);
    expect(await summarizeSharesForClinic(clinic)).toEqual({ working: 2, expiringSoon: 0, notWorking: 0, madeRecently: 2, playStarts: 7 });

    expect(await deleteShareForClinic(clinic, cancelled.code)).toBe(true);

    // The cancelled link's five play starts are gone with it: these are not lifetime totals.
    expect(await summarizeSharesForClinic(clinic)).toEqual({ working: 1, expiringSoon: 0, notWorking: 0, madeRecently: 1, playStarts: 2 });
    expect((await listRecentSharesForClinic(clinic, 5)).map((share) => share.id)).toEqual([kept.id]);
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

/** A published video of the given kind, owned by this test file. */
async function makeVideoOf(data: { category: "KNEE" | "HIP"; isPlaceholder: boolean; isPublished?: boolean }) {
  const video = await prisma.video.create({
    data: {
      title: `Vitest access video ${randomBytes(4).toString("hex")}`,
      category: data.category,
      videoUrl: "https://example.com/vitest.mp4",
      isPublished: data.isPublished ?? true,
      isPlaceholder: data.isPlaceholder,
    },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

/** Ask createShare and expect it to say no for this reason, writing nothing. */
async function expectRefused(clinicId: string, videoId: string, reason: string) {
  const before = await prisma.share.count({ where: { clinicId } });
  await expect(createShare(clinicId, videoId, 90)).rejects.toMatchObject({ name: "ShareRefusedError", reason });
  expect(await prisma.share.count({ where: { clinicId } })).toBe(before);
}

describe("createShare enforces what the clinic may use", () => {
  it("refuses the same video for a clinic whose plan does not include its category, and allows it for one that does", async () => {
    const kneeClinic = await makeClinic("Vitest access clinic knee", { categories: ["KNEE"] });
    const hipClinic = await makeClinic("Vitest access clinic hip", { categories: ["HIP"] });

    await expectRefused(hipClinic, publishedVideo, "not-on-plan");

    const share = await createShare(kneeClinic, publishedVideo, 90);
    createdShareIds.push(share.id);
    expect(share.clinicId).toBe(kneeClinic);
  });

  it("refuses a clinic with no plan at all", async () => {
    const noPlan = await makeClinic("Vitest access clinic no plan", { categories: [] });
    await expectRefused(noPlan, publishedVideo, "not-on-plan");
  });

  it("refuses a clinic that is paused, pending, past due or canceled, whatever its plan, and a clinic that does not exist", async () => {
    for (const status of ["PAUSED", "PENDING", "PAST_DUE", "CANCELED"] as const) {
      const clinic = await makeClinic(`Vitest access clinic ${status}`, { status });
      await expectRefused(clinic, publishedVideo, "clinic-closed");
    }
    await expect(createShare("clinic_that_does_not_exist", publishedVideo, 90)).rejects.toMatchObject({ reason: "clinic-closed" });
  });

  it("refuses an unpublished video and a video that does not exist", async () => {
    const clinic = await makeClinic("Vitest access clinic unpublished");
    const hidden = await makeVideoOf({ category: "KNEE", isPlaceholder: false, isPublished: false });
    await expectRefused(clinic, hidden, "unpublished");
    await expectRefused(clinic, "video_that_does_not_exist", "no-such-video");
  });

  it("refuses a placeholder for a clinic shown finished animations only, and allows a finished one", async () => {
    const clinic = await makeClinic("Vitest access clinic no placeholders", { showPlaceholders: false });
    const finished = await makeVideoOf({ category: "KNEE", isPlaceholder: false });

    // publishedVideo is a placeholder (see makeVideo above).
    await expectRefused(clinic, publishedVideo, "placeholder-hidden");

    const share = await createShare(clinic, finished, 90);
    createdShareIds.push(share.id);
    expect(share.videoId).toBe(finished);
  });

  it("gives a clinic managed by Pulse nothing its status and plan do not give it", async () => {
    const managedPaused = await makeClinic("Vitest access clinic managed paused", { managedByPulse: true, status: "PAUSED" });
    await expectRefused(managedPaused, publishedVideo, "clinic-closed");

    const managedNoPlan = await makeClinic("Vitest access clinic managed no plan", { managedByPulse: true, categories: [] });
    await expectRefused(managedNoPlan, publishedVideo, "not-on-plan");
  });

  it("carries a plain sentence for the person who asked", async () => {
    const hipClinic = await makeClinic("Vitest access clinic hip words", { categories: ["HIP"] });
    const error = await createShare(hipClinic, publishedVideo, 90).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShareRefusedError);
    expect((error as Error).message).toMatch(/not in a category on your clinic's plan/);
  });
});

describe("a link already issued outlives the plan change that would stop a new one", () => {
  it("keeps playing after its category leaves the plan, while a new link is refused", async () => {
    const clinic = await makeClinic("Vitest access clinic plan removed");
    const issued = await createShare(clinic, publishedVideo, 90);
    createdShareIds.push(issued.id);

    // Knee comes off the plan.
    await prisma.clinic.update({ where: { id: clinic }, data: { categories: [] } });

    // The patient page looks the link up by its code and counts a play, plan or no plan.
    await recordShareView(issued.code);
    const after = await getShareByCode(issued.code);
    expect(after?.id).toBe(issued.id);
    expect(after?.viewCount).toBe(1);

    // But no new link for that video can be made.
    await expectRefused(clinic, publishedVideo, "not-on-plan");
  });

  it("keeps playing after the clinic is paused, while a new link is refused", async () => {
    const clinic = await makeClinic("Vitest access clinic paused later");
    const issued = await createShare(clinic, publishedVideo, 90);
    createdShareIds.push(issued.id);

    await prisma.clinic.update({ where: { id: clinic }, data: { status: "PAUSED" } });

    await recordShareView(issued.code);
    expect((await getShareByCode(issued.code))?.viewCount).toBe(1);
    await expectRefused(clinic, publishedVideo, "clinic-closed");
  });

  it("is stopped by the video being unpublished, which also stops a new link", async () => {
    const clinic = await makeClinic("Vitest access clinic unpublished later");
    const video = await makeVideoOf({ category: "KNEE", isPlaceholder: true });
    const issued = await createShare(clinic, video, 90);
    createdShareIds.push(issued.id);

    await prisma.video.update({ where: { id: video }, data: { isPublished: false } });

    // The patient page shows the "not available" page for this link and a play is not counted.
    await recordShareView(issued.code);
    const after = await getShareByCode(issued.code);
    expect(after?.video.isPublished).toBe(false);
    expect(after?.viewCount).toBe(0);
    await expectRefused(clinic, video, "unpublished");
  });
});
