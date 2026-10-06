import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import { createShare } from "./db/shares";
import { playbackForLibraryVideo, playbackForShare, playbackForVideo } from "./playback-auth";
import { TOKEN_LIFETIME_MS } from "./playback-source";

/**
 * Who gets a playback address, against the real test database, with a Mux
 * signing key made here and never a real one. What these prove:
 *
 *   - a video still on the CDN is handed out as the plain file, whoever asks;
 *   - a video that has moved to Mux is handed out as a signed stream that
 *     stops working no later than the patient's link does, and is never the
 *     CDN file: not when the link has run out, not when Mux is not
 *     configured on this deployment;
 *   - in the library the clinic's plan decides, exactly as it does for a new
 *     link: another clinic, a category off the plan, a placeholder the
 *     clinic is not shown, an unpublished or unknown video all get nothing;
 *   - a link already issued keeps its stream after its category leaves the
 *     clinic's plan, as every issued link does;
 *   - nothing about a token or an address reaches the log.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const MUX_ENV = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(PEM).toString("base64") };

const NOW = new Date("2026-10-05T12:00:00Z");
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let kneeClinic = "";
let hipClinic = "";
let noPlaceholdersClinic = "";
let cdnVideo = "";
let muxVideo = "";
let muxPlaceholder = "";
let unpublishedMux = "";
const playbackId = `Vitest${randomBytes(6).toString("hex")}`;

function configureMux(on: boolean) {
  if (on) Object.assign(process.env, MUX_ENV);
  else {
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_PRIVATE_KEY;
  }
}

beforeAll(async () => {
  const clinic = async (categories: ("KNEE" | "HIP")[], showPlaceholders = true) => {
    const row = await prisma.clinic.create({ data: { name: `Vitest playback clinic ${randomBytes(3).toString("hex")}`, status: "ACTIVE", categories, showPlaceholders }, select: { id: true } });
    createdClinicIds.push(row.id);
    return row.id;
  };
  const video = async (data: { muxPlaybackId?: string; isPlaceholder?: boolean; isPublished?: boolean }) => {
    const row = await prisma.video.create({
      data: { title: "Vitest playback video", category: "KNEE", videoUrl: "https://example.com/vitest-cdn.mp4", durationSeconds: 110, isPublished: true, ...data },
      select: { id: true },
    });
    createdVideoIds.push(row.id);
    return row.id;
  };
  [kneeClinic, hipClinic, noPlaceholdersClinic] = await Promise.all([clinic(["KNEE"]), clinic(["HIP"]), clinic(["KNEE"], false)]);
  cdnVideo = await video({});
  muxVideo = await video({ muxPlaybackId: playbackId });
  muxPlaceholder = await video({ muxPlaybackId: `${playbackId}p`, isPlaceholder: true });
  unpublishedMux = await video({ muxPlaybackId: `${playbackId}u`, isPublished: false });
});

afterEach(() => {
  configureMux(false);
  vi.restoreAllMocks();
});

afterAll(async () => {
  configureMux(false);
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** The expiry a token carries, read back from the address. */
function expiryOf(url: string): number {
  const token = new URL(url).searchParams.get("token")!;
  return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp: number }).exp * 1000;
}

describe("playbackForVideo", () => {
  const cdn = { videoUrl: "https://example.com/a.mp4", muxPlaybackId: null, durationSeconds: 110 };
  const mux = { videoUrl: "https://example.com/a.mp4", muxPlaybackId: playbackId, durationSeconds: 110 };

  it("hands out a CDN video as its plain file, configured or not", () => {
    expect(playbackForVideo(cdn, NOW, null)).toEqual({ kind: "file", src: "https://example.com/a.mp4" });
    configureMux(true);
    expect(playbackForVideo(cdn, NOW, new Date(NOW.getTime() + 60_000))).toEqual({ kind: "file", src: "https://example.com/a.mp4" });
  });

  it("hands out a Mux video as a signed stream and still, with the usual lifetime when nothing shorter applies", () => {
    configureMux(true);
    const source = playbackForVideo(mux, NOW, null);
    expect(source.kind).toBe("stream");
    if (source.kind !== "stream") return;
    expect(source.src).toMatch(new RegExp(`^https://stream\\.mux\\.com/${playbackId}\\.m3u8\\?token=`));
    expect(source.poster).toMatch(new RegExp(`^https://image\\.mux\\.com/${playbackId}/thumbnail\\.jpg\\?token=`));
    expect(source.expiresAt).toBe(NOW.getTime() + TOKEN_LIFETIME_MS);
    expect(expiryOf(source.src)).toBe(source.expiresAt);
    expect(expiryOf(source.poster)).toBe(source.expiresAt);
    // Never the CDN address, anywhere in it.
    expect(JSON.stringify(source)).not.toContain("example.com");
  });

  it("is unavailable, never the CDN file, when Mux is not configured here, and logs no address", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(playbackForVideo(mux, NOW, null)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0].join(" ")).not.toMatch(/example\.com|mux\.com|token/);
  });

  it("is unavailable when the key is damaged, logging the kind only", () => {
    // A PEM-shaped text that is not a key. Built from pieces so no scanner mistakes the test for a committed key.
    const pemShaped = ["-----BEGIN", "PRIVATE KEY-----", "not a key", "-----END", "PRIVATE KEY-----"].join("\n");
    Object.assign(process.env, { MUX_SIGNING_KEY_ID: "k", MUX_SIGNING_PRIVATE_KEY: Buffer.from(pemShaped).toString("base64") });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(playbackForVideo(mux, NOW, null)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/mux\.com|token|BEGIN/);
  });
});

