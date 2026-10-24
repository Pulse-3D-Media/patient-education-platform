import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "../expiry";
import * as access from "./access";
import { prisma } from "./client";
import { createShare, recordSharePlay, renewShareForClinic, type RenewalOutcome } from "./shares";

/**
 * The forced overlap: two admins (or one double click) turn the same paused
 * link back on at the same moment. The second request is started AFTER the
 * first has read the link and BEFORE the first writes. With the row lock
 * (lockShareForRenewal in lib/db/access.ts) the second has to wait until the
 * first has committed, then reads a link that is already working and does
 * nothing: one renewal, one log entry, and the second admin told so.
 *
 * The control does the same overlap with a plain read, no lock: the second
 * request gets through during the gap, both admins are told "Done", the
 * link is counted as turned back on twice and the log says so twice. That
 * is what the lock prevents, and it proves this test would catch its removal.
 */

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, lockShareForRenewal: vi.fn(actual.lockShareForRenewal) };
});

const real = await vi.importActual<typeof import("./access")>("./access");

/**
 * How long the wrapper waits for the second request. An unblocked one is a
 * whole transaction against the remote testing branch (a few round trips):
 * usually well under a second, but on a slow day more, so two seconds, as
 * seats.race.test.ts waits, so the control cannot fail for slowness alone.
 */
const WAIT_MS = 2000;

const T = new Date("2026-09-25T15:00:00.000Z");
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinic = "";
let video = "";

