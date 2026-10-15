import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentClinicId } from "@/lib/clinic";
import { prisma } from "@/lib/db/client";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { recordLibraryPlayAction, setFavoriteAction } from "./actions";

/**
 * The heart and the play count, with Clerk replaced by the in-memory
 * stand-in (lib/testing/fake-clerk.ts) and the database real. What these
 * prove: a member and an admin of an open clinic can heart and count a play
 * for themselves; someone signed out, at a closed clinic, or asking about
 * a video their clinic may not use (another clinic's plan, a forged id)
 * gets a plain refusal and nothing is written; the clinic and the person
 * come from the session, never from what the browser sends; junk input is
 * refused before the database; and a failure is a plain sentence, with
 * only its kind in the server log.
 */

vi.mock("@/lib/clinic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clinic")>();
  return { ...real, getCurrentClinicId: vi.fn(real.getCurrentClinicId) };
});
vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

const tag = randomBytes(4).toString("hex");
const orgKnee = `org_test_fav_knee_${tag}`;
const orgHip = `org_test_fav_hip_${tag}`;
const orgPaused = `org_test_fav_paused_${tag}`;
const member = `user_fav_member_${tag}`;
const admin = `user_fav_admin_${tag}`;
const hipPerson = `user_fav_hip_${tag}`;
const pausedPerson = `user_fav_paused_${tag}`;

const clinicIds: string[] = [];
const videoIds: string[] = [];
let kneeClinic = "";
let hipClinic = "";
let kneeVideo = "";
let hipVideo = "";

async function makeClinic(name: string, clerkOrgId: string, status: "ACTIVE" | "PAUSED", categories: ("KNEE" | "HIP")[]) {
  const row = await prisma.clinic.create({ data: { name, clerkOrgId, status, categories }, select: { id: true } });
  clinicIds.push(row.id);
  return row.id;
}

async function rowsFor(clinicId: string) {
  return prisma.personalVideo.findMany({ where: { clinicId } });
}

