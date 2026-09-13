import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { sendShareAction } from "./actions";

/**
 * The Server Action behind the library's Send button, with Clerk replaced
 * by a stand-in and the database real (the Neon testing branch). What
 * these prove: any member of an open clinic can send a video the clinic
 * may use; the same video is refused for a clinic whose plan does not
 * include its category, for a clinic shown finished animations only when
 * it is a placeholder, and for a clinic that is not open; a refusal is a
 * plain sentence and writes nothing; and the clinic comes from the
 * signed-in user, since the action takes nothing but a video id.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// getBaseUrl() reads the request headers; there is no request here.
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
}));

/** Pretend Clerk says this person is signed in to this organization as a plain member. */
function signInAs(orgId: string | null) {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: () => false,
  } as never);
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

const orgKnee = fakeOrgId();
const orgHip = fakeOrgId();
const orgFinishedOnly = fakeOrgId();
const orgPending = fakeOrgId();
let kneeClinic = "";
let hipClinic = "";
let finishedOnlyClinic = "";
/** A published Knee placeholder. */
let placeholderId = "";
let unpublishedId = "";

async function makeClinic(name: string, clerkOrgId: string, data: { status?: "ACTIVE" | "PENDING"; categories?: ("KNEE" | "HIP")[]; showPlaceholders?: boolean }) {
  const clinic = await prisma.clinic.create({
    data: { name, clerkOrgId, status: data.status ?? "ACTIVE", categories: data.categories ?? ["KNEE"], showPlaceholders: data.showPlaceholders ?? true },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  kneeClinic = await makeClinic("Vitest send clinic (knee)", orgKnee, {});
  hipClinic = await makeClinic("Vitest send clinic (hip)", orgHip, { categories: ["HIP"] });
  finishedOnlyClinic = await makeClinic("Vitest send clinic (finished only)", orgFinishedOnly, { showPlaceholders: false });
  await makeClinic("Vitest send clinic (pending)", orgPending, { status: "PENDING" });

  const placeholder = await prisma.video.create({
    data: { title: "Vitest send video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  const unpublished = await prisma.video.create({
    data: { title: "Vitest send video (unpublished)", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: false },
    select: { id: true },
  });
  createdVideoIds.push(placeholder.id, unpublished.id);
  placeholderId = placeholder.id;
  unpublishedId = unpublished.id;
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function linksFor(clinicId: string) {
  return prisma.share.count({ where: { clinicId } });
}

describe("sendShareAction", () => {
  it("makes the link for a member of an open clinic with the category on its plan, in that clinic", async () => {
    signInAs(orgKnee);
    const result = await sendShareAction(placeholderId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link).toBe(`http://localhost:3000/watch/${result.code}`);
    expect(result.qrImage.startsWith("data:image/svg+xml")).toBe(true);
    expect(result.days).toBeGreaterThan(0);

    const share = await prisma.share.findUnique({ where: { code: result.code }, select: { clinicId: true, videoId: true } });
    expect(share).toEqual({ clinicId: kneeClinic, videoId: placeholderId });
  });

  it("refuses the same video for a clinic whose plan does not include Knee, with a plain message, and writes nothing", async () => {
    signInAs(orgHip);
    const before = await linksFor(hipClinic);

    const result = await sendShareAction(placeholderId);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("plan") });
    if (!result.ok) expect(result.error).not.toMatch(/error|invalid|403/i);
    expect(await linksFor(hipClinic)).toBe(before);
  });

  it("refuses a placeholder for a clinic shown finished animations only, and writes nothing", async () => {
    signInAs(orgFinishedOnly);
    const result = await sendShareAction(placeholderId);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
    expect(await linksFor(finishedOnlyClinic)).toBe(0);
  });

  it("refuses a clinic that is not open, before looking at the video", async () => {
    signInAs(orgPending);
    expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.stringContaining("can't send") });
    expect(await prisma.share.count({ where: { clinic: { clerkOrgId: orgPending } } })).toBe(0);
  });

  it("refuses an unpublished video, a video that does not exist, and an empty request", async () => {
    signInAs(orgKnee);
    expect(await sendShareAction(unpublishedId)).toMatchObject({ ok: false, error: expect.stringContaining("not published") });
    expect(await sendShareAction("video_that_does_not_exist")).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });
    expect(await sendShareAction("   ")).toEqual({ ok: false, error: "No video was selected." });
  });

  it("refuses a signed-out request", async () => {
    signInAs(null);
    expect(await sendShareAction(placeholderId)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
