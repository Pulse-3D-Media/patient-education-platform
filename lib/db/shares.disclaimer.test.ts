import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DISCLAIMER } from "../education-note";
import { addDays } from "../expiry";
import { prisma } from "./client";
import { acceptShareDisclaimer, createShare, recordSharePlay, type DisclaimerRecord } from "./shares";

/**
 * The record of the "for education only" box on a patient link
 * (acceptShareDisclaimer), against the testing database, with a clock handed
 * in for every call:
 *
 *   - each call records one tick: the count goes up by one, the first time is
 *     set once and never moves, the version is the one ticked last;
 *   - an expired, paused, taken-down or unknown link gets nothing written and
 *     nothing back;
 *   - ticking is not playing: the deadline, the play count and the first play
 *     are untouched, so the link's clock never starts from a tick;
 *   - THE FORCED OVERLAP: a second tick is started while the first one's
 *     write is still uncommitted. It waits for the row, then counts too, and
 *     the first time stays the first one's. The control does the same overlap
 *     with a plain read-then-write and loses a tick and moves the first time,
 *     which is what the single UPDATE prevents, and proves this test would
 *     catch it being replaced.
 */

const V = DISCLAIMER.version;
const T = new Date("2026-10-09T15:00:00.000Z");
const hours = (n: number) => new Date(T.getTime() + n * 3_600_000);
/** How long the overlap waits to see whether the second tick is held: well over what an unblocked UPDATE takes against the remote branch. */
const WAIT_MS = 2000;

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinic = "";
let video = "";
let hiddenVideo = "";

