import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { createLinkAction } from "./actions";

/**
 * The Server Action behind Create link on /admin/links, with Clerk replaced
 * by the in-memory stand-in (lib/testing/fake-clerk.ts) and the database
 * real (the Neon testing branch). What these prove:
 *
 *   - only an admin of an open clinic can make a link, and a refusal writes nothing;
 *   - every link is from a surgeon, and the server checks the pick: someone
 *     with no seat, someone from another clinic, or no pick at all is refused
 *     with a plain sentence and nothing written;
 *   - the surgeon's id and the name patients see are copied onto the link,
 *     and a later change to that name does not change a link already made;
 *   - the clinic's plan still decides what can be shared, checked when the
 *     button is pressed, not when the page was drawn.
 *
 * The clinic never comes from the browser: it comes from the signed-in
 * admin's organization, which is what the stand-in plays.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

// revalidatePath only works inside a real request; here it just needs to not throw.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const tag = () => randomBytes(6).toString("hex");
const orgId = () => `org_test_${tag()}`;
const userId = (name: string) => `user_${name}${tag()}`;

const orgActive = orgId();
const orgOther = orgId();
const orgPending = orgId();
const orgKneeOnly = orgId();
const orgFinishedOnly = orgId();

// Clinic A (open, Hip on its plan).
const adminA = userId("admina"); // an admin who holds a seat, "Pat Lee" in Clerk
const surgeonA = userId("surgeona"); // a member who holds a seat, "Jane Smith" in Clerk
const noSeatA = userId("noseata"); // a member who holds no seat
const nameless = userId("namelessa"); // holds a seat, but Clerk has no name for them
// Clinic B (open, Hip on its plan).
const surgeonB = userId("surgeonb");
// The other clinics each have one admin who holds a seat.
const adminPending = userId("adminp");
const adminKnee = userId("admink");
const adminFinished = userId("adminf");

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinicA = "";
let clinicB = "";
let kneeOnlyClinic = "";
let finishedOnlyClinic = "";
/** A published Hip placeholder. */
let videoId = "";

