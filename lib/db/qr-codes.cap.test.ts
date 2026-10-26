import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { effectiveQrDailyCap, utcDayStart } from "../qr-code";
import { SETTINGS_DEFAULTS } from "../settings-defaults";
import { prisma } from "./client";
import { createQrCode, listFlaggedQrCodesToday } from "./qr-codes";
import { getSettings } from "./settings";
import { issueShareFromQrCode } from "./shares";

/**
 * The daily limit on a printed QR code (Prompt M), against the real testing
 * database. What these prove:
 *
 *   - a code hands out its limit's worth of links in a UTC day, and the next
 *     tap gets nothing, with nothing written;
 *   - links from yesterday do not count, so the next UTC day it works again;
 *   - another code at the same clinic is not affected;
 *   - a visit that already got its link still gets it back after the limit;
 *   - five taps at once on the last place: one link, four refusals;
 *   - fifty visits in a row (the security audit's script) each get a link,
 *     because fifty is well under the limit;
 *   - the flagged list Pulse staff see: codes at or over the flag today,
 *     busiest first, from every clinic.
 *
 * The limit is whatever the testing branch's settings row holds (200 unless
 * someone changed it), read once at the start. To reach it without hundreds
 * of taps, the tests write the earlier links straight into the table, the way
 * the Pulse counting test does. Every row is made here and deleted by id.
 */

vi.setConfig({ testTimeout: 60_000 });

const tag = () => randomBytes(6).toString("hex");
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let video = "";
let cap = 0;

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: `Vitest QR cap video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
  createdVideoIds.push(video);
  cap = effectiveQrDailyCap((await getSettings()).qrDailyCap, SETTINGS_DEFAULTS.qrDailyCap);
  // Fifty visits must fit under the limit for the audit's test below to mean anything.
  expect(cap).toBeGreaterThan(50);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** An open Knee clinic with one seated surgeon, and a live printed code for `videoId`. */
async function liveCode(videoId = video, name = `Vitest QR cap clinic ${tag()}`) {
  const surgeon = `user_qrcap${tag()}`;
  const clinic = await prisma.clinic.create({
    data: { name, status: "ACTIVE", categories: ["KNEE"], surgeonSeats: 2, seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED" } } },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const made = await createQrCode(clinic.id, videoId, { clerkUserId: surgeon, fallbackName: "Dr. Cap" }, "Vitest");
  const code = (await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id }, select: { code: true } })).code;
  return { clinic: clinic.id, id: made.id, code, videoId };
}

/** Write `count` links this code "handed out" at `createdAt`, straight into the table. */
async function handedOut(qr: { clinic: string; id: string; videoId: string }, count: number, createdAt: Date) {
  await prisma.share.createMany({
    data: Array.from({ length: count }, () => ({
      code: `t${randomBytes(8).toString("hex")}`,
      clinicId: qr.clinic,
      videoId: qr.videoId,
      qrCodeId: qr.id,
      expiresAt: new Date(createdAt.getTime() + 90 * 86_400_000),
      createdAt,
    })),
  });
}

const linksFrom = (id: string) => prisma.share.count({ where: { qrCodeId: id } });

describe("the daily limit on a printed code", () => {
  it("hands out the limit's last link, then nothing: the next tap is refused and writes nothing", async () => {
    const qr = await liveCode();
    await handedOut(qr, cap - 1, new Date());

    expect((await issueShareFromQrCode(qr.code, randomUUID())).ok).toBe(true);
    expect(await linksFrom(qr.id)).toBe(cap);

    expect(await issueShareFromQrCode(qr.code, randomUUID())).toEqual({ ok: false, reason: "daily-cap" });
    expect(await linksFrom(qr.id)).toBe(cap);
  });

  it("does not count yesterday: a code that handed out its limit yesterday works today", async () => {
    const qr = await liveCode();
    await handedOut(qr, cap, new Date(utcDayStart(new Date()).getTime() - 1));
    expect((await issueShareFromQrCode(qr.code, randomUUID())).ok).toBe(true);
  });

  it("is per code: another code at the same clinic keeps handing out links", async () => {
    const full = await liveCode();
    await handedOut(full, cap, new Date());
    expect(await issueShareFromQrCode(full.code, randomUUID())).toEqual({ ok: false, reason: "daily-cap" });

    const otherVideo = (
      await prisma.video.create({
        data: { title: `Vitest QR cap video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
        select: { id: true },
      })
    ).id;
    createdVideoIds.push(otherVideo);
    const surgeon = (await prisma.qrCode.findUniqueOrThrow({ where: { id: full.id }, select: { senderUserId: true } })).senderUserId;
    const other = await createQrCode(full.clinic, otherVideo, { clerkUserId: surgeon, fallbackName: "Dr. Cap" }, "Vitest");
    const otherCode = (await prisma.qrCode.findUniqueOrThrow({ where: { id: other.id }, select: { code: true } })).code;
    expect((await issueShareFromQrCode(otherCode, randomUUID())).ok).toBe(true);
  });

  it("still gives a visit that already got its link the same link back after the limit is reached", async () => {
    const qr = await liveCode();
    await handedOut(qr, cap - 1, new Date());
    const key = randomUUID();
    const first = await issueShareFromQrCode(qr.code, key);
    expect(first.ok).toBe(true);
    // The limit is now reached; the same visit's retry finds its link before anything is counted.
    expect(await issueShareFromQrCode(qr.code, key)).toEqual(first);
    expect(await linksFrom(qr.id)).toBe(cap);
  });

  it("gives the last place to exactly one of five taps at once", async () => {
    const qr = await liveCode();
    await handedOut(qr, cap - 1, new Date());
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => issueShareFromQrCode(qr.code, randomUUID())));
    expect(outcomes.filter((one) => one.ok)).toHaveLength(1);
    expect(outcomes.filter((one) => !one.ok && one.reason === "daily-cap")).toHaveLength(4);
    expect(await linksFrom(qr.id)).toBe(cap);
  });

  it("lets fifty visits in a row each get a link of their own (the security audit's script), well under the limit", async () => {
    const qr = await liveCode();
    // Five at a time, as a busy waiting room would, rather than fifty transactions queueing for one connection pool.
    for (let batch = 0; batch < 10; batch++) {
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => issueShareFromQrCode(qr.code, randomUUID())));
      expect(outcomes.every((one) => one.ok)).toBe(true);
    }
    expect(await linksFrom(qr.id)).toBe(50);
  });
});

