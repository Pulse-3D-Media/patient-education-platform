import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import * as shares from "@/lib/db/shares";
import { addDays } from "@/lib/expiry";
import * as renewalEmail from "@/lib/renewal-email";
import { recordPlay, requestReactivation } from "./actions";

/**
 * The Server Actions behind the patient page, against the real test
 * database. What these prove for the play count: a real link's play is
 * counted and its first play moves the deadline; anything odd sent to it
 * is ignored without a database call; a code nobody has is answered with
 * recorded: false; and a failure on the server is logged there and
 * answered with recorded: false, never thrown at the patient's page.
 *
 * And for "ask my clinic": the request is recorded on the link before the
 * clinic is told, the office is told with the address built from a trusted
 * origin, a second tap the same day is answered the same way and sends
 * nothing, a link that is not paused is refused, junk never reaches the
 * database, and a server failure is answered calmly and logged without the
 * code. The email itself is a stand-in here (lib/renewal-email.test.ts
 * covers its words and its recipients), so no Clerk and no email service.
 */

// The real module, with one function that a test can make fail on purpose.
vi.mock("@/lib/db/shares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shares")>();
  return { ...actual, recordSharePlay: vi.fn(actual.recordSharePlay), requestShareRenewal: vi.fn(actual.requestShareRenewal) };
});

// Telling the clinic reads Clerk and an email service; here it is a stand-in that says it was told.
vi.mock("@/lib/renewal-email", () => ({ notifyClinicOfRenewalRequest: vi.fn(async () => ({ told: true, recipients: 1 })) }));

// The request's host, from which the email's address is picked.
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinicId = "";
let videoId = "";
let code = "";

beforeAll(async () => {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest watch clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"], viewDaysOverride: 10 },
    select: { id: true },
  });
  clinicId = clinic.id;
  createdClinicIds.push(clinic.id);
  const video = await prisma.video.create({
    data: { title: "Vitest watch video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  videoId = video.id;
  createdVideoIds.push(video.id);
  code = (await shares.createShare(clinicId, videoId)).code;
});

beforeEach(() => {
  vi.mocked(renewalEmail.notifyClinicOfRenewalRequest).mockClear();
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

describe("requestReactivation", () => {
  /** A link made and played 20 days ago with ten days after the first play, so it paused 10 days ago. */
  async function pausedLink() {
    const madeAt = addDays(new Date(), -20);
    const share = await shares.createShare(clinicId, videoId, { now: madeAt });
    expect(await shares.recordSharePlay(share.code, madeAt)).toEqual({ recorded: true, firstPlay: true });
    return share.code;
  }

  it("records the request on the link first, then tells the clinic with the address built from a trusted origin", async () => {
    const paused = await pausedLink();
    expect(await requestReactivation(paused)).toEqual({ asked: true });

    const row = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true } });
    expect(row.renewalRequestedAt).not.toBeNull();

    const told = vi.mocked(renewalEmail.notifyClinicOfRenewalRequest);
    expect(told).toHaveBeenCalledOnce();
    const [facts, origin] = told.mock.calls[0];
    expect(facts).toMatchObject({ code: paused, videoTitle: "Vitest watch video", daysPerRenewal: 10, clinic: { id: clinicId } });
    expect(facts.requestedAt.getTime()).toBe(row.renewalRequestedAt!.getTime());
    // A developer's own computer is a trusted origin; a Host header alone never is (lib/trusted-origin.ts).
    expect(origin).toBe("http://localhost:3000");
  });

  it("answers the same way to a second tap the same day, and tells the clinic nothing more", async () => {
    const paused = await pausedLink();
    expect(await requestReactivation(paused)).toEqual({ asked: true });
    const first = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true } });

    expect(await requestReactivation(paused)).toEqual({ asked: true });
    const second = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true } });
    expect(second.renewalRequestedAt!.getTime()).toBe(first.renewalRequestedAt!.getTime());
    expect(vi.mocked(renewalEmail.notifyClinicOfRenewalRequest)).toHaveBeenCalledOnce();
  });

  it("still answers asked: true when the clinic could not be emailed: the request is recorded and listed either way", async () => {
    const paused = await pausedLink();
    vi.mocked(renewalEmail.notifyClinicOfRenewalRequest).mockResolvedValueOnce({ told: false, reason: "not-configured" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await requestReactivation(paused)).toEqual({ asked: true });
    expect((await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true } })).renewalRequestedAt).not.toBeNull();
    expect(JSON.stringify(log.mock.calls)).toContain("not-configured");
    expect(JSON.stringify(log.mock.calls)).not.toContain(paused);
  });

  it("refuses a link that is not paused, and a code nobody has, telling the clinic nothing", async () => {
    // `code` is the working link from the play tests above.
    expect(await requestReactivation(code)).toEqual({ asked: false });
    expect(await requestReactivation("nope00")).toEqual({ asked: false });
    expect(vi.mocked(renewalEmail.notifyClinicOfRenewalRequest)).not.toHaveBeenCalled();
  });

  it("ignores anything that is not a share code, without asking the database", async () => {
    expect(await requestReactivation("")).toEqual({ asked: false });
    expect(await requestReactivation("x".repeat(21))).toEqual({ asked: false });
    expect(await requestReactivation({ code } as unknown as string)).toEqual({ asked: false });
    expect(vi.mocked(shares.requestShareRenewal)).not.toHaveBeenCalled();
  });

  it("answers asked: false when the server fails, logging the kind of error and never the code", async () => {
    const paused = await pausedLink();
    vi.mocked(shares.requestShareRenewal).mockRejectedValueOnce(new Error(`the database went away ${paused}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await requestReactivation(paused)).toEqual({ asked: false });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain(paused);
  });
});