async function makeClinic(
  name: string,
  clerkOrgId: string,
  status: "ACTIVE" | "PENDING",
  seated: string[],
  extra: { categories?: ("HIP" | "KNEE")[]; showPlaceholders?: boolean } = {},
) {
  const clinic = await prisma.clinic.create({
    data: {
      name,
      clerkOrgId,
      status,
      surgeonSeats: 10,
      categories: extra.categories ?? ["HIP"],
      showPlaceholders: extra.showPlaceholders ?? true,
      seatAllocations: { create: seated.map((clerkUserId) => ({ clerkUserId, syncState: "SYNCED" as const })) },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  fakeClerk.reset();
  fakeClerk.addOrg(orgActive, "Vitest links clinic A", [
    { userId: adminA, firstName: "Pat", lastName: "Lee", role: "org:admin" },
    { userId: surgeonA, firstName: "Jane", lastName: "Smith", role: "org:member" },
    { userId: noSeatA, firstName: "Sam", lastName: "Doe", role: "org:member" },
    { userId: nameless, firstName: "", lastName: "", identifier: "nameless@example.com", role: "org:member" },
  ]);
  fakeClerk.addOrg(orgOther, "Vitest links clinic B", [{ userId: surgeonB, firstName: "Bo", lastName: "Other", role: "org:admin" }]);
  fakeClerk.addOrg(orgPending, "Vitest links clinic (pending)", [{ userId: adminPending, firstName: "Pen", lastName: "Ding", role: "org:admin" }]);
  fakeClerk.addOrg(orgKneeOnly, "Vitest links clinic (knee only)", [{ userId: adminKnee, firstName: "Kay", lastName: "Nee", role: "org:admin" }]);
  fakeClerk.addOrg(orgFinishedOnly, "Vitest links clinic (finished only)", [{ userId: adminFinished, firstName: "Fin", lastName: "Ished", role: "org:admin" }]);

  clinicA = await makeClinic("Vitest links clinic A", orgActive, "ACTIVE", [adminA, surgeonA, nameless]);
  clinicB = await makeClinic("Vitest links clinic B", orgOther, "ACTIVE", [surgeonB]);
  await makeClinic("Vitest links clinic (pending)", orgPending, "PENDING", [adminPending]);
  kneeOnlyClinic = await makeClinic("Vitest links clinic (knee only)", orgKneeOnly, "ACTIVE", [adminKnee], { categories: ["KNEE"] });
  finishedOnlyClinic = await makeClinic("Vitest links clinic (finished only)", orgFinishedOnly, "ACTIVE", [adminFinished], { showPlaceholders: false });

  const video = await prisma.video.create({
    data: { title: "Vitest links video", category: "HIP", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  videoId = video.id;
});

beforeEach(() => {
  fakeClerk.failReads = false;
  fakeClerk.signIn(null, null);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  // Seats and log entries go with their clinic (onDelete: Cascade).
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  fakeClerk.reset();
  await prisma.$disconnect();
});

async function linksFor(clinicId: string) {
  return prisma.share.count({ where: { clinicId } });
}

async function shareOf(code: string) {
  return prisma.share.findUniqueOrThrow({
    where: { code },
    select: { clinicId: true, senderUserId: true, senderName: true, expiryPolicy: true, firstPlayedAt: true, daysAfterFirstPlay: true },
  });
}

describe("who may press Create link", () => {
  it("refuses a member, and writes nothing", async () => {
    fakeClerk.signIn(surgeonA, orgActive);
    const before = await linksFor(clinicA);
    expect(await createLinkAction(videoId, surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("office admins") });
    expect(await linksFor(clinicA)).toBe(before);
  });

  it("refuses an admin of a clinic that is not open, and writes nothing", async () => {
    fakeClerk.signIn(adminPending, orgPending);
    expect(await createLinkAction(videoId, adminPending)).toMatchObject({ ok: false, error: expect.stringContaining("on a plan") });
    expect(await prisma.share.count({ where: { clinic: { clerkOrgId: orgPending } } })).toBe(0);
  });

  it("refuses a signed-out request", async () => {
    expect(await createLinkAction(videoId, surgeonA)).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("who the link is from", () => {
  it("makes the link from the surgeon picked, with their id and 'Dr. First Last' copied onto it, in the admin's clinic", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const result = await createLinkAction(videoId, surgeonA);
    expect(result).toEqual({ ok: true, code: expect.stringMatching(/^[a-z0-9]{6}$/), senderName: "Dr. Jane Smith" });

    const share = await shareOf((result as { code: string }).code);
    expect(share).toMatchObject({ clinicId: clinicA, senderUserId: surgeonA, senderName: "Dr. Jane Smith" });
    // Made under the first-play rule, with the days copied onto it; the button chose none of this.
    expect(share.expiryPolicy).toBe("FIRST_PLAY");
    expect(share.firstPlayedAt).toBeNull();
    expect(share.daysAfterFirstPlay).toBeGreaterThan(0);
  });

  it("lets an admin who holds a seat send from themselves", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const result = await createLinkAction(videoId, adminA);
    expect(result).toMatchObject({ ok: true, senderName: "Dr. Pat Lee" });
  });

  it("uses the name typed on People, and a later change to it never changes a link already made", async () => {
    fakeClerk.signIn(adminA, orgActive);
    await prisma.seatAllocation.update({ where: { clinicId_clerkUserId: { clinicId: clinicA, clerkUserId: surgeonA } }, data: { displayName: "Jane Smith, PA-C" } });
    try {
      const first = await createLinkAction(videoId, surgeonA);
      expect(first).toMatchObject({ ok: true, senderName: "Jane Smith, PA-C" });

      await prisma.seatAllocation.update({ where: { clinicId_clerkUserId: { clinicId: clinicA, clerkUserId: surgeonA } }, data: { displayName: "Jane Smith-Park, PA-C" } });
      const second = await createLinkAction(videoId, surgeonA);
      expect(second).toMatchObject({ ok: true, senderName: "Jane Smith-Park, PA-C" });

      // The first link still carries the name it was made with.
      expect((await shareOf((first as { code: string }).code)).senderName).toBe("Jane Smith, PA-C");
    } finally {
      await prisma.seatAllocation.update({ where: { clinicId_clerkUserId: { clinicId: clinicA, clerkUserId: surgeonA } }, data: { displayName: null } });
    }
  });

  it("keeps the name on a link after the surgeon's seat is let go", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const made = await createLinkAction(videoId, nameless);
    expect(made).toMatchObject({ ok: true, senderName: null });
    const kept = await createLinkAction(videoId, surgeonA);
    const code = (kept as { code: string }).code;
    await prisma.seatAllocation.delete({ where: { clinicId_clerkUserId: { clinicId: clinicA, clerkUserId: surgeonA } } });
    try {
      expect(await shareOf(code)).toMatchObject({ senderUserId: surgeonA, senderName: "Dr. Jane Smith" });
      // And no new link can be made from them.
      expect(await createLinkAction(videoId, surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("does not hold a seat") });
    } finally {
      await prisma.seatAllocation.create({ data: { clinicId: clinicA, clerkUserId: surgeonA, syncState: "SYNCED" } });
    }
  });

  it("makes a link from someone Clerk has no name for, with no name on it (never their email)", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const result = await createLinkAction(videoId, nameless);
    expect(result).toMatchObject({ ok: true, senderName: null });
    const share = await shareOf((result as { code: string }).code);
    expect(share).toMatchObject({ senderUserId: nameless, senderName: null });
  });

  it("refuses a pick with no seat, and writes nothing", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const before = await linksFor(clinicA);
    const result = await createLinkAction(videoId, noSeatA);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("does not hold a seat") });
    expect((result as { error: string }).error).not.toMatch(/error|invalid|403/i);
    expect(await linksFor(clinicA)).toBe(before);
  });

  it("refuses a surgeon from another clinic, even one holding a seat there, and writes nothing in either clinic", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const [beforeA, beforeB] = [await linksFor(clinicA), await linksFor(clinicB)];
    expect(await createLinkAction(videoId, surgeonB)).toMatchObject({ ok: false, error: expect.stringContaining("does not hold a seat") });
    expect(await linksFor(clinicA)).toBe(beforeA);
    expect(await linksFor(clinicB)).toBe(beforeB);
  });

  it("refuses no pick, a made-up id and a value that is not text, and writes nothing", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const before = await linksFor(clinicA);
    expect(await createLinkAction(videoId, "")).toMatchObject({ ok: false, error: "Choose who the link is from." });
    expect(await createLinkAction(videoId, null)).toMatchObject({ ok: false, error: "Choose who the link is from." });
    expect(await createLinkAction(videoId, "user_nobody")).toMatchObject({ ok: false, error: expect.stringContaining("does not hold a seat") });
    expect(await createLinkAction(videoId, "not-a-user'; drop table")).toMatchObject({ ok: false });
    expect(await createLinkAction(videoId, { userId: surgeonA })).toMatchObject({ ok: false });
    expect(await linksFor(clinicA)).toBe(before);
  });

  it("answers a Clerk outage with a plain sentence and writes nothing", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const before = await linksFor(clinicA);
    fakeClerk.failReads = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createLinkAction(videoId, surgeonA);
      expect(result).toEqual({ ok: false, error: "The link could not be made just now. Nothing was sent to anyone. Try again in a moment." });
    } finally {
      errors.mockRestore();
    }
    expect(await linksFor(clinicA)).toBe(before);
  });
});

