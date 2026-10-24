import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { DISCLAIMER } from "@/lib/education-note";
import * as shares from "@/lib/db/shares";
import { addDays } from "@/lib/expiry";
import type { PlaybackSource } from "@/lib/playback-source";
import * as renewalEmail from "@/lib/renewal-email";
import type { PlaybackRefresh } from "../patient-calls";
import * as askRoute from "./ask/route";
import * as playRoute from "./play/route";
import * as refreshRoute from "./refresh/route";

/**
 * The three POST routes behind the patient page (play, refresh, ask),
 * against the real test database. They were Server Actions until Prompt O;
 * every test the actions had is kept here, called through the routes.
 *
 * What these prove for the play count: a real link's play is counted and its
 * first play moves the deadline, once; anything that is not a code is refused
 * without a database call; a code nobody has is answered with recorded:
 * false; and a failure on the server is logged there by its kind and
 * answered with recorded: false, never thrown at the patient's page.
 *
 * For the refresh: a working, ticked link gets a fresh address bounded by
 * its deadline; a link that is over, taken down, never ticked, unknown or
 * made up gets "ended"; Mux not configured or a server failure is
 * "unavailable", never the CDN file.
 *
 * And for "ask my clinic": the request is recorded on the link before the
 * clinic is told, the office is told with the address built from a trusted
 * origin, a second tap the same day is answered the same way and sends
 * nothing, a link that is not paused is refused, junk never reaches the
 * database, and a server failure is answered calmly and logged without the
 * code. The email itself is a stand-in here (lib/renewal-email.test.ts
 * covers its words and its recipients), so no Clerk and no email service.
 *
 * And for every answer: never cached, never indexed, POST only, and no
 * Server Action left anywhere a patient can reach (the last describe block).
 */

// The real module, with the functions a test can make fail on purpose.
vi.mock("@/lib/db/shares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shares")>();
  return {
    ...actual,
    recordSharePlay: vi.fn(actual.recordSharePlay),
    requestShareRenewal: vi.fn(actual.requestShareRenewal),
    getShareByCode: vi.fn(actual.getShareByCode),
  };
});

// Telling the clinic reads Clerk and an email service; here it is a stand-in that says it was told.
vi.mock("@/lib/renewal-email", () => ({ notifyClinicOfRenewalRequest: vi.fn(async () => ({ told: true, recipients: 1 })) }));

/** POST to one of the three routes, as the browser does, with the request's host the email's address is picked from. */
async function call(route: { POST: (request: Request, context: never) => Promise<Response> }, what: string, code: string) {
  const request = new Request(`http://localhost:3000/watch/${encodeURIComponent(code)}/${what}`, { method: "POST", headers: { host: "localhost:3000" } });
  const response = await route.POST(request, { params: Promise.resolve({ code }) } as never);
  // Every answer, good or bad, is one no browser, CDN or search engine may keep.
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  return { status: response.status, body: (await response.json()) as unknown };
}

const recordPlay = async (code: string) => (await call(playRoute, "play", code)).body as { recorded: boolean; playback?: PlaybackSource };
const refreshPlayback = async (code: string) => (await call(refreshRoute, "refresh", code)).body as PlaybackRefresh;
const requestReactivation = async (code: string) => (await call(askRoute, "ask", code)).body as { asked: boolean };

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
  vi.mocked(shares.recordSharePlay).mockClear();
  vi.mocked(shares.requestShareRenewal).mockClear();
  vi.mocked(shares.getShareByCode).mockClear();
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

