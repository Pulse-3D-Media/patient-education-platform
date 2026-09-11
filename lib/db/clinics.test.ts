import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import {
  getClinicByClerkOrgId,
  linkClinicToClerkOrg,
  setClinicPlan,
  setClinicStatus,
  updateClinicDetails,
  upsertClinicForClerkOrg,
} from "./clinics";
import { createShare, getShareForClinic, listSharesForClinic } from "./shares";

/**
 * The organization-to-clinic lookup and the first-use upsert, against the
 * real test database.
 *
 * No Clerk here: lib/db never talks to Clerk. These tests make clinics with
 * made-up organization ids, ask for them back, and clean up after
 * themselves by id. Everything else in the test database is left alone.
 */

/** A made-up organization id that can never clash with a real one. */
function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const linkedOrgId = fakeOrgId();
const createdClinicIds: string[] = [];
const createdShareIds: string[] = [];
let videoId: string | null = null;

beforeAll(async () => {
  const clinic = await prisma.clinic.create({
    data: { name: "Vitest clinic (linked)", clerkOrgId: linkedOrgId },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);

  // A published video the isolation test can make share links for. It is
  // created here rather than borrowed, so the test owns everything it uses.
  const video = await prisma.video.create({
    data: {
      title: "Vitest procedure",
      category: "KNEE",
      videoUrl: "https://example.com/vitest.mp4",
      isPublished: true,
      isPlaceholder: true,
    },
    select: { id: true },
  });
  videoId = video.id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { id: { in: createdShareIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (videoId) await prisma.video.delete({ where: { id: videoId } });
  await prisma.$disconnect();
});

describe("getClinicByClerkOrgId", () => {
  it("returns the clinic linked to a known organization id", async () => {
    const clinic = await getClinicByClerkOrgId(linkedOrgId);
    expect(clinic).not.toBeNull();
    expect(clinic?.id).toBe(createdClinicIds[0]);
    expect(clinic?.name).toBe("Vitest clinic (linked)");
  });

  it("returns null for an organization id nothing is linked to", async () => {
    const clinic = await getClinicByClerkOrgId(fakeOrgId());
    expect(clinic).toBeNull();
  });
});

describe("upsertClinicForClerkOrg", () => {
  it("creates a PENDING clinic the first time an organization is seen", async () => {
    const orgId = fakeOrgId();
    const clinic = await upsertClinicForClerkOrg(orgId, { name: "Vitest new clinic", logoUrl: null });
    createdClinicIds.push(clinic.id);

    expect(clinic.clerkOrgId).toBe(orgId);
    expect(clinic.name).toBe("Vitest new clinic");
    expect(clinic.status).toBe("PENDING");
    expect(clinic.logoUrl).toBeNull();
  });

  it("run twice for the same organization gives one clinic, not two", async () => {
    const orgId = fakeOrgId();
    const details = { name: "Vitest twice clinic", logoUrl: "https://example.com/logo.png" };

    // Both at once, the way two requests from one person can arrive.
    const [first, second] = await Promise.all([
      upsertClinicForClerkOrg(orgId, details),
      upsertClinicForClerkOrg(orgId, details),
    ]);
    createdClinicIds.push(first.id);
    if (second.id !== first.id) createdClinicIds.push(second.id);

    expect(second.id).toBe(first.id);
    const rows = await prisma.clinic.count({ where: { clerkOrgId: orgId } });
    expect(rows).toBe(1);
  });

  it("updates the name and logo when Clerk's copy has changed, and keeps the status", async () => {
    const orgId = fakeOrgId();
    const created = await upsertClinicForClerkOrg(orgId, { name: "Vitest old name", logoUrl: null });
    createdClinicIds.push(created.id);
    await setClinicStatus(created.id, "ACTIVE");

    const updated = await upsertClinicForClerkOrg(orgId, { name: "Vitest new name", logoUrl: "https://example.com/l.png" });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Vitest new name");
    expect(updated.logoUrl).toBe("https://example.com/l.png");
    expect(updated.status).toBe("ACTIVE");
  });
});

describe("upsertClinicForClerkOrg and a logo set by Pulse staff", () => {
  it("keeps a staff-set logo when Clerk has no logo, and takes Clerk's logo when it has one", async () => {
    const orgId = fakeOrgId();
    const created = await upsertClinicForClerkOrg(orgId, { name: "Vitest logo clinic", logoUrl: null });
    createdClinicIds.push(created.id);

    await updateClinicDetails(created.id, {
      name: created.name,
      logoUrl: "https://example.com/staff-logo.png",
      phone: null,
      noticeText: null,
      showPlaceholders: true,
      viewDaysOverride: null,
    });

    // The clinic signs in again; its organization still has no logo of its own.
    const afterSignIn = await upsertClinicForClerkOrg(orgId, { name: "Vitest logo clinic", logoUrl: null });
    expect(afterSignIn.logoUrl).toBe("https://example.com/staff-logo.png");

    // Now the organization gets a real logo in Clerk: that one wins.
    const afterUpload = await upsertClinicForClerkOrg(orgId, { name: "Vitest logo clinic", logoUrl: "https://example.com/clerk-logo.png" });
    expect(afterUpload.logoUrl).toBe("https://example.com/clerk-logo.png");
  });
});

describe("setClinicPlan", () => {
  it("writes the categories and seats, dropping a repeated category", async () => {
    const orgId = fakeOrgId();
    const clinic = await upsertClinicForClerkOrg(orgId, { name: "Vitest plan clinic", logoUrl: null });
    createdClinicIds.push(clinic.id);

    const planned = await setClinicPlan(clinic.id, ["KNEE", "HIP", "KNEE"], 10);
    expect(planned.categories).toEqual(["KNEE", "HIP"]);
    expect(planned.surgeonSeats).toBe(10);

    const row = await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { categories: true, surgeonSeats: true } });
    expect(row).toEqual({ categories: ["KNEE", "HIP"], surgeonSeats: 10 });
  });

  it("an empty list and zero seats means no plan", async () => {
    const orgId = fakeOrgId();
    const clinic = await upsertClinicForClerkOrg(orgId, { name: "Vitest no-plan clinic", logoUrl: null });
    createdClinicIds.push(clinic.id);

    const planned = await setClinicPlan(clinic.id, [], 0);
    expect(planned.categories).toEqual([]);
    expect(planned.surgeonSeats).toBe(0);
  });
});

describe("setClinicStatus", () => {
  it("changes the status and the lookup sees it", async () => {
    const orgId = fakeOrgId();
    const clinic = await upsertClinicForClerkOrg(orgId, { name: "Vitest status clinic", logoUrl: null });
    createdClinicIds.push(clinic.id);

    await setClinicStatus(clinic.id, "PAUSED");
    expect((await getClinicByClerkOrgId(orgId))?.status).toBe("PAUSED");
  });
});

describe("isolation between clinics created on first use", () => {
  it("a clinic sees only its own share links", async () => {
    if (!videoId) throw new Error("test video missing");

    const clinicA = await upsertClinicForClerkOrg(fakeOrgId(), { name: "Vitest clinic A", logoUrl: null });
    const clinicB = await upsertClinicForClerkOrg(fakeOrgId(), { name: "Vitest clinic B", logoUrl: null });
    createdClinicIds.push(clinicA.id, clinicB.id);

    const shareA = await createShare(clinicA.id, videoId, 7);
    const shareB = await createShare(clinicB.id, videoId, 7);
    createdShareIds.push(shareA.id, shareB.id);

    const listA = await listSharesForClinic(clinicA.id);
    const listB = await listSharesForClinic(clinicB.id);
    expect(listA.map((s) => s.id)).toEqual([shareA.id]);
    expect(listB.map((s) => s.id)).toEqual([shareB.id]);

    // Clinic B cannot look up clinic A's link by its code.
    expect(await getShareForClinic(clinicB.id, shareA.code)).toBeNull();
    expect((await getShareForClinic(clinicA.id, shareA.code))?.id).toBe(shareA.id);
  });
});

describe("linkClinicToClerkOrg", () => {
  it("links a clinic so the lookup finds it afterwards", async () => {
    const unlinked = await prisma.clinic.create({
      data: { name: "Vitest clinic (unlinked)" },
      select: { id: true },
    });
    createdClinicIds.push(unlinked.id);

    const orgId = fakeOrgId();
    expect(await getClinicByClerkOrgId(orgId)).toBeNull();

    const linked = await linkClinicToClerkOrg(unlinked.id, orgId);
    expect(linked.clerkOrgId).toBe(orgId);

    const found = await getClinicByClerkOrgId(orgId);
    expect(found?.id).toBe(unlinked.id);
  });
});