beforeAll(async () => {
  fakeClerk.reset();
  fakeClerk.addOrg(orgKnee, "Vitest favorites (knee)", [
    { userId: member, firstName: "Mo", lastName: "Member", role: "org:member" },
    { userId: admin, firstName: "Ada", lastName: "Admin", role: "org:admin" },
  ]);
  fakeClerk.addOrg(orgHip, "Vitest favorites (hip)", [{ userId: hipPerson, firstName: "Hi", lastName: "Person", role: "org:member" }]);
  fakeClerk.addOrg(orgPaused, "Vitest favorites (paused)", [{ userId: pausedPerson, firstName: "Pa", lastName: "Used", role: "org:member" }]);
  kneeClinic = await makeClinic("Vitest favorites (knee)", orgKnee, "ACTIVE", ["KNEE"]);
  hipClinic = await makeClinic("Vitest favorites (hip)", orgHip, "ACTIVE", ["HIP"]);
  await makeClinic("Vitest favorites (paused)", orgPaused, "PAUSED", ["KNEE"]);
  for (const [title, category] of [
    ["knee", "KNEE"],
    ["hip", "HIP"],
  ] as const) {
    const video = await prisma.video.create({
      data: { title: `Vitest favorites action ${title} ${tag}`, category, videoUrl: `https://example.com/${tag}-${title}.mp4`, isPublished: true },
      select: { id: true },
    });
    videoIds.push(video.id);
  }
  [kneeVideo, hipVideo] = videoIds;
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.personalVideo.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { videoId: { in: videoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  fakeClerk.reset();
  await prisma.$disconnect();
});

describe("setFavoriteAction", () => {
  it("lets a member heart a video for themselves, safely twice, and take the heart away", async () => {
    fakeClerk.signIn(member, orgKnee);
    expect(await setFavoriteAction(kneeVideo, true)).toEqual({ ok: true, favorite: true });
    expect(await setFavoriteAction(kneeVideo, true)).toEqual({ ok: true, favorite: true });
    let rows = await rowsFor(kneeClinic);
    expect(rows.filter((r) => r.clerkUserId === member)).toHaveLength(1);
    expect(rows.find((r) => r.clerkUserId === member)?.favoritedAt).not.toBeNull();

    expect(await setFavoriteAction(kneeVideo, false)).toEqual({ ok: true, favorite: false });
    rows = await rowsFor(kneeClinic);
    expect(rows.find((r) => r.clerkUserId === member)?.favoritedAt).toBeNull();
  });

  it("lets an admin heart too, as themselves: one person's heart is not another's", async () => {
    fakeClerk.signIn(admin, orgKnee);
    expect(await setFavoriteAction(kneeVideo, true)).toEqual({ ok: true, favorite: true });
    const rows = await rowsFor(kneeClinic);
    expect(rows.find((r) => r.clerkUserId === admin)?.favoritedAt).not.toBeNull();
    expect(rows.find((r) => r.clerkUserId === member)?.favoritedAt ?? null).toBeNull();
  });

  it("refuses someone signed out, writing nothing", async () => {
    fakeClerk.signIn(null, null);
    const outcome = await setFavoriteAction(kneeVideo, true);
    expect(outcome.ok).toBe(false);
    expect(await prisma.personalVideo.count({ where: { videoId: kneeVideo, clerkUserId: { notIn: [member, admin] } } })).toBe(0);
  });

  it("refuses someone at a clinic that is not open, writing nothing", async () => {
    fakeClerk.signIn(pausedPerson, orgPaused);
    expect((await setFavoriteAction(kneeVideo, true)).ok).toBe(false);
    expect(await prisma.personalVideo.count({ where: { clerkUserId: pausedPerson } })).toBe(0);
  });

  it("refuses a video off this clinic's plan (another clinic's), and a forged id, writing nothing", async () => {
    fakeClerk.signIn(hipPerson, orgHip);
    const offPlan = await setFavoriteAction(kneeVideo, true);
    expect(offPlan).toEqual({ ok: false, error: "That video is not in your clinic's library right now, so it can't be a favorite." });
    expect((await setFavoriteAction(`cl_forged_${tag}`, true)).ok).toBe(false);
    expect(await rowsFor(hipClinic)).toHaveLength(0);
    // Its own plan's video is fine.
    expect(await setFavoriteAction(hipVideo, true)).toEqual({ ok: true, favorite: true });
  });

  it("refuses junk before asking the database", async () => {
    fakeClerk.signIn(member, orgKnee);
    for (const [id, favorite] of [
      [42, true],
      ["", true],
      ["x".repeat(200), true],
      [kneeVideo, "yes"],
      [kneeVideo, 1],
      [null, false],
    ] as const) {
      const outcome = await setFavoriteAction(id, favorite);
      expect(outcome).toEqual({ ok: false, error: "That could not be saved. Try again." });
    }
    expect(getCurrentClinicId).not.toHaveBeenCalled();
  });

  it("answers a failure with a plain sentence and logs only its kind", async () => {
    fakeClerk.signIn(member, orgKnee);
    const secret = "postgresql://someone:hunter2@db.example.com/neondb";
    vi.mocked(getCurrentClinicId).mockRejectedValueOnce(new TypeError(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await setFavoriteAction(kneeVideo, true)).toEqual({ ok: false, error: "That could not be saved just now. Try again in a moment." });
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain("TypeError");
      expect(logged).not.toContain("hunter2");
    } finally {
      log.mockRestore();
    }
  });
});

describe("recordLibraryPlayAction", () => {
  it("counts a play for the signed-in person", async () => {
    fakeClerk.signIn(member, orgKnee);
    expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: true });
    expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: true });
    const row = await prisma.personalVideo.findFirst({ where: { clinicId: kneeClinic, clerkUserId: member, videoId: kneeVideo } });
    expect(row?.playCount).toBe(2);
  });

  it("counts nothing for someone signed out, a closed clinic, a video off the plan, a forged id or junk", async () => {
    fakeClerk.signIn(null, null);
    expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: false });
    fakeClerk.signIn(pausedPerson, orgPaused);
    expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: false });
    fakeClerk.signIn(hipPerson, orgHip);
    expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: false });
    expect(await recordLibraryPlayAction(`cl_forged_${tag}`)).toEqual({ recorded: false });
    expect(await recordLibraryPlayAction({ id: kneeVideo })).toEqual({ recorded: false });
    expect(await prisma.personalVideo.count({ where: { clerkUserId: { in: [pausedPerson, hipPerson] }, playCount: { gt: 0 } } })).toBe(0);
  });

  it("answers a failure with recorded: false, never an error", async () => {
    fakeClerk.signIn(member, orgKnee);
    vi.mocked(getCurrentClinicId).mockRejectedValueOnce(new Error("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await recordLibraryPlayAction(kneeVideo)).toEqual({ recorded: false });
    } finally {
      log.mockRestore();
    }
  });
});