beforeAll(async () => {
  const row = await prisma.clinic.create({
    data: { name: `Vitest renewal race clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10 },
    select: { id: true },
  });
  clinic = row.id;
  createdClinicIds.push(clinic);
  const made = await prisma.video.create({
    data: { title: "Vitest renewal race video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  video = made.id;
  createdVideoIds.push(video);
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** A link played at T, so it has paused by T + 11 days. */
async function makePaused() {
  const share = await createShare(clinic, video, { now: T });
  expect(await recordSharePlay(share.code, T)).toEqual({ recorded: true, firstPlay: true });
  return share.code;
}

/** The same read as the real one, with no lock: what a reactivation would do without the row lock. */
async function readPlain(tx: Prisma.TransactionClient, clinicId: string, shareId: string) {
  const rows = await tx.$queryRaw<access.LockedShareRow[]>`
    SELECT s."id", s."code", s."expiryPolicy"::text AS "expiryPolicy", s."expiresAt", s."firstPlayedAt", s."daysAfterFirstPlay",
           s."renewalsUsed", s."renewalRequestedAt", v."title" AS "videoTitle", v."isPublished" AS "videoIsPublished",
           v."category"::text AS "videoCategory", v."isPlaceholder" AS "videoIsPlaceholder"
    FROM "Share" s
    JOIN "Video" v ON v."id" = s."videoId"
    WHERE s."id" = ${shareId} AND s."clinicId" = ${clinicId}`;
  return rows[0] ?? null;
}

/**
 * Turn a link back on while a second request for the same link starts in
 * the middle: after the first has read the link (with the read given) and
 * before it writes. Returns both outcomes and whether the second had
 * already finished when the first went on to write.
 */
async function renewWhileAnotherStarts(code: string, read = real.lockShareForRenewal) {
  const now = addDays(T, 11);
  // The clinic side names a link by its row id, never its code.
  const { id } = await prisma.share.findUniqueOrThrow({ where: { code }, select: { id: true } });
  let secondFinishedDuringWait = false;
  let second: Promise<RenewalOutcome> = Promise.resolve({ ok: false, reason: "no-such-link", message: "" });

  vi.mocked(access.lockShareForRenewal).mockImplementationOnce(async (tx, clinicId, wanted) => {
    const row = await read(tx, clinicId, wanted);
    let done = false;
    second = renewShareForClinic(clinic, id, "Second admin", now).then((outcome) => {
      done = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    secondFinishedDuringWait = done;
    return row;
  });

  const first = await renewShareForClinic(clinic, id, "First admin", now);
  return { first, second: await second, secondFinishedDuringWait };
}

describe("two reactivations of the same link at once", () => {
  it("renew once: the second waits for the first, then finds the link already working", { timeout: 20_000 }, async () => {
    const code = await makePaused();
    const { first, second, secondFinishedDuringWait } = await renewWhileAnotherStarts(code);

    expect(secondFinishedDuringWait).toBe(false);
    expect(first).toMatchObject({ ok: true, renewalsUsed: 1 });
    expect(second).toMatchObject({ ok: false, reason: "working" });

    const row = await prisma.share.findUniqueOrThrow({ where: { code } });
    expect(row.renewalsUsed).toBe(1);
    expect(row.expiresAt).toEqual(addDays(T, 21));
    const notes = await prisma.clinicNote.findMany({ where: { clinicId: clinic, body: { contains: `Link ${code}` } } });
    expect(notes).toHaveLength(1);
    expect(notes[0].authorName).toBe("First admin (clinic admin)");
  });

  it("control: with a plain read and no lock, the second gets through and the link is turned back on twice", { timeout: 20_000 }, async () => {
    const code = await makePaused();
    const { first, second, secondFinishedDuringWait } = await renewWhileAnotherStarts(code, readPlain);

    expect(secondFinishedDuringWait).toBe(true);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const row = await prisma.share.findUniqueOrThrow({ where: { code } });
    expect(row.renewalsUsed).toBe(2);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic, body: { contains: `Link ${code}` } } })).toBe(2);
  });
});

/**
 * The plan check (decided by Evan on 2026-10-08) reads the video's category
 * and placeholder mark, and the clinic's plan, under locks, like
 * createShare(). Here a change that would make the plan refuse the link is
 * started AFTER the reactivation has read and BEFORE it writes. With the
 * locks the change waits until the link is turned back on (and then applies
 * to every later reactivation); it can never land in between and leave a
 * link turned back on under a plan that already refused it. The control,
 * with the plain read, shows the video change getting through in the gap.
 */
describe("a change the plan check depends on, arriving while a link is turned back on", () => {
  /** A clinic set to finished animations only, a finished Knee animation, and a link to it that has paused. */
  async function makeFinishedPaused() {
    const row = await prisma.clinic.create({
      data: { name: `Vitest renewal plan race ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10, showPlaceholders: false },
      select: { id: true },
    });
    createdClinicIds.push(row.id);
    const made = await prisma.video.create({
      data: { title: "Vitest renewal plan race video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: false },
      select: { id: true },
    });
    createdVideoIds.push(made.id);
    const share = await createShare(row.id, made.id, { now: T });
    expect(await recordSharePlay(share.code, T)).toEqual({ recorded: true, firstPlay: true });
    return { clinicId: row.id, videoId: made.id, shareId: share.id };
  }

  /** Turn the link back on while `change` starts in the gap. Says whether the change had finished when the reactivation went on to write. */
  async function renewWhileChanging(clinicId: string, shareId: string, change: () => Promise<unknown>, read = real.lockShareForRenewal) {
    let changeFinishedDuringWait = false;
    let changing: Promise<unknown> = Promise.resolve();
    vi.mocked(access.lockShareForRenewal).mockImplementationOnce(async (tx, id, wanted) => {
      const row = await read(tx, id, wanted);
      let done = false;
      changing = change().then(() => {
        done = true;
      });
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      changeFinishedDuringWait = done;
      return row;
    });
    const outcome = await renewShareForClinic(clinicId, shareId, "First admin", addDays(T, 11));
    await changing;
    return { outcome, changeFinishedDuringWait };
  }

  it("the video being marked a placeholder waits for the reactivation, and the next one is refused", { timeout: 20_000 }, async () => {
    const { clinicId, videoId, shareId } = await makeFinishedPaused();
    const { outcome, changeFinishedDuringWait } = await renewWhileChanging(clinicId, shareId, () =>
      prisma.video.update({ where: { id: videoId }, data: { isPlaceholder: true } }),
    );
    expect(changeFinishedDuringWait).toBe(false);
    expect(outcome).toMatchObject({ ok: true, renewalsUsed: 1 });

    // Once it has paused again, the change that landed is seen.
    expect(await renewShareForClinic(clinicId, shareId, "First admin", addDays(T, 22))).toMatchObject({ ok: false, reason: "placeholder-hidden" });
  });

  it("the category leaving the plan waits for the reactivation (the clinic's lock)", { timeout: 20_000 }, async () => {
    const { clinicId, shareId } = await makeFinishedPaused();
    const { outcome, changeFinishedDuringWait } = await renewWhileChanging(clinicId, shareId, () =>
      prisma.clinic.update({ where: { id: clinicId }, data: { categories: [] } }),
    );
    expect(changeFinishedDuringWait).toBe(false);
    expect(outcome).toMatchObject({ ok: true, renewalsUsed: 1 });
    expect(await renewShareForClinic(clinicId, shareId, "First admin", addDays(T, 22))).toMatchObject({ ok: false, reason: "not-on-plan" });
  });

  it("control: with a plain read and no video lock, the placeholder mark lands in the gap and the link is turned back on anyway", { timeout: 20_000 }, async () => {
    const { clinicId, videoId, shareId } = await makeFinishedPaused();
    const { outcome, changeFinishedDuringWait } = await renewWhileChanging(
      clinicId,
      shareId,
      () => prisma.video.update({ where: { id: videoId }, data: { isPlaceholder: true } }),
      readPlain,
    );
    expect(changeFinishedDuringWait).toBe(true);
    // Turned back on for a video that, by the time it was written, the clinic was no longer shown.
    expect(outcome.ok).toBe(true);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: videoId } })).isPlaceholder).toBe(true);
  });
});
