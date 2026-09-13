import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canUseVideo, getClinicAccess } from "./access";
import { prisma } from "./client";

/**
 * The two access reads against the real test database: what one clinic may
 * use, and whether it may use one video. Videos belong to Pulse, not to a
 * clinic, so the isolation check is two clinics with different plans asked
 * about the same video. Every row is made here and deleted by id.
 */

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

function tag() {
  return randomBytes(4).toString("hex");
}

async function makeClinic(data: Partial<Parameters<typeof prisma.clinic.create>[0]["data"]> = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest access clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], ...data },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeVideo(data: { category?: "KNEE" | "HIP"; isPublished?: boolean; isPlaceholder?: boolean } = {}) {
  const video = await prisma.video.create({
    data: {
      title: `Vitest access video ${tag()}`,
      category: data.category ?? "KNEE",
      videoUrl: "https://example.com/vitest.mp4",
      isPublished: data.isPublished ?? true,
      isPlaceholder: data.isPlaceholder ?? false,
    },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

let kneeVideo = "";
let kneePlaceholder = "";
let unpublishedKnee = "";

beforeAll(async () => {
  kneeVideo = await makeVideo();
  kneePlaceholder = await makeVideo({ isPlaceholder: true });
  unpublishedKnee = await makeVideo({ isPublished: false });
});

afterAll(async () => {
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("getClinicAccess", () => {
  it("returns the clinic's status, plan and placeholder setting, with the plan in library order and each category once", async () => {
    const clinicId = await makeClinic({ categories: ["HIP", "KNEE", "HIP"], showPlaceholders: false });
    expect(await getClinicAccess(clinicId)).toEqual({
      clinicId,
      status: "ACTIVE",
      open: true,
      categories: ["KNEE", "HIP"],
      showPlaceholders: false,
    });
  });

  it("reports a clinic that is not open as closed, and one with no plan as having no categories", async () => {
    const paused = await makeClinic({ status: "PAUSED" });
    expect(await getClinicAccess(paused)).toMatchObject({ open: false, status: "PAUSED", categories: ["KNEE"] });

    const noPlan = await makeClinic({ categories: [] });
    expect(await getClinicAccess(noPlan)).toMatchObject({ open: true, categories: [] });
  });

  it("is null for a clinic that does not exist", async () => {
    expect(await getClinicAccess("clinic_that_does_not_exist")).toBeNull();
  });
});

describe("canUseVideo", () => {
  it("decides the same video differently for two clinics with different plans", async () => {
    const kneeClinic = await makeClinic({ categories: ["KNEE"] });
    const hipClinic = await makeClinic({ categories: ["HIP"] });

    expect(await canUseVideo(kneeClinic, kneeVideo)).toEqual({ allowed: true });
    expect(await canUseVideo(hipClinic, kneeVideo)).toEqual({ allowed: false, reason: "not-on-plan" });
  });

  it("refuses a clinic that is paused, pending, past due or canceled, whatever its plan", async () => {
    for (const status of ["PAUSED", "PENDING", "PAST_DUE", "CANCELED"] as const) {
      const clinicId = await makeClinic({ status });
      expect(await canUseVideo(clinicId, kneeVideo)).toEqual({ allowed: false, reason: "clinic-closed" });
    }
  });

  it("refuses an unpublished video and a video that does not exist", async () => {
    const clinicId = await makeClinic();
    expect(await canUseVideo(clinicId, unpublishedKnee)).toEqual({ allowed: false, reason: "unpublished" });
    expect(await canUseVideo(clinicId, "video_that_does_not_exist")).toEqual({ allowed: false, reason: "no-such-video" });
  });

  it("refuses a placeholder for a clinic shown finished animations only, and allows the finished one", async () => {
    const clinicId = await makeClinic({ showPlaceholders: false });
    expect(await canUseVideo(clinicId, kneePlaceholder)).toEqual({ allowed: false, reason: "placeholder-hidden" });
    expect(await canUseVideo(clinicId, kneeVideo)).toEqual({ allowed: true });

    const shownClinic = await makeClinic({ showPlaceholders: true });
    expect(await canUseVideo(shownClinic, kneePlaceholder)).toEqual({ allowed: true });
  });

  it("gives a clinic managed by Pulse no more than its status and plan give it", async () => {
    const managedPaused = await makeClinic({ managedByPulse: true, status: "PAUSED" });
    expect(await canUseVideo(managedPaused, kneeVideo)).toEqual({ allowed: false, reason: "clinic-closed" });

    const managedNoPlan = await makeClinic({ managedByPulse: true, categories: [] });
    expect(await canUseVideo(managedNoPlan, kneeVideo)).toEqual({ allowed: false, reason: "not-on-plan" });
  });

  it("answers as closed for a clinic id that does not exist", async () => {
    expect(await canUseVideo("clinic_that_does_not_exist", kneeVideo)).toEqual({ allowed: false, reason: "clinic-closed" });
  });
});
