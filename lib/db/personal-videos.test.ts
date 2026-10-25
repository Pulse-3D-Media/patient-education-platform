import { randomBytes } from "node:crypto";
import type { Category } from "../categories";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClinicAccess } from "./access";
import { prisma } from "./client";
import { listFavoriteIdsAmong, listFavoriteVideos, listMostWatchedVideos, recordLibraryPlay, setFavorite } from "./personal-videos";

/**
 * A person's own favorites and library plays, against the testing database.
 * What these prove: a heart and a play are recorded only for a video the
 * clinic may use right now, saying the same thing twice changes nothing,
 * plays add up (at the same moment too), one person never sees another's
 * and one clinic never another's, and the lists apply the access rule in
 * the query: a favorite whose category left the plan is hidden, not
 * deleted, and is back when the category returns.
 *
 * Every row these tests make is theirs (made-up clinics, videos and user
 * ids), and is deleted by id at the end.
 */

const tag = randomBytes(4).toString("hex");
const clinicIds: string[] = [];
const videoIds: string[] = [];
const person = `user_vitest_fav_${tag}`;
const otherPerson = `user_vitest_fav2_${tag}`;

let open = ""; // ACTIVE, Knee and Hip, placeholders shown
let finishedOnly = ""; // ACTIVE, Knee, placeholders hidden
let closed = ""; // PAUSED, Knee
let other = ""; // ACTIVE, Knee: a second clinic

let knee1 = "";
let knee2 = "";
let knee3 = "";
let hip1 = "";
let kneePlaceholder = "";
let unpublished = "";

async function clinic(name: string, status: "ACTIVE" | "PAUSED", categories: Category[], showPlaceholders = true) {
  const row = await prisma.clinic.create({ data: { name: `Vitest favorites ${name} ${tag}`, status, categories, showPlaceholders }, select: { id: true } });
  clinicIds.push(row.id);
  return row.id;
}

async function video(title: string, category: Category, extra: { isPublished?: boolean; isPlaceholder?: boolean } = {}) {
  const row = await prisma.video.create({
    data: { title: `Vitest favorites ${title} ${tag}`, category, videoUrl: `https://example.com/${tag}-${title}.mp4`, isPublished: true, ...extra },
    select: { id: true },
  });
  videoIds.push(row.id);
  return row.id;
}

/** The person's row for a video at a clinic, or null. */
function row(clinicId: string, videoId: string, who = person) {
  return prisma.personalVideo.findUnique({ where: { clinicId_clerkUserId_videoId: { clinicId, clerkUserId: who, videoId } } });
}

async function accessOf(clinicId: string) {
  const access = await getClinicAccess(clinicId);
  if (!access) throw new Error("clinic missing");
  return access;
}

beforeAll(async () => {
  open = await clinic("open", "ACTIVE", ["KNEE", "HIP"]);
  finishedOnly = await clinic("finished only", "ACTIVE", ["KNEE"], false);
  closed = await clinic("closed", "PAUSED", ["KNEE"]);
  other = await clinic("other", "ACTIVE", ["KNEE"]);
  knee1 = await video("knee one", "KNEE");
  knee2 = await video("knee two", "KNEE");
  knee3 = await video("knee three", "KNEE");
  hip1 = await video("hip one", "HIP");
  kneePlaceholder = await video("knee placeholder", "KNEE", { isPlaceholder: true });
  unpublished = await video("knee unpublished", "KNEE", { isPublished: false });
});

