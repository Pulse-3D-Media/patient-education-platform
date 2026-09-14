import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, DAY_MS, MAX_LINK_DAYS, ShareTermsError } from "../expiry";
import { prisma } from "./client";
import { getSettings } from "./settings";
import { createShare, deleteShareForClinic, getShareTerms, recordSharePlay } from "./shares";

/**
 * The first-play expiry rule against the real test database.
 *
 * What these prove: a link written without the new columns (the way every
 * link made before this rule was written, and the way an older copy of the
 * app would still write one) is a legacy link that keeps its date exactly
 * as issued, played or not; a new link carries the numbers as the settings
 * were when it was made; the first real play moves its deadline once and
 * later plays only count; two first plays at once move it exactly once; a
 * play just before the unclaimed deadline works and can carry the link
 * past it; a play at the deadline itself, after it, on an unpublished
 * video, or on a missing link writes nothing; and a settings change after
 * a link is made does not touch it.
 *
 * Every test hands in its own clock (`now`), so nothing here depends on
 * when the test runs. Every row is made here and deleted afterwards.
 */

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

function tag() {
  return randomBytes(4).toString("hex");
}

/** An open clinic with Knee on its plan, so createShare lets it share the Knee videos made below. */
async function makeClinic(data: { viewDaysOverride?: number | null } = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest expiry clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: data.viewDaysOverride ?? null },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeVideo() {
  const video = await prisma.video.create({
    data: { title: `Vitest expiry video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

/**
 * A link the way every link was written before this rule: no expiry
 * policy, no first play, no number of days. Not through createShare, on
 * purpose, because createShare now sets the policy. The database's own
 * default (FIXED) is what makes it a legacy link.
 */
async function makeLegacy(clinicId: string, videoId: string, expiresAt: Date, viewCount = 0) {
  return prisma.share.create({
    data: { code: `l${tag().slice(0, 5)}`, clinicId, videoId, expiresAt, viewCount },
    select: { code: true },
  });
}

/** The fields the rule reads and writes, straight from the row. */
async function read(code: string) {
  return prisma.share.findUniqueOrThrow({
    where: { code },
    select: { expiryPolicy: true, expiresAt: true, firstPlayedAt: true, daysAfterFirstPlay: true, viewCount: true, lastViewedAt: true },
  });
}

/** A fixed moment: every expectation below is a number that can be checked by hand. */
const T = new Date("2026-09-14T15:00:00.000Z");

let clinic = "";
let video = "";

beforeAll(async () => {
  clinic = await makeClinic();
  video = await makeVideo();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("what a new link carries", () => {
  it("is a first-play link: unplayed, stopping after the platform's unclaimed days, with the platform's days after the first play copied onto it", async () => {
    // The testing branch's settings row may hold any numbers; the link has to match whatever they are right now.
    const settings = await getSettings();
    const share = await createShare(clinic, video, { now: T });
    const row = await read(share.code);

    expect(row.expiryPolicy).toBe("FIRST_PLAY");
    expect(row.firstPlayedAt).toBeNull();
    expect(row.viewCount).toBe(0);
    expect(row.expiresAt.getTime()).toBe(T.getTime() + settings.unclaimedDays * DAY_MS);
    expect(row.daysAfterFirstPlay).toBe(settings.viewDays);

    // The words the pages show come from the same numbers.
    expect(await getShareTerms(clinic)).toEqual({ unclaimedDays: settings.unclaimedDays, daysAfterFirstPlay: settings.viewDays });
  });

  it("copies the clinic's own number when Pulse staff have set one, and the unclaimed days stay the platform's", async () => {
    const settings = await getSettings();
    const tenDays = await makeClinic({ viewDaysOverride: 10 });
    const share = await createShare(tenDays, video, { now: T });

    expect((await read(share.code)).daysAfterFirstPlay).toBe(10);
    expect(await getShareTerms(tenDays)).toEqual({ unclaimedDays: settings.unclaimedDays, daysAfterFirstPlay: 10 });
  });

  it("keeps the number it was made with when the clinic's number changes afterwards; only links made from then on get the new one", async () => {
    const changing = await makeClinic({ viewDaysOverride: 10 });
    const older = await createShare(changing, video, { now: T });

    await prisma.clinic.update({ where: { id: changing }, data: { viewDaysOverride: 3 } });
    const newer = await createShare(changing, video, { now: T });

    expect((await read(older.code)).daysAfterFirstPlay).toBe(10);
    expect((await read(newer.code)).daysAfterFirstPlay).toBe(3);
    expect((await getShareTerms(changing))?.daysAfterFirstPlay).toBe(3);

    // And the older link's first play uses the ten it was promised, not the three that came later.
    const playedAt = addDays(T, 1);
    expect(await recordSharePlay(older.code, playedAt)).toEqual({ recorded: true, firstPlay: true });
    expect((await read(older.code)).expiresAt.getTime()).toBe(playedAt.getTime() + 10 * DAY_MS);
  });

  it("has no terms for a clinic that does not exist", async () => {
    expect(await getShareTerms("clinic_that_does_not_exist")).toBeNull();
  });

  it("accepts a clinic number of exactly a year, the limit itself", async () => {
    const aYear = await makeClinic({ viewDaysOverride: MAX_LINK_DAYS });
    const share = await createShare(aYear, video, { now: T });
    expect((await read(share.code)).daysAfterFirstPlay).toBe(MAX_LINK_DAYS);
    expect((await getShareTerms(aYear))?.daysAfterFirstPlay).toBe(MAX_LINK_DAYS);
  });

  it("refuses a clinic number past a year with a plain sentence, and writes nothing", async () => {
    // The forms refuse this; a hand edit could still store it. The column allows any whole number.
    const pastAYear = await makeClinic({ viewDaysOverride: MAX_LINK_DAYS + 1 });
    const before = await prisma.share.count({ where: { clinicId: pastAYear } });

    await expect(createShare(pastAYear, video, { now: T })).rejects.toMatchObject({ name: "ShareTermsError" });
    await expect(createShare(pastAYear, video, { now: T })).rejects.toThrow(/from 1 to 365/);
    await expect(createShare(pastAYear, video, { now: T })).rejects.toThrow(/Ask Pulse 3D/);
    expect(await prisma.share.count({ where: { clinicId: pastAYear } })).toBe(before);

    // The pages read the same rule, so they cannot promise a number the link would refuse.
    await expect(getShareTerms(pastAYear)).rejects.toBeInstanceOf(ShareTermsError);

    // Set right, the same clinic can make links again.
    await prisma.clinic.update({ where: { id: pastAYear }, data: { viewDaysOverride: 30 } });
    expect((await read((await createShare(pastAYear, video, { now: T })).code)).daysAfterFirstPlay).toBe(30);
  });
});

describe("a legacy link stays exactly as it was issued", () => {
  it("is FIXED by the database's own default when written without the new columns, and playing it changes nothing but the count", async () => {
    const expiresAt = addDays(T, 60);
    const { code } = await makeLegacy(clinic, video, expiresAt);
    expect((await read(code)).expiryPolicy).toBe("FIXED");

    expect(await recordSharePlay(code, addDays(T, 1))).toEqual({ recorded: true, firstPlay: false });
    let row = await read(code);
    expect(row.viewCount).toBe(1);
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row.firstPlayedAt).toBeNull();
    expect(row.daysAfterFirstPlay).toBeNull();

    expect(await recordSharePlay(code, addDays(T, 2))).toEqual({ recorded: true, firstPlay: false });
    row = await read(code);
    expect(row.viewCount).toBe(2);
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row.firstPlayedAt).toBeNull();
  });

  it("a legacy link that had already been played keeps its date too", async () => {
    const expiresAt = addDays(T, 40);
    const { code } = await makeLegacy(clinic, video, expiresAt, 4);

    expect(await recordSharePlay(code, T)).toEqual({ recorded: true, firstPlay: false });
    const row = await read(code);
    expect(row.viewCount).toBe(5);
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row.firstPlayedAt).toBeNull();
  });

  it("stops at its own date like any link: a play at or after it writes nothing", async () => {
    const expiresAt = addDays(T, 5);
    const { code } = await makeLegacy(clinic, video, expiresAt, 1);
    expect(await recordSharePlay(code, expiresAt)).toEqual({ recorded: false, reason: "expired" });
    expect((await read(code)).viewCount).toBe(1);
  });
});

describe("the first play of a new link", () => {
  it("moves the deadline once, to that moment plus the copied days, and counts the play; later plays only count", async () => {
    const share = await createShare(clinic, video, { now: T });
    const days = (await read(share.code)).daysAfterFirstPlay!;

    const first = addDays(T, 2);
    expect(await recordSharePlay(share.code, first)).toEqual({ recorded: true, firstPlay: true });
    let row = await read(share.code);
    expect(row.firstPlayedAt?.getTime()).toBe(first.getTime());
    expect(row.expiresAt.getTime()).toBe(first.getTime() + days * DAY_MS);
    expect(row.viewCount).toBe(1);
    expect(row.lastViewedAt?.getTime()).toBe(first.getTime());

    const second = addDays(first, 1);
    expect(await recordSharePlay(share.code, second)).toEqual({ recorded: true, firstPlay: false });
    row = await read(share.code);
    expect(row.firstPlayedAt?.getTime()).toBe(first.getTime());
    expect(row.expiresAt.getTime()).toBe(first.getTime() + days * DAY_MS);
    expect(row.viewCount).toBe(2);
    expect(row.lastViewedAt?.getTime()).toBe(second.getTime());
  });

  it("is decided by the first-play fields, not by the count: a link whose first play is recorded does not move again even with a count of zero", async () => {
    // A first-play link whose count was somehow reset. Nothing in the app does this; the point is that
    // the count is not what the rule looks at.
    const share = await createShare(clinic, video, { now: T });
    const moved = addDays(T, 7);
    await prisma.share.update({ where: { id: share.id }, data: { firstPlayedAt: T, expiresAt: moved, viewCount: 0 } });

    expect(await recordSharePlay(share.code, addDays(T, 1))).toEqual({ recorded: true, firstPlay: false });
    const row = await read(share.code);
    expect(row.expiresAt.getTime()).toBe(moved.getTime());
    expect(row.firstPlayedAt?.getTime()).toBe(T.getTime());
    expect(row.viewCount).toBe(1);
  });

  it("two first plays at once move the deadline exactly once and count both", async () => {
    // Three rounds, because which call wins is up to the database each time.
    for (let round = 0; round < 3; round++) {
      const share = await createShare(clinic, video, { now: T });
      const days = (await read(share.code)).daysAfterFirstPlay!;
      const at = addDays(T, 1);

      const results = await Promise.all([recordSharePlay(share.code, at), recordSharePlay(share.code, at), recordSharePlay(share.code, at)]);

      expect(results.every((r) => r.recorded)).toBe(true);
      expect(results.filter((r) => r.recorded && r.firstPlay)).toHaveLength(1);
      const row = await read(share.code);
      expect(row.viewCount).toBe(3);
      expect(row.firstPlayedAt?.getTime()).toBe(at.getTime());
      expect(row.expiresAt.getTime()).toBe(at.getTime() + days * DAY_MS);
    }
  });

  it("just before the unclaimed deadline still works, and may carry the link past that deadline", async () => {
    const share = await createShare(clinic, video, { now: T });
    const days = (await read(share.code)).daysAfterFirstPlay!;
    const deadline = addDays(T, 1);
    await prisma.share.update({ where: { id: share.id }, data: { expiresAt: deadline } });

    const justBefore = new Date(deadline.getTime() - 1000);
    expect(await recordSharePlay(share.code, justBefore)).toEqual({ recorded: true, firstPlay: true });
    const row = await read(share.code);
    expect(row.expiresAt.getTime()).toBe(justBefore.getTime() + days * DAY_MS);
    expect(row.expiresAt.getTime()).toBeGreaterThan(deadline.getTime());
  });

  it("at the exact deadline fails and writes nothing", async () => {
    const share = await createShare(clinic, video, { now: T });
    const deadline = addDays(T, 1);
    await prisma.share.update({ where: { id: share.id }, data: { expiresAt: deadline } });

    expect(await recordSharePlay(share.code, deadline)).toEqual({ recorded: false, reason: "expired" });
    const row = await read(share.code);
    expect(row.viewCount).toBe(0);
    expect(row.firstPlayedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBe(deadline.getTime());
  });

  it("after the deadline fails too, however long ago the page was opened: the server's clock decides, not the page", async () => {
    const share = await createShare(clinic, video, { now: T });
    const deadline = addDays(T, 1);
    await prisma.share.update({ where: { id: share.id }, data: { expiresAt: deadline } });

    expect(await recordSharePlay(share.code, new Date(deadline.getTime() + 1))).toEqual({ recorded: false, reason: "expired" });
    expect(await recordSharePlay(share.code, addDays(deadline, 30))).toEqual({ recorded: false, reason: "expired" });
    const row = await read(share.code);
    expect(row.viewCount).toBe(0);
    expect(row.firstPlayedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBe(deadline.getTime());
  });

  it("once the moved deadline has passed, the link is over: a play then writes nothing", async () => {
    const share = await createShare(clinic, video, { now: T });
    const days = (await read(share.code)).daysAfterFirstPlay!;
    await recordSharePlay(share.code, T);
    const moved = T.getTime() + days * DAY_MS;

    expect(await recordSharePlay(share.code, new Date(moved - 1))).toEqual({ recorded: true, firstPlay: false });
    expect(await recordSharePlay(share.code, new Date(moved))).toEqual({ recorded: false, reason: "expired" });
    expect((await read(share.code)).viewCount).toBe(2);
  });
});

describe("what cannot be claimed or counted at all", () => {
  it("a link to a video that is not published: nothing is written until it is published again", async () => {
    const ownVideo = await makeVideo();
    const share = await createShare(clinic, ownVideo, { now: T });
    await prisma.video.update({ where: { id: ownVideo }, data: { isPublished: false } });

    expect(await recordSharePlay(share.code, addDays(T, 1))).toEqual({ recorded: false, reason: "unpublished" });
    let row = await read(share.code);
    expect(row.viewCount).toBe(0);
    expect(row.firstPlayedAt).toBeNull();

    await prisma.video.update({ where: { id: ownVideo }, data: { isPublished: true } });
    expect(await recordSharePlay(share.code, addDays(T, 1))).toEqual({ recorded: true, firstPlay: true });
    row = await read(share.code);
    expect(row.viewCount).toBe(1);
  });

  it("a code that does not exist, and a link that was cancelled", async () => {
    expect(await recordSharePlay("nope00", T)).toEqual({ recorded: false, reason: "no-such-link" });

    const share = await createShare(clinic, video, { now: T });
    expect(await deleteShareForClinic(clinic, share.code)).toBe(true);
    expect(await recordSharePlay(share.code, T)).toEqual({ recorded: false, reason: "no-such-link" });
  });
});
