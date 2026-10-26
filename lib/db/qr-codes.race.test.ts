import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as access from "./access";
import { prisma } from "./client";
import { createQrCode, retireQrCode } from "./qr-codes";
import { issueShareFromQrCode } from "./shares";

/**
 * The forced overlap for a PRINTED CODE BEING RETIRED while a patient's tap
 * is being turned into a link. Without the lock, the retirement could commit
 * after the code was checked and before the link was written, and a code
 * already retired would hand out one more link. With the share lock on the
 * code's row (lockQrCodeForIssue in lib/db/access.ts), the retirement waits
 * until the link is committed, and only then applies: the tap that started
 * first gets its link, every tap after the retirement gets nothing. (The lock
 * was FOR SHARE until Prompt M made it FOR NO KEY UPDATE for the daily limit;
 * a retirement waits for either.)
 *
 * How the gap is forced, as in shares.race.test.ts: lockQrCodeForIssue is
 * wrapped for one call. The wrapper does the read, starts the retirement on
 * another connection, waits long enough for an unblocked retirement to finish
 * many times over, notes whether it did, and lets the issuing carry on. Its
 * control does the same with a plain, unlocked read, and shows the
 * retirement getting through and a link written from a code already
 * retired: that is what the lock prevents, and it proves the test would
 * catch the lock being removed.
 */

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, lockQrCodeForIssue: vi.fn(actual.lockQrCodeForIssue) };
});

const real = await vi.importActual<typeof import("./access")>("./access");

/** How long the wrapper waits for the retirement. An unblocked one finishes in tens of milliseconds. */
const WAIT_MS = 1500;