describe("POST /watch/<code>/play", () => {
  it("counts a real link's play, and the first one moves the deadline", async () => {
    const before = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true } });

    expect(await call(playRoute, "play", code)).toEqual({ status: 200, body: { recorded: true } });
    const after = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true, firstPlayedAt: true, viewCount: true } });
    expect(after.viewCount).toBe(1);
    expect(after.firstPlayedAt).not.toBeNull();
    expect(after.expiresAt.getTime()).toBeLessThan(before.expiresAt.getTime());

    expect(await recordPlay(code)).toEqual({ recorded: true });
    const again = await prisma.share.findUniqueOrThrow({ where: { code }, select: { expiresAt: true, viewCount: true } });
    expect(again.viewCount).toBe(2);
    expect(again.expiresAt.getTime()).toBe(after.expiresAt.getTime());
  });

  it("moves the deadline once when three first plays arrive at the same moment", async () => {
    const fresh = (await shares.createShare(clinicId, videoId)).code;
    const answers = await Promise.all([recordPlay(fresh), recordPlay(fresh), recordPlay(fresh)]);
    expect(answers).toEqual([{ recorded: true }, { recorded: true }, { recorded: true }]);
    const row = await prisma.share.findUniqueOrThrow({ where: { code: fresh }, select: { viewCount: true, firstPlayedAt: true, expiresAt: true } });
    expect(row.viewCount).toBe(3);
    // The deadline is the first play's moment plus the link's ten days, whichever play won.
    expect(row.expiresAt.getTime()).toBe(addDays(row.firstPlayedAt!, 10).getTime());
  });

  it("refuses anything that is not a share code with a 400, without asking the database", async () => {
    expect(await call(playRoute, "play", "")).toEqual({ status: 400, body: { recorded: false } });
    expect(await call(playRoute, "play", "x".repeat(21))).toEqual({ status: 400, body: { recorded: false } });
    expect(await call(playRoute, "play", "abc'--")).toEqual({ status: 400, body: { recorded: false } });
    expect(vi.mocked(shares.recordSharePlay)).not.toHaveBeenCalled();
  });

  it("answers recorded: false for a code nobody has", async () => {
    expect(await call(playRoute, "play", "nope00")).toEqual({ status: 200, body: { recorded: false } });
  });

  it("answers recorded: false with a 500 when the server fails, and logs the kind of error there instead of throwing it at the page", async () => {
    // A failure whose message holds the link's code, the way a database error can.
    vi.mocked(shares.recordSharePlay).mockRejectedValueOnce(new Error(`the database went away looking up ${code}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await call(playRoute, "play", code)).toEqual({ status: 500, body: { recorded: false } });
    expect(log).toHaveBeenCalledOnce();
    // Only words go to the log: what happened and the kind of error. Never
    // the error object, whose message and stack would print the code.
    expect(log).toHaveBeenCalledWith("Could not record a play start on a share link.", "Error");
    expect(log.mock.calls[0].every((part) => typeof part === "string" && !part.includes(code))).toBe(true);
  });
});

describe("a link whose video streams from Mux", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const MUX_ENV = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64") };
  let muxVideoId = "";

  /** The expiry a token carries, read back from the address. */
  const expiryOf = (url: string) => (JSON.parse(Buffer.from(new URL(url).searchParams.get("token")!.split(".")[1], "base64url").toString("utf8")) as { exp: number }).exp * 1000;

  beforeAll(async () => {
    const video = await prisma.video.create({
      data: { title: "Vitest Mux video", category: "KNEE", videoUrl: "https://example.com/vitest-cdn-copy.mp4", durationSeconds: 110, isPublished: true, muxPlaybackId: `Vitest${randomBytes(6).toString("hex")}` },
      select: { id: true },
    });
    muxVideoId = video.id;
    createdVideoIds.push(video.id);
    Object.assign(process.env, MUX_ENV);
  });

  afterAll(() => {
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_PRIVATE_KEY;
  });

  /** A Mux link on which the patient ticked the "for education only" box, as every real player has before it plays or refreshes. */
  async function tickedMuxLink() {
    const share = await shares.createShare(clinicId, muxVideoId);
    expect((await shares.acceptShareDisclaimer(share.code, DISCLAIMER.version)).recorded).toBe(true);
    return share;
  }

  it("never hands out an address, by a first play or a refresh, on a link where the box was never ticked", async () => {
    const share = await shares.createShare(clinicId, muxVideoId);
    // The play is still counted; no video comes back with it.
    expect(await recordPlay(share.code)).toEqual({ recorded: true });
    expect(await refreshPlayback(share.code)).toEqual({ ok: false, reason: "ended" });
  });

  it("the first play hands back a grant for the link's new deadline; later plays and CDN videos hand back none", async () => {
    const share = await tickedMuxLink();
    const first = await recordPlay(share.code);
    expect(first.recorded).toBe(true);
    expect(first.playback?.kind).toBe("stream");
    if (first.playback?.kind !== "stream") return;
    const row = await prisma.share.findUniqueOrThrow({ where: { code: share.code }, select: { expiresAt: true } });
    // Bounded by the usual lifetime now (the new deadline is ten days off), and never past the link.
    expect(first.playback.expiresAt).toBeLessThanOrEqual(row.expiresAt.getTime());
    // A token's expiry is whole seconds.
    expect(expiryOf(first.playback.src)).toBe(Math.floor(first.playback.expiresAt / 1000) * 1000);
    expect(JSON.stringify(first.playback)).not.toContain("example.com");

    expect(await recordPlay(share.code)).toEqual({ recorded: true });
    // The CDN video from the top of this file: counted, nothing handed back.
    const cdn = await shares.createShare(clinicId, videoId);
    expect(await recordPlay(cdn.code)).toEqual({ recorded: true });
  });

  it("hands out no grant with a first play when the video is taken down, or the link runs out, between the play and the grant", async () => {
    const actual = await vi.importActual<typeof import("@/lib/db/shares")>("@/lib/db/shares");

    // Unpublished in the moment after the play was recorded: the play counts, no address comes back.
    const share = await tickedMuxLink();
    vi.mocked(shares.recordSharePlay).mockImplementationOnce(async (code) => {
      const result = await actual.recordSharePlay(code);
      await prisma.video.update({ where: { id: muxVideoId }, data: { isPublished: false } });
      return result;
    });
    try {
      expect(await recordPlay(share.code)).toEqual({ recorded: true });
    } finally {
      await prisma.video.update({ where: { id: muxVideoId }, data: { isPublished: true } });
    }
    expect(await prisma.share.findUniqueOrThrow({ where: { code: share.code }, select: { viewCount: true } })).toEqual({ viewCount: 1 });

    // The link's deadline passed in that moment: the same.
    const other = await tickedMuxLink();
    vi.mocked(shares.recordSharePlay).mockImplementationOnce(async (code) => {
      const result = await actual.recordSharePlay(code);
      await prisma.share.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });
      return result;
    });
    expect(await recordPlay(other.code)).toEqual({ recorded: true });

    // The control: with nothing changed in between, the first play does hand back a grant.
    const control = await tickedMuxLink();
    expect((await recordPlay(control.code)).playback?.kind).toBe("stream");
  });

  it("refresh hands a working link a fresh address bounded by its deadline, and nothing to a link that is over, taken down, unknown or made up", async () => {
    const share = await tickedMuxLink();
    const answer = await refreshPlayback(share.code);
    expect(answer.ok).toBe(true);
    if (!answer.ok || answer.source.kind !== "stream") return;
    const row = await prisma.share.findUniqueOrThrow({ where: { code: share.code }, select: { expiresAt: true } });
    expect(answer.source.expiresAt).toBeLessThanOrEqual(row.expiresAt.getTime());

    // A link that ran out: no address, however it is asked.
    await prisma.share.update({ where: { code: share.code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await refreshPlayback(share.code)).toEqual({ ok: false, reason: "ended" });

    // A working link whose video was taken down.
    const other = await tickedMuxLink();
    await prisma.video.update({ where: { id: muxVideoId }, data: { isPublished: false } });
    try {
      expect(await refreshPlayback(other.code)).toEqual({ ok: false, reason: "ended" });
    } finally {
      await prisma.video.update({ where: { id: muxVideoId }, data: { isPublished: true } });
    }

    expect(await call(refreshRoute, "refresh", "nope00")).toEqual({ status: 200, body: { ok: false, reason: "ended" } });
    expect(await call(refreshRoute, "refresh", "")).toEqual({ status: 400, body: { ok: false, reason: "ended" } });
    expect(await call(refreshRoute, "refresh", "x".repeat(21))).toEqual({ status: 400, body: { ok: false, reason: "ended" } });
  });

  it("refresh answers unavailable, not the CDN file and not an exception, when Mux is not configured or the server fails", async () => {
    const share = await tickedMuxLink();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    delete process.env.MUX_SIGNING_KEY_ID;
    try {
      expect(await call(refreshRoute, "refresh", share.code)).toEqual({ status: 200, body: { ok: false, reason: "unavailable" } });
    } finally {
      Object.assign(process.env, MUX_ENV);
    }

    vi.mocked(shares.getShareByCode).mockRejectedValueOnce(new Error(`the database went away looking up ${share.code}`));
    expect(await call(refreshRoute, "refresh", share.code)).toEqual({ status: 500, body: { ok: false, reason: "unavailable" } });
    expect(log).toHaveBeenCalledWith("Could not refresh a share link's playback.", "Error");
    expect(log.mock.calls.flat().every((part) => typeof part === "string" && !part.includes(share.code))).toBe(true);
  });
});

describe("POST /watch/<code>/ask", () => {
  /** A link made and played 20 days ago with ten days after the first play, so it paused 10 days ago. */
  async function pausedLink() {
    const madeAt = addDays(new Date(), -20);
    const share = await shares.createShare(clinicId, videoId, { now: madeAt });
    expect(await shares.recordSharePlay(share.code, madeAt)).toEqual({ recorded: true, firstPlay: true });
    return share.code;
  }

  it("records the request on the link first, then tells the clinic with the address built from a trusted origin", async () => {
    const paused = await pausedLink();
    expect(await call(askRoute, "ask", paused)).toEqual({ status: 200, body: { asked: true } });

    const row = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true, renewalRequests: true } });
    expect(row.renewalRequestedAt).not.toBeNull();
    expect(row.renewalRequests).toBe(1);

    const told = vi.mocked(renewalEmail.notifyClinicOfRenewalRequest);
    expect(told).toHaveBeenCalledOnce();
    const [facts, origin] = told.mock.calls[0];
    const { id: pausedId } = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { id: true } });
    expect(facts).toMatchObject({ shareId: pausedId, videoTitle: "Vitest watch video", daysPerRenewal: 10, clinic: { id: clinicId } });
    // The email is built from the facts alone, and the code (which plays the video) is not among them.
    expect(JSON.stringify(facts)).not.toContain(paused);
    expect(facts.requestedAt.getTime()).toBe(row.renewalRequestedAt!.getTime());
    // A developer's own computer is a trusted origin; a Host header alone never is (lib/trusted-origin.ts).
    expect(origin).toBe("http://localhost:3000");
  });

  it("answers the same way to a second tap the same day, and tells the clinic nothing more", async () => {
    const paused = await pausedLink();
    expect(await requestReactivation(paused)).toEqual({ asked: true });
    const first = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true } });

    expect(await requestReactivation(paused)).toEqual({ asked: true });
    const second = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequestedAt: true, renewalRequests: true } });
    expect(second.renewalRequestedAt!.getTime()).toBe(first.renewalRequestedAt!.getTime());
    expect(second.renewalRequests).toBe(1);
    expect(vi.mocked(renewalEmail.notifyClinicOfRenewalRequest)).toHaveBeenCalledOnce();
  });

  it("five taps at once record one request and tell the clinic once", async () => {
    const paused = await pausedLink();
    const answers = await Promise.all(Array.from({ length: 5 }, () => requestReactivation(paused)));
    expect(answers).toEqual(Array.from({ length: 5 }, () => ({ asked: true })));
    const row = await prisma.share.findUniqueOrThrow({ where: { code: paused }, select: { renewalRequests: true } });
    expect(row.renewalRequests).toBe(1);
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
    expect(await call(askRoute, "ask", code)).toEqual({ status: 200, body: { asked: false } });
    expect(await requestReactivation("nope00")).toEqual({ asked: false });
    expect(vi.mocked(renewalEmail.notifyClinicOfRenewalRequest)).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a share code with a 400, without asking the database", async () => {
    expect(await call(askRoute, "ask", "")).toEqual({ status: 400, body: { asked: false } });
    expect(await call(askRoute, "ask", "x".repeat(21))).toEqual({ status: 400, body: { asked: false } });
    expect(await call(askRoute, "ask", "a/b")).toEqual({ status: 400, body: { asked: false } });
    expect(vi.mocked(shares.requestShareRenewal)).not.toHaveBeenCalled();
  });

  it("answers asked: false with a 500 when the server fails, logging the kind of error and never the code", async () => {
    const paused = await pausedLink();
    vi.mocked(shares.requestShareRenewal).mockRejectedValueOnce(new Error(`the database went away ${paused}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await call(askRoute, "ask", paused)).toEqual({ status: 500, body: { asked: false } });
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Could not record a request to turn a link back on.", "Error");
    expect(log.mock.calls[0].every((part) => typeof part === "string" && !part.includes(paused))).toBe(true);
  });
});

