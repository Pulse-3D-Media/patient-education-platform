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
 * first gets its link, every tap after the retirement gets nothing.
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

/** The code's row read with no lock: what the issuing would do without it. For the control only. */
async function plainRead(tx: Parameters<typeof real.lockQrCodeForIssue>[0], qrCodeId: string) {
  return tx.qrCode.findUnique({ where: { id: qrCodeId }, select: { retiredAt: true } });
}

/** Issue a link while the code is retired in the middle, right after the code's row was read. */
async function issueWhileRetiring(clinic: string, id: string, code: string, read: typeof real.lockQrCodeForIssue = real.lockQrCodeForIssue) {
  let retiredDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();
  vi.mocked(access.lockQrCodeForIssue).mockImplementationOnce(async (tx, qrCodeId) => {
    const row = await read(tx, qrCodeId);
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