beforeAll(async () => {
  const row = await prisma.clinic.create({
    data: { name: `Vitest disclaimer clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10 },
    select: { id: true },
  });
  clinic = row.id;
  createdClinicIds.push(clinic);
  for (const title of ["Vitest disclaimer video", "Vitest disclaimer video (to unpublish)"]) {
    const made = await prisma.video.create({
      data: { title, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", durationSeconds: 110, isPublished: true, isPlaceholder: true },
      select: { id: true },
    });
    createdVideoIds.push(made.id);
  }
  [video, hiddenVideo] = createdVideoIds;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function readRecord(code: string) {
  return prisma.share.findUniqueOrThrow({
    where: { code },
    select: {
      disclaimerFirstAcceptedAt: true,
      disclaimerAcceptances: true,
      disclaimerVersion: true,
      viewCount: true,
      expiresAt: true,
      firstPlayedAt: true,
      lastViewedAt: true,
    },
  });
}

describe("acceptShareDisclaimer", () => {
  it("records one tick per call: the first time once, the count each time, the version ticked last", async () => {
    const { code } = await createShare(clinic, video, { now: T });
    const before = await readRecord(code);
    expect(before.disclaimerAcceptances).toBe(0);
    expect(before.disclaimerFirstAcceptedAt).toBeNull();
    expect(before.disclaimerVersion).toBeNull();

    const first = await acceptShareDisclaimer(code, V, hours(1));
    expect(first.recorded).toBe(true);
    // What the route needs to hand out the video, from the same statement.
    expect(first).toMatchObject({ recorded: true, share: { expiresAt: before.expiresAt, video: { videoUrl: "https://example.com/vitest.mp4", muxPlaybackId: null, durationSeconds: 110 } } });

    await acceptShareDisclaimer(code, V, hours(2));
    await acceptShareDisclaimer(code, "2027-01-01", hours(3));
    const after = await readRecord(code);
    expect(after.disclaimerAcceptances).toBe(3);
    expect(after.disclaimerFirstAcceptedAt).toEqual(hours(1));
    expect(after.disclaimerVersion).toBe("2027-01-01");
  });

  it("is not a play: the deadline, the play count and the first play are untouched", async () => {
    const { code } = await createShare(clinic, video, { now: T });
    const before = await readRecord(code);
    await acceptShareDisclaimer(code, V, hours(1));
    const after = await readRecord(code);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.viewCount).toBe(0);
    expect(after.firstPlayedAt).toBeNull();
    expect(after.lastViewedAt).toBeNull();
  });

  it("works on a played link that is still working, and records nothing once it has paused", async () => {
    const { code } = await createShare(clinic, video, { now: T });
    expect(await recordSharePlay(code, T)).toEqual({ recorded: true, firstPlay: true });
    // Played at T with 10 days: working on day 9, paused on day 11.
    expect((await acceptShareDisclaimer(code, V, addDays(T, 9))).recorded).toBe(true);
    expect(await acceptShareDisclaimer(code, V, addDays(T, 11))).toEqual({ recorded: false });
    expect((await readRecord(code)).disclaimerAcceptances).toBe(1);
  });

  it("records nothing on an expired, taken-down or unknown link, and hands nothing back", async () => {
    const expired = await createShare(clinic, video, { now: T });
    const never = (await readRecord(expired.code)).expiresAt;
    // At the deadline itself the link is over, as everywhere else.
    expect(await acceptShareDisclaimer(expired.code, V, never)).toEqual({ recorded: false });

    const hidden = await createShare(clinic, hiddenVideo, { now: T });
    await prisma.video.update({ where: { id: hiddenVideo }, data: { isPublished: false } });
    expect(await acceptShareDisclaimer(hidden.code, V, hours(1))).toEqual({ recorded: false });
    await prisma.video.update({ where: { id: hiddenVideo }, data: { isPublished: true } });

    expect(await acceptShareDisclaimer(`zz${randomBytes(4).toString("hex")}`, V, hours(1))).toEqual({ recorded: false });

    for (const code of [expired.code, hidden.code]) {
      const row = await readRecord(code);
      expect(row.disclaimerAcceptances).toBe(0);
      expect(row.disclaimerFirstAcceptedAt).toBeNull();
      expect(row.disclaimerVersion).toBeNull();
    }
  });

  it("five ticks at once on one link count five, with one first time", async () => {
    const { code } = await createShare(clinic, video, { now: T });
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => acceptShareDisclaimer(code, V, hours(n))));
    expect(results.every((r) => r.recorded)).toBe(true);
    const row = await readRecord(code);
    expect(row.disclaimerAcceptances).toBe(5);
    expect([1, 2, 3, 4, 5].map((n) => hours(n).getTime())).toContain(row.disclaimerFirstAcceptedAt?.getTime());
  });
});

describe("the forced overlap: two ticks at once", () => {
  it("the second waits for the first's write, then counts too; the first time stays the first one's", async () => {
    const { code } = await createShare(clinic, video, { now: T });
    let secondDone = false;
    let second: Promise<DisclaimerRecord> | null = null;

    await prisma.$transaction(
      async (tx) => {
        // The first tick's UPDATE has run but not committed: it holds the link's row.
        expect((await acceptShareDisclaimer(code, V, hours(1), tx)).recorded).toBe(true);
        second = acceptShareDisclaimer(code, V, hours(2)).then((r) => {
          secondDone = true;
          return r;
        });
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        // Still waiting for the row.
        expect(secondDone).toBe(false);
      },
      { timeout: 20_000 },
    );

    expect((await second!).recorded).toBe(true);
    const row = await readRecord(code);
    expect(row.disclaimerAcceptances).toBe(2);
    expect(row.disclaimerFirstAcceptedAt).toEqual(hours(1));
  });

  it("control: a plain read-then-write loses a tick and moves the first time, which the single UPDATE prevents", async () => {
    const { code } = await createShare(clinic, video, { now: T });

    /** What a naive version would do: read the record, work the new one out in code, write it back. */
    async function naiveRead(db: Pick<Prisma.TransactionClient, "share">) {
      return db.share.findUniqueOrThrow({ where: { code }, select: { disclaimerAcceptances: true, disclaimerFirstAcceptedAt: true } });
    }
    async function naiveWrite(db: Pick<Prisma.TransactionClient, "share">, read: Awaited<ReturnType<typeof naiveRead>>, now: Date) {
      await db.share.update({
        where: { code },
        data: { disclaimerAcceptances: read.disclaimerAcceptances + 1, disclaimerFirstAcceptedAt: read.disclaimerFirstAcceptedAt ?? now, disclaimerVersion: V },
      });
    }

    let second: Promise<void> | null = null;
    await prisma.$transaction(
      async (tx) => {
        const firstRead = await naiveRead(tx);
        // The second tick reads before the first has written: it sees nothing recorded yet.
        const secondRead = await naiveRead(prisma);
        await naiveWrite(tx, firstRead, hours(1));
        second = naiveWrite(prisma, secondRead, hours(2));
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
      { timeout: 20_000 },
    );
    await second!;

    const row = await readRecord(code);
    expect(row.disclaimerAcceptances).toBe(1);
    expect(row.disclaimerFirstAcceptedAt).toEqual(hours(2));
  });
});
