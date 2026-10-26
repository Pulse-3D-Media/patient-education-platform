import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, DAY_MS, RENEWAL_EMAILS_PER_DAY } from "../expiry";
import { prisma } from "./client";
import { createShare, recordSharePlay, requestShareRenewal } from "./shares";

/**
 * The limit on "ask my clinic" emails (Prompt M): at most ten per clinic per
 * UTC day. Against the real testing database, with a clock handed in.
 *
 * What these prove: the first ten requests recorded at a clinic in a day
 * say "email the office", the eleventh is recorded (and so listed on the
 * overview) but says not to; the next UTC day the emails start again;
 * another clinic has its own ten; five requests at once on the tenth place
 * give that place to exactly one. The overlap itself, forced, is in
 * shares.renewal-email.race.test.ts.
 *
 * Every row is made here and deleted by id afterwards.
 */

vi.setConfig({ testTimeout: 60_000 });

const tag = () => randomBytes(4).toString("hex");
const createdClinicIds: string[] = [];
let video = "";

/** A fixed moment the links are made and first played at; they pause ten days later. */
const T = new Date("2026-09-25T15:00:00.000Z");
/** A moment on the day the links have paused (2026-10-06, UTC). */
const PAUSED = addDays(T, 11);

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: `Vitest renewal email video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function makeClinic() {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest renewal email clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10 },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

/** `count` links made and first played at T, so all of them have paused by PAUSED. */
async function pausedLinks(clinicId: string, count: number) {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const share = await createShare(clinicId, video, { now: T });
    expect(await recordSharePlay(share.code, T)).toEqual({ recorded: true, firstPlay: true });
    codes.push(share.code);
  }
  return codes;
}

/** Write `count` requests recorded at `at` straight into the table, standing in for earlier taps today. */
async function earlierRequests(clinicId: string, count: number, at: Date) {
  await prisma.share.createMany({
    data: Array.from({ length: count }, () => ({
      code: `r${randomBytes(8).toString("hex")}`,
      clinicId,
      videoId: video,
      expiresAt: T,
      renewalRequestedAt: at,
      renewalRequests: 1,
    })),
  });
}

describe("the renewal email limit", () => {
  it("is ten: the first ten requests of the day email the office, the eleventh is recorded with no email", async () => {
    expect(RENEWAL_EMAILS_PER_DAY).toBe(10);
    const clinic = await makeClinic();
    const codes = await pausedLinks(clinic, 11);

    const emailed: boolean[] = [];
    for (const [i, code] of codes.entries()) {
      const outcome = await requestShareRenewal(code, new Date(PAUSED.getTime() + i * 60_000));
      expect(outcome.kind).toBe("requested");
      if (outcome.kind === "requested") emailed.push(outcome.emailClinic);
    }
    expect(emailed).toEqual([...Array(10).fill(true), false]);

    // All eleven are recorded, so all eleven are on the overview's waiting list.
    const recorded = await prisma.share.count({ where: { code: { in: codes }, renewalRequestedAt: { not: null } } });
    expect(recorded).toBe(11);
  });

  it("starts again at midnight UTC", async () => {
    const clinic = await makeClinic();
    await earlierRequests(clinic, RENEWAL_EMAILS_PER_DAY, PAUSED);
    const [late, nextDay] = await pausedLinks(clinic, 2);

    const lastMoment = new Date(Date.UTC(2026, 9, 6, 23, 59, 59, 999));
    const sameDay = await requestShareRenewal(late, lastMoment);
    expect(sameDay).toMatchObject({ kind: "requested", emailClinic: false });

    const midnight = new Date(Date.UTC(2026, 9, 7));
    const after = await requestShareRenewal(nextDay, midnight);
    expect(after).toMatchObject({ kind: "requested", emailClinic: true });
    expect(midnight.getTime() - lastMoment.getTime()).toBeLessThan(DAY_MS);
  });

  it("is per clinic: another clinic's ten do not use up this one's", async () => {
    const busy = await makeClinic();
    await earlierRequests(busy, RENEWAL_EMAILS_PER_DAY, PAUSED);
    const quiet = await makeClinic();
    const [code] = await pausedLinks(quiet, 1);
    expect(await requestShareRenewal(code, PAUSED)).toMatchObject({ kind: "requested", emailClinic: true });
  });

  it("gives the tenth email to exactly one of five requests arriving at once, and records all five", async () => {
    const clinic = await makeClinic();
    await earlierRequests(clinic, RENEWAL_EMAILS_PER_DAY - 1, PAUSED);
    const codes = await pausedLinks(clinic, 5);

    const outcomes = await Promise.all(codes.map((code) => requestShareRenewal(code, PAUSED)));
    expect(outcomes.every((one) => one.kind === "requested")).toBe(true);
    expect(outcomes.filter((one) => one.kind === "requested" && one.emailClinic)).toHaveLength(1);
    expect(await prisma.share.count({ where: { code: { in: codes }, renewalRequestedAt: { not: null } } })).toBe(5);
  });
});