describe("Create link and the clinic's plan", () => {
  it("refuses a form with no video", async () => {
    fakeClerk.signIn(adminA, orgActive);
    expect(await createLinkAction("", surgeonA)).toEqual({ ok: false, error: "No video was selected." });
  });

  it("refuses a video whose category is not on the clinic's plan, with a plain message, and writes nothing", async () => {
    fakeClerk.signIn(adminKnee, orgKneeOnly);
    const before = await linksFor(kneeOnlyClinic);
    const result = await createLinkAction(videoId, adminKnee);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("plan") });
    expect((result as { error: string }).error).not.toMatch(/error|invalid|403/i);
    expect(await linksFor(kneeOnlyClinic)).toBe(before);
  });

  it("refuses a placeholder for a clinic shown finished animations only, and writes nothing", async () => {
    fakeClerk.signIn(adminFinished, orgFinishedOnly);
    const before = await linksFor(finishedOnlyClinic);
    expect(await createLinkAction(videoId, adminFinished)).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
    expect(await linksFor(finishedOnlyClinic)).toBe(before);
  });

  it("refuses a video that no longer exists, and an unpublished one", async () => {
    fakeClerk.signIn(adminA, orgActive);
    expect(await createLinkAction("video_that_does_not_exist", surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });

    const unpublished = await prisma.video.create({
      data: { title: "Vitest links video (unpublished)", category: "HIP", videoUrl: "https://example.com/vitest.mp4", isPublished: false },
      select: { id: true },
    });
    createdVideoIds.push(unpublished.id);
    expect(await createLinkAction(unpublished.id, surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("not published") });
  });

  it("refuses the same press once the category has left the plan: the check happens when the button is pressed", async () => {
    fakeClerk.signIn(adminA, orgActive);
    const first = await createLinkAction(videoId, surgeonA);
    expect(first).toMatchObject({ ok: true });
    const after = await linksFor(clinicA);

    try {
      await prisma.clinic.update({ where: { id: clinicA }, data: { categories: ["KNEE"] } });
      expect(await createLinkAction(videoId, surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("plan") });
      expect(await linksFor(clinicA)).toBe(after);

      // The link already made keeps working: it is still there, unexpired, and its video still published.
      const kept = await prisma.share.findUnique({ where: { code: (first as { code: string }).code }, include: { video: { select: { isPublished: true } } } });
      expect(kept?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(kept?.video.isPublished).toBe(true);
    } finally {
      await prisma.clinic.update({ where: { id: clinicA }, data: { categories: ["HIP"] } });
    }
  });
});
