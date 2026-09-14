import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import * as shares from "@/lib/db/shares";
import { recordPlay } from "./actions";

/**
 * The Server Action behind the patient player, against the real test
 * database. What these prove: a real link's play is counted and its first
 * play moves the deadline; anything odd sent to it is ignored without a
 * database call; a code nobody has is answered with recorded: false; and
 * a failure on the server is logged there and answered with recorded:
 * false, never thrown at the patient's page.
 */

// The real module, with one function that a test can make fail on purpose.
vi.mock("@/lib/db/shares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shares")>();
  return { ...actual, recordSharePlay: vi.fn(actual.recordSharePlay) };
});

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let code = "";

beforeAll(async () => {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest watch clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"] },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const video = await prisma.video.create({
    data: { title: "Vitest watch video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  code = (await shares.createShare(clinic.id, video.id)).code;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("recordPlay", () => {
  it("counts a real link's play, and the first one moves the deadline", async () => {
    const before = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true } });

    expect(await recordPlay(code)).toEqual({ recorded: true });
    const after = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true, firstPlayedAt: true, viewCount: true } });
    expect(after.viewCount).toBe(1);
    expect(after.firstPlayedAt).not.toBeNull();
    expect(after.expiresAt.getTime()).toBeLessThan(before.expiresAt.getTime());

    expect(await recordPlay(code)).toEqual({ recorded: true });
    const again = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true, viewCount: true } });
    expect(again.viewCount).toBe(2);
    expect(again.expiresAt.getTime()).toBe(after.expiresAt.getTime());
  });

  it("ignores anything that is not a share code, without asking the database", async () => {
    expect(await recordPlay("")).toEqual({ recorded: false });
    expect(await recordPlay("x".repeat(21))).toEqual({ recorded: false });
    expect(await recordPlay(42 as unknown as string)).toEqual({ recorded: false });
    expect(vi.mocked(shares.recordSharePlay)).not.toHaveBeenCalled();
  });

  it("answers recorded: false for a code nobody has", async () => {
    expect(await recordPlay("nope00")).toEqual({ recorded: false });
  });

  it("answers recorded: false when the server fails, and logs the detail there instead of throwing it at the page", async () => {
    vi.mocked(shares.recordSharePlay).mockRejectedValueOnce(new Error("the database went away"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await recordPlay(code)).toEqual({ recorded: false });
    expect(log).toHaveBeenCalledOnce();
    // The log line names what happened, not the code of the link.
    expect(String(log.mock.calls[0][0])).not.toContain(code);
  });
});
