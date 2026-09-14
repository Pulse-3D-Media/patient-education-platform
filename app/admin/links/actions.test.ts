import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { cancelShareAction, createShareAction } from "./actions";

/**
 * The Server Actions behind /admin/links, with Clerk replaced by a stand-in
 * and the database real (the Neon testing branch). What these prove: a
 * member is refused before anything is written, an admin of a clinic that
 * is not open is refused, an admin of one clinic cannot cancel another
 * clinic's link, and an admin of an open clinic can do both.
 *
 * The clinic id never comes from the form: it comes from the signed-in
 * user's organization, which is what the stand-in plays.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// revalidatePath only works inside a real request; here it just needs to not throw.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/** Pretend Clerk says this person is signed in to this organization, as an admin or a member. */
function signInAs(orgId: string | null, role: "admin" | "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
}

/** A form the way the browser would send it. */
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const createdShareIds: string[] = [];

const orgActive = fakeOrgId();
const orgOther = fakeOrgId();
const orgPending = fakeOrgId();
const orgKneeOnly = fakeOrgId();
const orgFinishedOnly = fakeOrgId();
let activeClinic = "";
let otherClinic = "";
let kneeOnlyClinic = "";
let finishedOnlyClinic = "";
/** A published Hip placeholder. */
let videoId = "";

