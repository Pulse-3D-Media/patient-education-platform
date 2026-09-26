import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, DAY_MS, renewalState } from "../expiry";
import { prisma } from "./client";
import { getSettings } from "./settings";
import { createShare, listRenewalRequestsForClinic, recordSharePlay, renewShareForClinic, requestShareRenewal } from "./shares";

/**
 * Pausing and reactivation against the real test database.
 *
 * What these prove: a played link works on day 9 and has paused on day 11;
 * a patient's request is written once per link per day, five taps at once
 * write one, and a request writes one timestamp and nothing else; the
 * clinic can turn a paused link back on for the days it was issued with,
 * up to the maximum, and then it is finished; a working link, a legacy
 * link, one nobody played, one whose video is not published, another
 * clinic's link, a code nobody has, and a clinic that is not open are all
 * refused with nothing written; legacy links behave exactly as before; and
 * the overview's waiting list holds only this clinic's paused links a
 * patient asked about, and drops a link the moment it is turned back on.
 *
 * Every test hands in its own clock. Each clinic here is given its own
 * number of days after the first play (10), so "day 9" and "day 11" hold
 * whatever the testing branch's settings say. The maximum number of
 * renewals is the platform setting as it is on the testing branch, read
 * once at the start; the tests work from whatever it holds, as long as it
 * is at least one.
 */

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

const tag = () => randomBytes(4).toString("hex");

/** A fixed moment: every date below is a number that can be checked by hand. */
const T = new Date("2026-09-25T15:00:00.000Z");