describe("only at rate-limited addresses", () => {
  const root = join(process.cwd(), "app");

  /** Every .ts and .tsx file under a folder, tests left out. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  /** True when the file is a Server Action module, or holds an inline action. */
  const holdsServerAction = (text: string) => /(["'])use server\1/.test(text);

  it("no Server Action is left on the patient's pages: Next.js would run one at any address, outside /watch and /q", () => {
    const files = [...sourceFiles(join(root, "watch")), ...sourceFiles(join(root, "q"))];
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((file) => holdsServerAction(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the check above would catch an action module and an inline action", () => {
    expect(holdsServerAction(`"use server";\nexport async function recordPlay() {}`)).toBe(true);
    expect(holdsServerAction(`async function go() {\n  'use server';\n}`)).toBe(true);
    expect(holdsServerAction(`import { recordPlay } from "../patient-calls";`)).toBe(false);
  });

  it("the player and the paused page call the routes, never an actions module", () => {
    for (const file of ["WatchPlayer.tsx", "AskClinic.tsx"]) {
      const text = readFileSync(join(root, "watch", "[code]", file), "utf8");
      expect(text).toContain(`from "../patient-calls"`);
      expect(text).not.toMatch(/from "\.\/actions"/);
    }
  });

  it("each route answers POST only, so a link preview, a crawler or a HEAD request reaches none of them", () => {
    for (const route of [playRoute, refreshRoute, askRoute]) {
      expect(Object.keys(route).sort()).toEqual(["POST"]);
    }
  });
});