const tag = () => randomBytes(6).toString("hex");
const createdClinicIds: string[] = [];
let video = "";

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: `Vitest QR race video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** An open Knee clinic, one seated surgeon, and a live printed code for the video. */
async function liveCode() {
  const surgeon = `user_qrrace${tag()}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest QR race clinic ${tag()}`,
      status: "ACTIVE",
      categories: ["KNEE"],
      surgeonSeats: 2,
      seatAllocations: { create: { clerkUserId: surgeon, syncState: "SYNCED" } },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const made = await createQrCode(clinic.id, video, { clerkUserId: surgeon, fallbackName: "Dr. Race" }, "Vitest");
  const code = (await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id }, select: { code: true } })).code;
  return { clinic: clinic.id, id: made.id, code };
}

/** The code's row and today's count read with no lock: what the issuing would do without it. For the controls only. */
async function plainRead(tx: Parameters<typeof real.lockQrCodeForIssue>[0], qrCodeId: string, since: Date) {
  const row = await tx.qrCode.findUnique({ where: { id: qrCodeId }, select: { retiredAt: true } });
  if (!row) return null;
  return { retiredAt: row.retiredAt, issuedSince: await tx.share.count({ where: { qrCodeId, createdAt: { gte: since } } }) };
}

/** Issue a link while the code is retired in the middle, right after the code's row was read. */
async function issueWhileRetiring(clinic: string, id: string, code: string, read: typeof real.lockQrCodeForIssue = real.lockQrCodeForIssue) {
  let retiredDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();
  vi.mocked(access.lockQrCodeForIssue).mockImplementationOnce(async (tx, qrCodeId, since) => {
    const row = await read(tx, qrCodeId, since);
    let done = false;
    pending = retireQrCode(clinic, id, "Vitest").then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    retiredDuringWait = done;
    return row;
  });
  const outcome = await issueShareFromQrCode(code, randomUUID());
  await pending;
  return { outcome, retiredDuringWait };
}

describe("retiring a printed code while a patient's link is being made", () => {
  it("waits for the link: the tap that started first gets it, and the next tap gets nothing", async () => {
    const { clinic, id, code } = await liveCode();
    const { outcome, retiredDuringWait } = await issueWhileRetiring(clinic, id, code);
    expect(retiredDuringWait).toBe(false);
    expect(outcome.ok).toBe(true);
    // The retirement then applied.
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id } })).retiredAt).not.toBeNull();
    expect(await issueShareFromQrCode(code, randomUUID())).toEqual({ ok: false, reason: "retired" });
    expect(await prisma.share.count({ where: { qrCodeId: id } })).toBe(1);
  }, 30_000);

  it("control: with a plain read the retirement gets through in the gap, and a retired code hands out a link", async () => {
    const { clinic, id, code } = await liveCode();
    const { outcome, retiredDuringWait } = await issueWhileRetiring(clinic, id, code, plainRead);
    expect(retiredDuringWait).toBe(true);
    // The read saw the code live before the retirement, so the link was written anyway: exactly what the lock prevents.
    expect(outcome.ok).toBe(true);
    const share = await prisma.share.findFirstOrThrow({ where: { qrCodeId: id }, select: { createdAt: true } });
    const retiredAt = (await prisma.qrCode.findUniqueOrThrow({ where: { id } })).retiredAt;
    expect(retiredAt).not.toBeNull();
    expect(share.createdAt.getTime()).toBeGreaterThanOrEqual(retiredAt!.getTime());
  }, 30_000);
});

/**
 * The forced overlap for THE DAILY LIMIT (Prompt M). One place is left today.
 * The first tap reads the code's row; in that gap a second tap on the same
 * code is started on another connection. With the lock (FOR NO KEY UPDATE),
 * the second waits until the first has written its link, then counts it and
 * is refused: exactly the limit's worth of links. The control does the first
 * read with no lock: the second tap counts the same free place, writes its
 * link inside the gap, and the first writes too, one past the limit. That is
 * what the lock prevents, and it proves the test would catch its removal.
 */
describe("two taps on the last place of the day", () => {
  /** Write `count` links this code "handed out" just now, straight into the table. */
  async function handedOut(clinic: string, id: string, count: number) {
    await prisma.share.createMany({
      data: Array.from({ length: count }, () => ({
        code: `t${randomBytes(8).toString("hex")}`,
        clinicId: clinic,
        videoId: video,
        qrCodeId: id,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      })),
    });
  }

  async function tapWhileAnotherTaps(code: string, read: typeof real.lockQrCodeForIssue) {
    let secondDuringWait = false;
    let second: Promise<Awaited<ReturnType<typeof issueShareFromQrCode>>> = Promise.resolve({ ok: false, reason: "retired" });
    vi.mocked(access.lockQrCodeForIssue).mockImplementationOnce(async (tx, qrCodeId, since) => {
      const row = await read(tx, qrCodeId, since);
      let done = false;
      second = issueShareFromQrCode(code, randomUUID()).then((outcome) => {
        done = true;
        return outcome;
      });
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      secondDuringWait = done;
      return row;
    });
    const first = await issueShareFromQrCode(code, randomUUID());
    return { first, second: await second, secondDuringWait };
  }

  it("makes the second tap wait for the first, then refuses it: the day ends exactly at the limit", async () => {
    const cap = (await prisma.appSettings.findUnique({ where: { id: "default" }, select: { qrDailyCap: true } }))?.qrDailyCap ?? 200;
    const { clinic, id, code } = await liveCode();
    await handedOut(clinic, id, cap - 1);

    const { first, second, secondDuringWait } = await tapWhileAnotherTaps(code, real.lockQrCodeForIssue);
    expect(secondDuringWait).toBe(false);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "daily-cap" });
    expect(await prisma.share.count({ where: { qrCodeId: id } })).toBe(cap);
  }, 60_000);

  it("control: with a plain read both taps take the last place, and the code goes one past its limit", async () => {
    const cap = (await prisma.appSettings.findUnique({ where: { id: "default" }, select: { qrDailyCap: true } }))?.qrDailyCap ?? 200;
    const { clinic, id, code } = await liveCode();
    await handedOut(clinic, id, cap - 1);

    const { first, second, secondDuringWait } = await tapWhileAnotherTaps(code, plainRead);
    expect(secondDuringWait).toBe(true);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await prisma.share.count({ where: { qrCodeId: id } })).toBe(cap + 1);
  }, 60_000);
});