describe("playbackForShare", () => {
  it("bounds the token to the link's deadline, and stretches it to cover the video where the link allows", () => {
    configureMux(true);
    const video = { videoUrl: "https://example.com/a.mp4", muxPlaybackId: playbackId, durationSeconds: 110 };
    const soon = playbackForShare({ expiresAt: new Date(NOW.getTime() + 10 * 60_000), video }, NOW);
    expect(soon.kind === "stream" && soon.expiresAt).toBe(NOW.getTime() + 10 * 60_000);

    const long = playbackForShare({ expiresAt: new Date(NOW.getTime() + 7 * 86_400_000), video: { ...video, durationSeconds: 3 * 3600 } }, NOW);
    expect(long.kind === "stream" && long.expiresAt).toBe(NOW.getTime() + 3 * 3600 * 1000);
  });

  it("hands out nothing for a link at or past its deadline", () => {
    configureMux(true);
    const video = { videoUrl: "https://example.com/a.mp4", muxPlaybackId: playbackId, durationSeconds: 110 };
    expect(playbackForShare({ expiresAt: NOW, video }, NOW)).toEqual({ kind: "unavailable" });
    expect(playbackForShare({ expiresAt: new Date(NOW.getTime() - 1), video }, NOW)).toEqual({ kind: "unavailable" });
  });

  it("a link already issued keeps its stream after its category leaves the clinic's plan", async () => {
    configureMux(true);
    const clinicId = (await prisma.clinic.create({ data: { name: `Vitest playback clinic ${randomBytes(3).toString("hex")}`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } })).id;
    createdClinicIds.push(clinicId);
    const share = await createShare(clinicId, muxVideo);
    await prisma.clinic.update({ where: { id: clinicId }, data: { categories: [] } });

    // The library would now refuse the clinic (the plan decides there)...
    expect(await playbackForLibraryVideo(clinicId, muxVideo, NOW)).toBeNull();
    // ...while the patient's link still plays: the link, not the plan, is the patient's permission.
    const full = await prisma.share.findUniqueOrThrow({ where: { code: share.code }, include: { video: true } });
    expect(playbackForShare(full, NOW).kind).toBe("stream");
  });
});

describe("playbackForLibraryVideo", () => {
  it("hands a clinic the videos its plan allows: a plain file for a CDN video, a signed stream for a Mux video", async () => {
    configureMux(true);
    expect(await playbackForLibraryVideo(kneeClinic, cdnVideo, NOW)).toEqual({ kind: "file", src: "https://example.com/vitest-cdn.mp4" });
    const stream = await playbackForLibraryVideo(kneeClinic, muxVideo, NOW);
    expect(stream?.kind).toBe("stream");
    // A placeholder is shown to a clinic that is shown placeholders.
    expect((await playbackForLibraryVideo(kneeClinic, muxPlaceholder, NOW))?.kind).toBe("stream");
  });

  it("hands out nothing to another clinic, for a category off the plan, a hidden placeholder, an unpublished or an unknown video", async () => {
    configureMux(true);
    expect(await playbackForLibraryVideo(hipClinic, muxVideo, NOW)).toBeNull();
    expect(await playbackForLibraryVideo(hipClinic, cdnVideo, NOW)).toBeNull();
    expect(await playbackForLibraryVideo(noPlaceholdersClinic, muxPlaceholder, NOW)).toBeNull();
    expect(await playbackForLibraryVideo(kneeClinic, unpublishedMux, NOW)).toBeNull();
    expect(await playbackForLibraryVideo(kneeClinic, "no-such-video", NOW)).toBeNull();
    expect(await playbackForLibraryVideo("no-such-clinic", muxVideo, NOW)).toBeNull();
  });

  it("hands out nothing to a clinic that is not open, whatever its plan says", async () => {
    configureMux(true);
    const pending = (await prisma.clinic.create({ data: { name: `Vitest playback clinic ${randomBytes(3).toString("hex")}`, status: "PENDING", categories: ["KNEE"] }, select: { id: true } })).id;
    createdClinicIds.push(pending);
    expect(await playbackForLibraryVideo(pending, muxVideo, NOW)).toBeNull();
    expect(await playbackForLibraryVideo(pending, cdnVideo, NOW)).toBeNull();
  });

  it("is unavailable for a Mux video when Mux is not configured here, and still never the CDN file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await playbackForLibraryVideo(kneeClinic, muxVideo, NOW)).toEqual({ kind: "unavailable" });
  });
});
