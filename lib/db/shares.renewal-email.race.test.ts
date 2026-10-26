import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, RENEWAL_EMAILS_PER_DAY } from "../expiry";
import { prisma } from "./client";
import * as renewalLock from "./renewal-lock";
import { createShare, recordSharePlay, requestShareRenewal, type RenewalRequestOutcome } from "./shares";

/**
 * The forced overlap for THE TENTH RENEWAL EMAIL OF THE DAY. Nine requests
 * are already recorded at the clinic today. The first new request takes the
 * clinic's renewal lock and counts nine; in that gap a second request for
 * another paused link at the same clinic is started on another connection.
 * With the lock, the second waits until the first has written its request,
 * then counts ten and is told not to email: ten emails exactly. The control
 * counts with no lock: the second counts nine too, writes inside the gap,
 * and both are told to email, eleven in all. That is what the lock prevents,
 * and it proves the test would catch its removal.
 */

vi.mock("./renewal-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renewal-lock")>();
  return { ...actual, lockAndCountRenewalRequests: vi.fn(actual.lockAndCountRenewalRequests) };
});

const real = await vi.importActual<typeof import("./renewal-lock")>("./renewal-lock");

/** How long the wrapper waits for the second request. An unblocked one finishes in well under a second. */
const WAIT_MS = 2000;

const tag = () => randomBytes(4).toString("hex");
const createdClinicIds: string[] = [];
let video = "";
const T = new Date("2026-09-25T15:00:00.000Z");
const PAUSED = addDays(T, 11);

beforeAll(async () => {
  video = (
    await prisma.video.create({
      data: { title: `Vitest renewal email race video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
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

/** A clinic with nine requests already recorded today, and two links that have just paused. */
async function nineDown() {
  const clinic = (
    await prisma.clinic.create({
      data: { name: `Vitest renewal email race clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10 },
      select: { id: true },
    })
  ).id;
  createdClinicIds.push(clinic);
  await prisma.share.createMany({
    data: Array.from({ length: RENEWAL_EMAILS_PER_DAY - 1 }, () => ({
      code: `r${randomBytes(8).toString("hex")}`,
      clinicId: clinic,
      videoId: video,
      expiresAt: T,
      renewalRequestedAt: PAUSED,
      renewalRequests: 1,
    })),
  });
  const codes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const share = await createShare(clinic, video, { now: T });
    expect(await recordSharePlay(share.code, T)).toEqual({ recorded: true, firstPlay: true });
    codes.push(share.code);
  }
  return codes;
}

/** Today's count with no lock at all: what the request did before the limit had one. For the control only. */
async function plainCount(tx: Prisma.TransactionClient, clinicId: string, since: Date) {
  return tx.share.count({ where: { clinicId, renewalRequestedAt: { gte: since } } });
}

async function requestWhileAnotherRequests(first: string, second: string, count: typeof real.lockAndCountRenewalRequests) {
  let secondDuringWait = false;
  let secondOutcome: Promise<RenewalRequestOutcome> = Promise.resolve({ kind: "already-asked" });
  vi.mocked(renewalLock.lockAndCountRenewalRequests).mockImplementationOnce(async (tx, clinicId, since) => {
    const counted = await count(tx, clinicId, since);
    let done = false;
    secondOutcome = requestShareRenewal(second, PAUSED).then((outcome) => {
      done = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    secondDuringWait = done;
    return counted;
  });
  const firstOutcome = await requestShareRenewal(first, PAUSED);
  return { firstOutcome, secondOutcome: await secondOutcome, secondDuringWait };
}

describe("two requests for the tenth email of the day", () => {
  it("makes the second wait for the first, then tells it not to email: ten emails exactly", async () => {
    const [first, second] = await nineDown();
    const { firstOutcome, secondOutcome, secondDuringWait } = await requestWhileAnotherRequests(first, second, real.lockAndCountRenewalRequests);
    expect(secondDuringWait).toBe(false);
    expect(firstOutcome).toMatchObject({ kind: "requested", emailClinic: true });
    expect(secondOutcome).toMatchObject({ kind: "requested", emailClinic: false });
  }, 60_000);

  it("control: counting with no lock, both take the tenth place and the office gets an eleventh email", async () => {
    const [first, second] = await nineDown();
    const { firstOutcome, secondOutcome, secondDuringWait } = await requestWhileAnotherRequests(first, second, plainCount);
    expect(secondDuringWait).toBe(true);
    expect(firstOutcome).toMatchObject({ kind: "requested", emailClinic: true });
    expect(secondOutcome).toMatchObject({ kind: "requested", emailClinic: true });
  }, 60_000);
});