afterAll(async () => {
  await prisma.personalVideo.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { videoId: { in: videoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.$disconnect();
});

describe("hearting a video", () => {
  it("records a heart, keeps the first moment when said twice, and takes it away when asked", async () => {
    const first = new Date("2026-10-01T10:00:00Z");
    expect(await setFavorite(open, person, knee1, true, first)).toEqual({ ok: true });
    expect(await setFavorite(open, person, knee1, true, new Date("2026-10-02T10:00:00Z"))).toEqual({ ok: true });
    expect((await row(open, knee1))?.favoritedAt).toEqual(first);
    expect(await prisma.personalVideo.count({ where: { clinicId: open, clerkUserId: person, videoId: knee1 } })).toBe(1);

    expect(await setFavorite(open, person, knee1, false)).toEqual({ ok: true });
    expect((await row(open, knee1))?.favoritedAt).toBeNull();
    // Saying "not a favorite" again changes nothing and fails nothing.
    expect(await setFavorite(open, person, knee1, false)).toEqual({ ok: true });

    // Hearted again: a new moment, so it comes back to the front of My favorites.
    const again = new Date("2026-10-03T10:00:00Z");
    await setFavorite(open, person, knee1, true, again);
    expect((await row(open, knee1))?.favoritedAt).toEqual(again);
  });

  it("taking a heart away from a video with no row writes nothing", async () => {
    expect(await setFavorite(open, person, knee3, false)).toEqual({ ok: true });
    expect(await row(open, knee3)).toBeNull();
  });

  it("refuses, and writes nothing for, a video the clinic may not use", async () => {
    const cases: [string, string, string][] = [
      ["a made-up id", open, `vid_${tag}_nope`],
      ["an unpublished video", open, unpublished],
      ["a category off the plan", finishedOnly, hip1],
      ["a hidden placeholder", finishedOnly, kneePlaceholder],
      ["a closed clinic", closed, knee1],
    ];
    for (const [, clinicId, videoId] of cases) {
      const outcome = await setFavorite(clinicId, person, videoId, true);
      expect(outcome.ok).toBe(false);
      expect(await row(clinicId, videoId)).toBeNull();
    }
    expect(await setFavorite(`clinic_${tag}_nope`, person, knee1, true)).toEqual({ ok: false, reason: "clinic-closed" });
  });
});

describe("counting library plays", () => {
  it("adds one per play and keeps the latest moment", async () => {
    await recordLibraryPlay(open, person, knee2, new Date("2026-10-05T09:00:00Z"));
    await recordLibraryPlay(open, person, knee2, new Date("2026-10-05T11:00:00Z"));
    // A late one with an older clock never moves the latest moment back.
    await recordLibraryPlay(open, person, knee2, new Date("2026-10-05T10:00:00Z"));
    const saved = await row(open, knee2);
    expect(saved?.playCount).toBe(3);
    expect(saved?.lastPlayedAt).toEqual(new Date("2026-10-05T11:00:00Z"));
    // A play is not a heart.
    expect(saved?.favoritedAt).toBeNull();
  });

  it("counts five plays at the same moment as five", async () => {
    await Promise.all(Array.from({ length: 5 }, () => recordLibraryPlay(open, otherPerson, knee3)));
    expect((await row(open, knee3, otherPerson))?.playCount).toBe(5);
  });

  it("refuses a video the clinic may not use, writing nothing", async () => {
    expect((await recordLibraryPlay(finishedOnly, person, kneePlaceholder)).ok).toBe(false);
    expect((await recordLibraryPlay(open, person, unpublished)).ok).toBe(false);
    expect((await recordLibraryPlay(closed, person, knee1)).ok).toBe(false);
    expect(await row(finishedOnly, kneePlaceholder)).toBeNull();
    expect(await row(open, unpublished)).toBeNull();
    expect(await row(closed, knee1)).toBeNull();
  });
});

describe("the lists", () => {
  it("lists favorites newest heart first, this person's own and this clinic's own only", async () => {
    const who = `user_vitest_list_${tag}`;
    await setFavorite(open, who, knee1, true, new Date("2026-10-01T00:00:00Z"));
    await setFavorite(open, who, hip1, true, new Date("2026-10-03T00:00:00Z"));
    await setFavorite(open, who, knee2, true, new Date("2026-10-02T00:00:00Z"));
    // Someone else's heart, and the same person's heart at another clinic, are not on the list.
    await setFavorite(open, `user_vitest_else_${tag}`, knee3, true);
    await setFavorite(other, who, knee3, true);

    const ids = (await listFavoriteVideos(open, who, await accessOf(open))).map((v) => v.id);
    expect(ids).toEqual([hip1, knee2, knee1]);
    expect(await listFavoriteIdsAmong(open, who, [knee1, knee3, hip1])).toEqual(expect.arrayContaining([knee1, hip1]));
    expect(await listFavoriteIdsAmong(open, who, [knee1, knee3, hip1])).toHaveLength(2);
    expect(await listFavoriteIdsAmong(open, who, [])).toEqual([]);
    expect((await listFavoriteVideos(other, who, await accessOf(other))).map((v) => v.id)).toEqual([knee3]);
  });

  it("hides a favorite whose category left the plan, keeps its row, and shows it again when the category returns", async () => {
    const who = `user_vitest_plan_${tag}`;
    await setFavorite(open, who, hip1, true);
    await setFavorite(open, who, knee1, true);
    await recordLibraryPlay(open, who, hip1);

    await prisma.clinic.update({ where: { id: open }, data: { categories: ["KNEE"] } });
    try {
      const access = await accessOf(open);
      expect((await listFavoriteVideos(open, who, access)).map((v) => v.id)).toEqual([knee1]);
      expect((await listMostWatchedVideos(open, who, access)).map((v) => v.id)).not.toContain(hip1);
      // Hidden, not deleted.
      expect((await row(open, hip1, who))?.favoritedAt).not.toBeNull();
    } finally {
      await prisma.clinic.update({ where: { id: open }, data: { categories: ["KNEE", "HIP"] } });
    }
    expect((await listFavoriteVideos(open, who, await accessOf(open))).map((v) => v.id)).toContain(hip1);
  });

  it("hides a favorite that was unpublished, or became a placeholder the clinic is not shown", async () => {
    const who = `user_vitest_hide_${tag}`;
    const temp = await video("knee to hide", "KNEE");
    await setFavorite(finishedOnly, who, temp, true);
    expect((await listFavoriteVideos(finishedOnly, who, await accessOf(finishedOnly))).map((v) => v.id)).toEqual([temp]);

    await prisma.video.update({ where: { id: temp }, data: { isPlaceholder: true } });
    expect(await listFavoriteVideos(finishedOnly, who, await accessOf(finishedOnly))).toEqual([]);
    await prisma.video.update({ where: { id: temp }, data: { isPlaceholder: false, isPublished: false } });
    expect(await listFavoriteVideos(finishedOnly, who, await accessOf(finishedOnly))).toEqual([]);
  });

  it("orders Most watched by plays, then the most recent, and stops at the limit", async () => {
    const who = `user_vitest_most_${tag}`;
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 9, minute));
    for (let i = 0; i < 3; i++) await recordLibraryPlay(open, who, knee1, at(i));
    await recordLibraryPlay(open, who, knee2, at(10));
    await recordLibraryPlay(open, who, hip1, at(20));
    await recordLibraryPlay(open, who, hip1, at(21));
    await recordLibraryPlay(open, who, knee3, at(30));

    const access = await accessOf(open);
    expect((await listMostWatchedVideos(open, who, access)).map((v) => v.id)).toEqual([knee1, hip1, knee3, knee2]);
    expect((await listMostWatchedVideos(open, who, access, 2)).map((v) => v.id)).toEqual([knee1, hip1]);
    // A heart alone is not a play.
    await setFavorite(open, who, kneePlaceholder, true);
    expect((await listMostWatchedVideos(open, who, access)).map((v) => v.id)).not.toContain(kneePlaceholder);
  });

  it("reads nothing for a closed clinic, and refuses access facts that belong to another clinic", async () => {
    expect(await listFavoriteVideos(closed, person, await accessOf(closed))).toEqual([]);
    expect(await listMostWatchedVideos(closed, person, await accessOf(closed))).toEqual([]);
    await expect(listFavoriteVideos(open, person, await accessOf(other))).rejects.toThrow("different clinic");
  });
});