describe("the flagged list on /pulse", () => {
  // A day in 1998: no other test makes links then, so the counts below are exact.
  const now = new Date("1998-03-04T15:00:00.000Z");
  const today = new Date("1998-03-04T09:00:00.000Z");
  const yesterday = new Date("1998-03-03T23:59:59.999Z");

  it("lists every clinic's codes at or over the flag today, busiest first, and nothing under it or from yesterday", async () => {
    const busy = await liveCode(video, `Vitest busy clinic ${tag()}`);
    const busier = await liveCode(video, `Vitest busier clinic ${tag()}`);
    const quiet = await liveCode(video);
    const old = await liveCode(video);
    await handedOut(busy, 3, today);
    await handedOut(busier, 5, today);
    await handedOut(quiet, 2, today);
    await handedOut(old, 9, yesterday);

    const flagged = await listFlaggedQrCodesToday(3, now);
    const ours = flagged.rows.filter((row) => [busy.id, busier.id, quiet.id, old.id].includes(row.id));
    expect(ours).toEqual([
      { id: busier.id, clinicId: busier.clinic, clinicName: expect.stringMatching(/^Vitest busier clinic/), videoTitle: expect.stringMatching(/^Vitest QR cap video/), issuedToday: 5 },
      { id: busy.id, clinicId: busy.clinic, clinicName: expect.stringMatching(/^Vitest busy clinic/), videoTitle: expect.stringMatching(/^Vitest QR cap video/), issuedToday: 3 },
    ]);
    expect(flagged.total).toBeGreaterThanOrEqual(2);
  });

  it("is empty on a day nothing reached the flag", async () => {
    expect(await listFlaggedQrCodesToday(1, new Date("1997-01-01T12:00:00.000Z"))).toEqual({ rows: [], total: 0 });
  });
});