/** An open clinic with Knee on its plan and ten days after the first play. */
async function makeClinic(data: Parameters<typeof prisma.clinic.create>[0]["data"] extends infer D ? Partial<D> : never = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest renewal clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10, ...data },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeVideo(isPublished = true) {
  const video = await prisma.video.create({
    data: { title: `Vitest renewal video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

/** A link made at T and first played at T, so it works until T + 10 days and has paused from then on. */
async function makePlayed(clinicId: string, videoId: string, playedAt: Date = T) {
  const share = await createShare(clinicId, videoId, { now: T });
  expect(await recordSharePlay(share.code, playedAt)).toEqual({ recorded: true, firstPlay: true });
  return share.code;
}

/** A link the way every link was written before the first-play rule: no policy, so the database makes it FIXED. */
async function makeLegacy(clinicId: string, videoId: string, expiresAt: Date) {
  const share = await prisma.share.create({ data: { code: `l${tag().slice(0, 5)}`, clinicId, videoId, expiresAt, viewCount: 3 }, select: { code: true } });
  return share.code;
}

async function read(code: string) {
  return prisma.share.findUniqueOrThrow({ where: { code } });
}

async function notesFor(clinicId: string) {
  return prisma.clinicNote.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" } });
}

let clinic = "";
let video = "";
let max = 0;

beforeAll(async () => {
  clinic = await makeClinic();
  video = await makeVideo();
  max = (await getSettings()).maxRenewals;
  // The testing branch's settings row decides the maximum; these tests need at least one renewal to exist.
  expect(max).toBeGreaterThanOrEqual(1);
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("when a played link runs out", () => {
  it("plays on day 9, and on day 11 it has paused: no play is counted, and it can be asked about", async () => {
    const code = await makePlayed(clinic, video);

    expect(await recordSharePlay(code, addDays(T, 9))).toEqual({ recorded: true, firstPlay: false });
    expect(await recordSharePlay(code, addDays(T, 11))).toEqual({ recorded: false, reason: "expired" });

    const row = await read(code);
    expect(renewalState(row, max, addDays(T, 9))).toEqual({ kind: "working" });
    expect(renewalState(row, max, addDays(T, 11))).toEqual({ kind: "paused", renewalsLeft: max, daysPerRenewal: 10 });
    expect(row.viewCount).toBe(2);
  });

  it("is finished, not paused, when nobody ever played it and its unclaimed days ran out", async () => {
    const settings = await getSettings();
    const share = await createShare(clinic, video, { now: T });
    const after = addDays(T, settings.unclaimedDays + 1);
    expect(renewalState(await read(share.code), max, after)).toEqual({ kind: "finished", reason: "never-played" });
    expect(await requestShareRenewal(share.code, after)).toEqual({ kind: "refused", reason: "not-paused" });
    expect((await renewShareForClinic(clinic, share.code, "Pat Lee", after)).ok).toBe(false);
  });
});

describe("the patient's request", () => {
  it("is written once, says what the clinic will be told, and a second tap within a day writes nothing and is 'already asked'", async () => {
    const code = await makePlayed(clinic, video);
    const paused = addDays(T, 11);

    const first = await requestShareRenewal(code, paused);
    expect(first.kind).toBe("requested");
    if (first.kind !== "requested") throw new Error("unreachable");
    expect(first.facts).toMatchObject({ code, senderName: null, renewalsLeft: max, daysPerRenewal: 10, requestedAt: paused, clinic: { id: clinic } });
    expect(first.facts.videoTitle).toMatch(/^Vitest renewal video/);
    expect((await read(code)).renewalRequestedAt?.getTime()).toBe(paused.getTime());

    const again = await requestShareRenewal(code, new Date(paused.getTime() + 60 * 60 * 1000));
    expect(again).toEqual({ kind: "already-asked" });
    expect((await read(code)).renewalRequestedAt?.getTime()).toBe(paused.getTime());

    // A day later the patient may ask again, and the clinic is told again.
    const nextDay = new Date(paused.getTime() + DAY_MS);
    expect((await requestShareRenewal(code, nextDay)).kind).toBe("requested");
    expect((await read(code)).renewalRequestedAt?.getTime()).toBe(nextDay.getTime());
    // One tick short of a day is still inside it.
    const justBefore = new Date(nextDay.getTime() + DAY_MS - 1);
    expect(await requestShareRenewal(code, justBefore)).toEqual({ kind: "already-asked" });
  });

  it("five taps at once write one request", async () => {
    const code = await makePlayed(clinic, video);
    const paused = addDays(T, 12);
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => requestShareRenewal(code, paused)));
    expect(outcomes.filter((one) => one.kind === "requested")).toHaveLength(1);
    expect(outcomes.filter((one) => one.kind === "already-asked")).toHaveLength(4);
  });

  it("writes one timestamp and nothing else: no other column of the link changes, and no other table gains a row", async () => {
    const code = await makePlayed(clinic, video);
    const before = await read(code);
    const notesBefore = await prisma.clinicNote.count({ where: { clinicId: clinic } });

    expect((await requestShareRenewal(code, addDays(T, 11))).kind).toBe("requested");

    const after = await read(code);
    const { renewalRequestedAt: wasNull, ...restBefore } = before;
    const { renewalRequestedAt: nowSet, ...restAfter } = after;
    expect(wasNull).toBeNull();
    expect(nowSet).toEqual(addDays(T, 11));
    expect(restAfter).toEqual(restBefore);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic } })).toBe(notesBefore);
  });

  it("is refused for a working link, a legacy link, a link whose video is not published, and a code nobody has, with nothing written", { timeout: 30_000 }, async () => {
    const working = await makePlayed(clinic, video);
    expect(await requestShareRenewal(working, addDays(T, 5))).toEqual({ kind: "refused", reason: "not-paused" });

    const legacy = await makeLegacy(clinic, video, addDays(T, -1));
    expect(await requestShareRenewal(legacy, T)).toEqual({ kind: "refused", reason: "not-paused" });

    const hidden = await makeVideo(true);
    const toHidden = await makePlayed(clinic, hidden);
    await prisma.video.update({ where: { id: hidden }, data: { isPublished: false } });
    expect(await requestShareRenewal(toHidden, addDays(T, 11))).toEqual({ kind: "refused", reason: "unpublished" });

    expect(await requestShareRenewal("nosuch", T)).toEqual({ kind: "refused", reason: "no-such-link" });

    for (const code of [working, legacy, toHidden]) expect((await read(code)).renewalRequestedAt).toBeNull();
  });
});

describe("the clinic turning a link back on", () => {
  it("gives the link its own days from that moment, counts the renewal, clears the request, and writes one log entry", { timeout: 30_000 }, async () => {
    const code = await makePlayed(clinic, video);
    const paused = addDays(T, 11);
    expect((await requestShareRenewal(code, paused)).kind).toBe("requested");
    const notesBefore = (await notesFor(clinic)).length;

    const outcome = await renewShareForClinic(clinic, code, "Pat Lee", addDays(T, 12));
    expect(outcome).toMatchObject({ ok: true, expiresAt: addDays(T, 22), renewalsUsed: 1, renewalsLeft: max - 1 });
    expect(outcome.message).toContain("Done. The link works again until");

    const row = await read(code);
    expect(row.expiresAt).toEqual(addDays(T, 22));
    expect(row.renewalsUsed).toBe(1);
    expect(row.lastRenewedAt).toEqual(addDays(T, 12));
    expect(row.renewalRequestedAt).toBeNull();
    // The first play is history; it is not moved or repeated.
    expect(row.firstPlayedAt).toEqual(T);

    const notes = await notesFor(clinic);
    expect(notes).toHaveLength(notesBefore + 1);
    expect(notes.at(-1)).toMatchObject({ kind: "STATUS", authorName: "Pat Lee (clinic admin)" });
    expect(notes.at(-1)?.body).toContain(`Link ${code}`);
    expect(notes.at(-1)?.body).toContain(`renewal 1 of ${max}`);

    // Plays count again, and the deadline stays where the renewal put it.
    expect(await recordSharePlay(code, addDays(T, 13))).toEqual({ recorded: true, firstPlay: false });
    expect((await read(code)).expiresAt).toEqual(addDays(T, 22));
  });

  it("can be done the maximum number of times, each for ten days, and then the link is finished", { timeout: 30_000 }, async () => {
    const code = await makePlayed(clinic, video);
    let clock = addDays(T, 11);
    for (let renewal = 1; renewal <= max; renewal++) {
      const outcome = await renewShareForClinic(clinic, code, "Pat Lee", clock);
      expect(outcome).toMatchObject({ ok: true, renewalsUsed: renewal, renewalsLeft: max - renewal, expiresAt: addDays(clock, 10) });
      if (renewal === max) expect(outcome.message).toContain("That was its last renewal.");
      // It works again until then, and has paused (or finished) the day after.
      expect(await recordSharePlay(code, addDays(clock, 9))).toEqual({ recorded: true, firstPlay: false });
      clock = addDays(clock, 11);
    }

    const row = await read(code);
    expect(row.renewalsUsed).toBe(max);
    expect(renewalState(row, max, clock)).toEqual({ kind: "finished", reason: "no-renewals-left" });
    expect(await requestShareRenewal(code, clock)).toEqual({ kind: "refused", reason: "not-paused" });
    const refused = await renewShareForClinic(clinic, code, "Pat Lee", clock);
    expect(refused).toMatchObject({ ok: false, reason: "finished" });
    expect(refused.message).toContain("the maximum");
    expect((await read(code)).renewalsUsed).toBe(max);
  });

  it("refuses a working link, a legacy link, one nobody played, and one whose video is not published, writing nothing", { timeout: 30_000 }, async () => {
    const notesBefore = (await notesFor(clinic)).length;

    const working = await makePlayed(clinic, video);
    const stillWorking = await renewShareForClinic(clinic, working, "Pat Lee", addDays(T, 5));
    expect(stillWorking).toMatchObject({ ok: false, reason: "working" });
    expect(stillWorking.message).toContain("already working");

    const legacy = await makeLegacy(clinic, video, addDays(T, -1));
    const legacyOutcome = await renewShareForClinic(clinic, legacy, "Pat Lee", T);
    expect(legacyOutcome).toMatchObject({ ok: false, reason: "finished" });
    expect(legacyOutcome.message).toContain("older rule");

    const settings = await getSettings();
    const unplayed = await createShare(clinic, video, { now: T });
    const neverPlayed = await renewShareForClinic(clinic, unplayed.code, "Pat Lee", addDays(T, settings.unclaimedDays + 1));
    expect(neverPlayed).toMatchObject({ ok: false, reason: "finished" });
    expect(neverPlayed.message).toContain("never played");

    const hidden = await makeVideo(true);
    const toHidden = await makePlayed(clinic, hidden);
    await prisma.video.update({ where: { id: hidden }, data: { isPublished: false } });
    expect(await renewShareForClinic(clinic, toHidden, "Pat Lee", addDays(T, 11))).toMatchObject({ ok: false, reason: "unpublished" });

    for (const code of [working, legacy, unplayed.code, toHidden]) {
      const row = await read(code);
      expect(row.renewalsUsed).toBe(0);
      expect(row.lastRenewedAt).toBeNull();
    }
    expect((await notesFor(clinic)).length).toBe(notesBefore);
  });

  it("finds no link for another clinic's code or a forged one, so nothing is written", async () => {
    const other = await makeClinic();
    const code = await makePlayed(clinic, video);
    const paused = addDays(T, 11);

    expect(await renewShareForClinic(other, code, "Someone Else", paused)).toMatchObject({ ok: false, reason: "no-such-link" });
    expect(await renewShareForClinic(clinic, "zzzzzz", "Pat Lee", paused)).toMatchObject({ ok: false, reason: "no-such-link" });
    expect(await renewShareForClinic(clinic, "", "Pat Lee", paused)).toMatchObject({ ok: false, reason: "no-such-link" });

    expect((await read(code)).renewalsUsed).toBe(0);
    expect(await notesFor(other)).toHaveLength(0);
  });

  it("refuses a clinic that is not open: paused by Pulse, or past its grace period; a clinic still inside its grace period may", { timeout: 30_000 }, async () => {
    const pausedClinic = await makeClinic();
    const code = await makePlayed(pausedClinic, video);
    await prisma.clinic.update({ where: { id: pausedClinic }, data: { status: "PAUSED" } });
    const when = addDays(T, 11);
    const outcome = await renewShareForClinic(pausedClinic, code, "Pat Lee", when);
    expect(outcome).toMatchObject({ ok: false, reason: "clinic-closed" });
    expect(outcome.message).toContain("not open");
    expect((await read(code)).renewalsUsed).toBe(0);

    await prisma.clinic.update({ where: { id: pausedClinic }, data: { status: "PAST_DUE", graceEndsAt: addDays(when, -1) } });
    expect(await renewShareForClinic(pausedClinic, code, "Pat Lee", when)).toMatchObject({ ok: false, reason: "clinic-closed" });

    await prisma.clinic.update({ where: { id: pausedClinic }, data: { graceEndsAt: addDays(when, 1) } });
    expect(await renewShareForClinic(pausedClinic, code, "Pat Lee", when)).toMatchObject({ ok: true, renewalsUsed: 1 });
  });
});

describe("a legacy link", () => {
  it("behaves exactly as before: its fixed date is final, plays after it are not counted, and it is never paused", async () => {
    const code = await makeLegacy(clinic, video, addDays(T, -1));
    const before = await read(code);

    expect(await recordSharePlay(code, T)).toEqual({ recorded: false, reason: "expired" });
    expect(renewalState(before, max, T)).toEqual({ kind: "finished", reason: "legacy" });
    expect(await requestShareRenewal(code, T)).toEqual({ kind: "refused", reason: "not-paused" });
    expect((await renewShareForClinic(clinic, code, "Pat Lee", T)).ok).toBe(false);

    expect(await read(code)).toEqual(before);
  });
});

describe("the overview's waiting list", () => {
  // Several links are made and played here against the remote testing branch; the default five seconds is not enough on a slow day.
  it("holds this clinic's paused links a patient asked about, newest request first, and nothing else", { timeout: 30_000 }, async () => {
    const mine = await makeClinic();
    const theirs = await makeClinic();
    const paused = addDays(T, 11);

    const askedFirst = await makePlayed(mine, video);
    const askedSecond = await makePlayed(mine, video);
    const pausedNotAsked = await makePlayed(mine, video);
    const workingButMarked = await makePlayed(mine, video, addDays(T, 5)); // played later, so it works until T + 15
    const otherClinics = await makePlayed(theirs, video);

    expect((await requestShareRenewal(askedFirst, paused)).kind).toBe("requested");
    expect((await requestShareRenewal(askedSecond, new Date(paused.getTime() + 1000))).kind).toBe("requested");
    expect((await requestShareRenewal(otherClinics, paused)).kind).toBe("requested");
    // A request timestamp on a link that is working (nothing in the app writes this) is not a waiting link.
    await prisma.share.update({ where: { code: workingButMarked }, data: { renewalRequestedAt: paused } });
    void pausedNotAsked;

    const list = await listRenewalRequestsForClinic(mine, 10, addDays(T, 12));
    expect(list.map((row) => row.code)).toEqual([askedSecond, askedFirst]);
    expect(list[0]).toMatchObject({ renewalsLeft: max, daysPerRenewal: 10, isPlaceholder: true, senderName: null });
    expect(list[0].videoTitle).toMatch(/^Vitest renewal video/);
    expect(list[0].requestedAt.getTime()).toBe(paused.getTime() + 1000);

    // Bounded, and turning one back on takes it off the list.
    expect(await listRenewalRequestsForClinic(mine, 1, addDays(T, 12))).toHaveLength(1);
    expect((await renewShareForClinic(mine, askedSecond, "Pat Lee", addDays(T, 12))).ok).toBe(true);
    expect((await listRenewalRequestsForClinic(mine, 10, addDays(T, 12))).map((row) => row.code)).toEqual([askedFirst]);
    expect((await listRenewalRequestsForClinic(theirs, 10, addDays(T, 12))).map((row) => row.code)).toEqual([otherClinics]);
  });

  it("drops a link that can no longer be turned back on", async () => {
    const mine = await makeClinic();
    const code = await makePlayed(mine, video);
    const paused = addDays(T, 11);
    expect((await requestShareRenewal(code, paused)).kind).toBe("requested");
    expect(await listRenewalRequestsForClinic(mine, 10, paused)).toHaveLength(1);

    await prisma.share.update({ where: { code }, data: { renewalsUsed: max } });
    expect(await listRenewalRequestsForClinic(mine, 10, paused)).toHaveLength(0);
  });
});