/** A clinic with Hip on its plan (the test video is a Hip video), unless told otherwise. */
async function makeClinic(
  name: string,
  clerkOrgId: string,
  status: "ACTIVE" | "PENDING",
  extra: { categories?: ("HIP" | "KNEE")[]; showPlaceholders?: boolean } = {},
) {
  const clinic = await prisma.clinic.create({
    data: { name, clerkOrgId, status, categories: extra.categories ?? ["HIP"], showPlaceholders: extra.showPlaceholders ?? true },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  activeClinic = await makeClinic("Vitest links clinic (active)", orgActive, "ACTIVE");
  otherClinic = await makeClinic("Vitest links clinic (other)", orgOther, "ACTIVE");
  await makeClinic("Vitest links clinic (pending)", orgPending, "PENDING");
  kneeOnlyClinic = await makeClinic("Vitest links clinic (knee only)", orgKneeOnly, "ACTIVE", { categories: ["KNEE"] });
  finishedOnlyClinic = await makeClinic("Vitest links clinic (finished only)", orgFinishedOnly, "ACTIVE", { showPlaceholders: false });

  const video = await prisma.video.create({
    data: { title: "Vitest links video", category: "HIP", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  videoId = video.id;
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ id: { in: createdShareIds } }, { clinicId: { in: createdClinicIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function linksFor(clinicId: string) {
  return prisma.share.count({ where: { clinicId } });
}

describe("createShareAction", () => {
  it("refuses a member, and writes nothing", async () => {
    signInAs(orgActive, "member");
    const before = await linksFor(activeClinic);

    const result = await createShareAction(null, form({ videoId }));

    expect(result).toMatchObject({ error: expect.stringContaining("office admins") });
    expect(await linksFor(activeClinic)).toBe(before);
  });

  it("refuses an admin of a clinic that is not open, and writes nothing", async () => {
    signInAs(orgPending, "admin");
    const result = await createShareAction(null, form({ videoId }));
    expect(result).toMatchObject({ error: expect.stringContaining("on a plan") });
    expect(await prisma.share.count({ where: { clinic: { clerkOrgId: orgPending } } })).toBe(0);
  });

  it("refuses a signed-out request", async () => {
    signInAs(null, "admin");
    expect(await createShareAction(null, form({ videoId }))).toMatchObject({ error: expect.any(String) });
  });

  it("makes the link for an admin of an open clinic, in that clinic and no other", async () => {
    signInAs(orgActive, "admin");
    const result = await createShareAction(null, form({ videoId }));

    expect(result).toMatchObject({ code: expect.stringMatching(/^[a-z0-9]{6}$/) });
    const share = await prisma.share.findUnique({ where: { code: result!.code! }, select: { id: true, clinicId: true } });
    createdShareIds.push(share!.id);
    expect(share?.clinicId).toBe(activeClinic);
  });

  it("refuses a form with no video", async () => {
    signInAs(orgActive, "admin");
    expect(await createShareAction(null, form({}))).toEqual({ error: "No video was selected." });
  });
});

describe("cancelShareAction", () => {
  let code = "";

  beforeAll(async () => {
    const share = await prisma.share.create({
      data: { code: `v${randomBytes(3).toString("hex").slice(0, 5)}`, clinicId: activeClinic, videoId, expiresAt: new Date(Date.now() + 86400000) },
      select: { id: true, code: true },
    });
    createdShareIds.push(share.id);
    code = share.code;
  });

  it("does not let an admin of another clinic cancel it", async () => {
    signInAs(orgOther, "admin");
    await cancelShareAction(code);
    expect(await prisma.share.findUnique({ where: { code } })).not.toBeNull();
    expect(await linksFor(otherClinic)).toBe(0);
  });

  it("does not let a member of the same clinic cancel it", async () => {
    signInAs(orgActive, "member");
    expect(await cancelShareAction(code)).toMatchObject({ error: expect.any(String) });
    expect(await prisma.share.findUnique({ where: { code } })).not.toBeNull();
  });

  it("lets an admin of the clinic cancel it, and the link is gone", async () => {
    signInAs(orgActive, "admin");
    expect(await cancelShareAction(code)).toEqual({});
    expect(await prisma.share.findUnique({ where: { code } })).toBeNull();
  });
});

describe("createShareAction and the clinic's plan", () => {
  it("refuses a video whose category is not on the clinic's plan, with a plain message, and writes nothing", async () => {
    signInAs(orgKneeOnly, "admin");
    const before = await linksFor(kneeOnlyClinic);

    const result = await createShareAction(null, form({ videoId }));

    expect(result).toMatchObject({ error: expect.stringContaining("plan") });
    expect(result?.error).not.toMatch(/error|invalid|403/i);
    expect(await linksFor(kneeOnlyClinic)).toBe(before);
  });

  it("ignores a clinic id in the form: a forged one cannot borrow another clinic's plan", async () => {
    // The Knee-only admin sends the Hip video with the Hip clinic's id in the form.
    signInAs(orgKneeOnly, "admin");
    const kneeBefore = await linksFor(kneeOnlyClinic);
    const hipBefore = await linksFor(activeClinic);

    const result = await createShareAction(null, form({ videoId, clinicId: activeClinic }));

    expect(result).toMatchObject({ error: expect.stringContaining("plan") });
    expect(await linksFor(kneeOnlyClinic)).toBe(kneeBefore);
    expect(await linksFor(activeClinic)).toBe(hipBefore);
  });

  it("refuses a placeholder for a clinic shown finished animations only, and writes nothing", async () => {
    signInAs(orgFinishedOnly, "admin");
    const before = await linksFor(finishedOnlyClinic);

    const result = await createShareAction(null, form({ videoId }));

    expect(result).toMatchObject({ error: expect.stringContaining("placeholder") });
    expect(await linksFor(finishedOnlyClinic)).toBe(before);
  });

  it("refuses a video that no longer exists, and an unpublished one", async () => {
    signInAs(orgActive, "admin");
    expect(await createShareAction(null, form({ videoId: "video_that_does_not_exist" }))).toMatchObject({ error: expect.stringContaining("no longer exists") });

    const unpublished = await prisma.video.create({
      data: { title: "Vitest links video (unpublished)", category: "HIP", videoUrl: "https://example.com/vitest.mp4", isPublished: false },
      select: { id: true },
    });
    createdVideoIds.push(unpublished.id);
    expect(await createShareAction(null, form({ videoId: unpublished.id }))).toMatchObject({ error: expect.stringContaining("not published") });
  });

  it("refuses the same form once the category has left the plan: the check happens when the form is sent, not when it was drawn", async () => {
    signInAs(orgActive, "admin");
    const stale = form({ videoId });

    // Works while Hip is on the plan.
    const first = await createShareAction(null, stale);
    expect(first).toMatchObject({ code: expect.any(String) });
    const share = await prisma.share.findUnique({ where: { code: first!.code! }, select: { id: true } });
    createdShareIds.push(share!.id);
    const after = await linksFor(activeClinic);

    try {
      // Hip comes off the plan; the very same form is sent again.
      await prisma.clinic.update({ where: { id: activeClinic }, data: { categories: ["KNEE"] } });
      expect(await createShareAction(null, stale)).toMatchObject({ error: expect.stringContaining("plan") });
      expect(await linksFor(activeClinic)).toBe(after);

      // The link already made keeps working: it is still there, unexpired, and its video still published.
      const kept = await prisma.share.findUnique({ where: { id: share!.id }, include: { video: { select: { isPublished: true } } } });
      expect(kept?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(kept?.video.isPublished).toBe(true);
    } finally {
      await prisma.clinic.update({ where: { id: activeClinic }, data: { categories: ["HIP"] } });
    }
  });
});
