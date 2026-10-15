import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { recordLibraryPlay, setFavorite } from "./personal-videos";

/**
 * The forced overlap: two heart taps (or a heart and a play) for the same
 * person and video arriving at the same moment, the first one's row not yet
 * committed when the second arrives.
 *
 * The test holds the first tap's write open inside a transaction (the same
 * INSERT ... ON CONFLICT setFavorite() runs), starts the second tap through
 * the real setFavorite(), checks it is WAITING (Postgres holds it at the
 * unique index until the first one commits or gives up), then commits the
 * first. The second must then finish without an error, and there must be
 * exactly one row, hearted once.
 *
 * The control does the same with the obvious read-then-create a person
 * might write instead: it reads "no row yet" while the first is
 * uncommitted, tries to create one, waits, and then fails on the unique
 * constraint. That is the double tap ON CONFLICT turns into a harmless
 * update, and it proves the overlap here is real.
 *
 * The wait is two seconds, several times what an unblocked write takes
 * against the remote database, so a slow network cannot pass for a wait.
 */

const tag = randomBytes(4).toString("hex");
let clinicId = "";
let videoId = "";
const WAIT_MS = 2000;

beforeAll(async () => {
  clinicId = (await prisma.clinic.create({ data: { name: `Vitest favorites race ${tag}`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } })).id;
  videoId = (
    await prisma.video.create({
      data: { title: `Vitest favorites race ${tag}`, category: "KNEE", videoUrl: `https://example.com/${tag}.mp4`, isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.personalVideo.deleteMany({ where: { clinicId } });
  await prisma.video.deleteMany({ where: { id: videoId } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.$disconnect();
});

/** Run `first` inside a transaction that stays open until `release` is called. */
function holdOpen(first: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let started = () => {};
  const ready = new Promise<void>((resolve) => (started = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await first(tx);
      started();
      await released;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  return { ready, release, done };
}

/** The first tap's write, exactly as setFavorite() makes it, inside the held transaction. */
function firstHeart(person: string, at: Date) {
  return (tx: Prisma.TransactionClient) => tx.$executeRaw`
    INSERT INTO "PersonalVideo" ("id", "clinicId", "clerkUserId", "videoId", "favoritedAt", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${clinicId}, ${person}, ${videoId}, ${at}, ${at}, ${at})
    ON CONFLICT ("clinicId", "clerkUserId", "videoId") DO UPDATE
    SET "favoritedAt" = COALESCE("PersonalVideo"."favoritedAt", EXCLUDED."favoritedAt"), "updatedAt" = EXCLUDED."updatedAt"`;
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number) {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

describe("two heart taps at the same moment", () => {
  it("the second waits for the first, then ends in the same one row, hearted at the first tap's moment", async () => {
    const person = `user_race_${tag}_a`;
    const firstAt = new Date("2026-10-15T12:00:00Z");
    const held = holdOpen(firstHeart(person, firstAt));
    await held.ready;

    const second = setFavorite(clinicId, person, videoId, true, new Date("2026-10-15T12:00:01Z"));
    expect(await settlesWithin(second, WAIT_MS)).toBe(false);

    held.release();
    await held.done;
    await expect(second).resolves.toEqual({ ok: true });

    const rows = await prisma.personalVideo.findMany({ where: { clinicId, clerkUserId: person, videoId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.favoritedAt).toEqual(firstAt);
  });

  it("a heart and a play at the same moment end in one row with both", async () => {
    const person = `user_race_${tag}_b`;
    const held = holdOpen(firstHeart(person, new Date("2026-10-15T12:00:00Z")));
    await held.ready;

    const play = recordLibraryPlay(clinicId, person, videoId);
    expect(await settlesWithin(play, WAIT_MS)).toBe(false);
    held.release();
    await held.done;
    await expect(play).resolves.toEqual({ ok: true });

    const rows = await prisma.personalVideo.findMany({ where: { clinicId, clerkUserId: person, videoId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.favoritedAt).not.toBeNull();
    expect(rows[0]?.playCount).toBe(1);
  });

  it("five taps at once on a fresh video make one row and no error", async () => {
    const person = `user_race_${tag}_c`;
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => setFavorite(clinicId, person, videoId, true)));
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(await prisma.personalVideo.count({ where: { clinicId, clerkUserId: person, videoId } })).toBe(1);
  });

  it("control: a read-then-create in the same gap waits too, and then fails on the unique constraint", async () => {
    const person = `user_race_${tag}_d`;
    const held = holdOpen(firstHeart(person, new Date("2026-10-15T12:00:00Z")));
    await held.ready;

    // The naive version: look, see nothing (the first tap has not committed), then create.
    const naive = (async () => {
      const existing = await prisma.personalVideo.findUnique({ where: { clinicId_clerkUserId_videoId: { clinicId, clerkUserId: person, videoId } } });
      expect(existing).toBeNull();
      return prisma.personalVideo.create({ data: { clinicId, clerkUserId: person, videoId, favoritedAt: new Date() } });
    })();
    expect(await settlesWithin(naive, WAIT_MS)).toBe(false);

    held.release();
    await held.done;
    await expect(naive).rejects.toMatchObject({ code: "P2002" });
  });
});
