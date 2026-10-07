import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import type { PlaybackIdCheck } from "./mux";
import { UPLOADS_NOT_CONFIGURED, cancelUpload, checkUpload, reconcileUpload, startUpload, type UploadDeps } from "./mux-uploads";
import { fakeMux } from "./testing/fake-mux";

/**
 * The upload flow against the real test database, with Mux an in-memory
 * stand-in (lib/testing/fake-mux.ts). What these prove:
 *
 *   - starting an upload remembers it on the row and hands out the address,
 *     and only where uploads are configured;
 *   - the row's old playback id (or CDN file) stays in force until the very
 *     moment Mux says the new asset is ready, and then the new ids land on
 *     the SAME row;
 *   - the same "ready" seen twice (two notifications, or a notification and
 *     the button) writes once; the webhook and the button reach the same
 *     outcome because they are the same function;
 *   - an upload nobody knows is ignored; a failure, a cancellation and a
 *     timeout leave the row as it was; an upload a staff member replaced
 *     cannot touch the row when it finally finishes;
 *   - only a SIGNED playback id is ever written, and only once the same
 *     check the catalogue runs has passed.
 *
 * A stand-in is not Mux: one real upload on a preview is the other check.
 */

const createdVideoIds: string[] = [];
const ORIGIN = "https://learn.example.test";

async function cdnVideo(data: { muxPlaybackId?: string; muxAssetId?: string; videoUrl?: string | null; durationSeconds?: number | null } = {}) {
  const video = await prisma.video.create({
    data: {
      title: `Vitest upload ${randomBytes(3).toString("hex")}`,
      category: "KNEE",
      videoUrl: "https://cdn.prod.website-files.com/test/vitest-upload.mp4",
      durationSeconds: null,
      isPublished: true,
      ...data,
    },
  });
  createdVideoIds.push(video.id);
  return video;
}

const row = (id: string) =>
  prisma.video.findUniqueOrThrow({ where: { id }, select: { videoUrl: true, muxPlaybackId: true, muxAssetId: true, muxUploadId: true, muxUploadState: true, durationSeconds: true } });

let mux: ReturnType<typeof fakeMux>;
let checks: string[];
let checkAnswer: PlaybackIdCheck;
let deps: UploadDeps;

beforeEach(() => {
  mux = fakeMux(randomBytes(2).toString("hex"));
  checks = [];
  checkAnswer = { ok: true };
  deps = {
    gateway: mux.gateway,
    checkPlaybackId: async (id) => {
      checks.push(id);
      return checkAnswer;
    },
    configured: () => true,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
});

describe("startUpload", () => {
  it("asks Mux for an address for this deployment's origin, remembers the upload on the row at waiting, and changes nothing else", async () => {
    const video = await cdnVideo();
    const result = await startUpload(video.id, ORIGIN, deps);
    expect(result).toMatchObject({ ok: true, uploadId: expect.any(String), url: expect.stringContaining("https://") });

    const [upload] = mux.uploads();
    expect(upload.corsOrigin).toBe(ORIGIN);
    // The asset is named after the video, so it reads as the video in the Mux dashboard.
    expect(upload.title).toBe(video.title);
    expect(upload.externalId).toBe(video.id);
    expect(await row(video.id)).toEqual({
      videoUrl: video.videoUrl,
      muxPlaybackId: null,
      muxAssetId: null,
      muxUploadId: upload.id,
      muxUploadState: "waiting",
      durationSeconds: null,
    });
  });

  it("refuses where uploads are not configured, and for a video that does not exist, asking Mux for nothing", async () => {
    const video = await cdnVideo();
    expect(await startUpload(video.id, ORIGIN, { ...deps, configured: () => false })).toEqual({ ok: false, error: UPLOADS_NOT_CONFIGURED });
    expect(await startUpload("no-such-video", ORIGIN, deps)).toEqual({ ok: false, error: "That video no longer exists." });
    expect(mux.uploads()).toHaveLength(0);
    expect(await row(video.id)).toMatchObject({ muxUploadId: null, muxUploadState: null });
  });

  it("replaces an upload already in flight: the row waits for the new one, and the old one is cancelled at Mux", async () => {
    const video = await cdnVideo();
    const first = await startUpload(video.id, ORIGIN, deps);
    const second = await startUpload(video.id, ORIGIN, deps);
    if (!first.ok || !second.ok) throw new Error("both should start");
    expect(await row(video.id)).toMatchObject({ muxUploadId: second.uploadId, muxUploadState: "waiting" });
    expect(mux.uploads().find((upload) => upload.id === first.uploadId)?.status).toBe("cancelled");
  });

  it("writes nothing when Mux cannot be reached", async () => {
    const video = await cdnVideo();
    mux.failNext();
    await expect(startUpload(video.id, ORIGIN, deps)).rejects.toThrow();
    expect(await row(video.id)).toMatchObject({ muxUploadId: null, muxUploadState: null });
  });
});

describe("reconcileUpload: the row follows what Mux says, and only then", () => {
  it("keeps the old file in force through waiting and preparing, then puts the new signed id and asset id on the SAME row when ready", async () => {
    const oldId = `Vitest${randomBytes(6).toString("hex")}`;
    const video = await cdnVideo({ muxPlaybackId: oldId });
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");

    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "waiting" });
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: oldId, muxUploadState: "waiting" });

    mux.fileArrives(started.uploadId);
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "preparing" });
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: oldId, muxUploadState: "preparing" });
    expect(checks).toEqual([]);

    const { assetId, playbackId } = mux.assetReady(started.uploadId, { durationSeconds: 242 });
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "ready" });
    expect(checks).toEqual([playbackId]);
    expect(await row(video.id)).toEqual({
      videoUrl: video.videoUrl,
      muxPlaybackId: playbackId,
      muxAssetId: assetId,
      muxUploadId: null,
      muxUploadState: null,
      durationSeconds: 242,
    });
    expect(await prisma.video.count({ where: { title: video.title } })).toBe(1);
  });

  it("the same ready seen again (a repeat notification, the button, both at once) writes once, and keeps a length a staff member typed", async () => {
    const video = await cdnVideo({ durationSeconds: 99 });
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    const { playbackId } = mux.assetReady(started.uploadId, { durationSeconds: 242 });

    const outcomes = await Promise.all([reconcileUpload(started.uploadId, deps), reconcileUpload(started.uploadId, deps), checkUpload(video.id, deps)]);
    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds.filter((kind) => kind === "ready")).toHaveLength(1);
    expect(kinds.every((kind) => kind === "ready" || kind === "unknown" || kind === "superseded")).toBe(true);
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: playbackId, muxUploadId: null, durationSeconds: 99 });

    // Later notifications about an upload the row has finished with change nothing.
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "unknown" });
    expect(await checkUpload(video.id, deps)).toMatchObject({ kind: "unknown", message: "No upload is in flight for this video." });
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: playbackId });
  });

  it("ignores an upload no video is waiting for, writing nothing", async () => {
    const video = await cdnVideo();
    expect(await reconcileUpload("UploadNobodyKnows00", deps)).toMatchObject({ kind: "unknown" });
    expect(await row(video.id)).toMatchObject({ muxUploadId: null, muxPlaybackId: null });
  });

  it("a failed upload, a failed asset, a timeout and an upload Mux has forgotten leave the row as it was, marked failed", async () => {
    const oldId = `Vitest${randomBytes(6).toString("hex")}`;
    for (const breakIt of ["uploadFails", "assetFails", "timesOut", "forget"] as const) {
      const video = await cdnVideo({ muxPlaybackId: oldId + breakIt.length, muxAssetId: "AssetOld0000000" });
      const started = await startUpload(video.id, ORIGIN, deps);
      if (!started.ok) throw new Error("should start");
      mux[breakIt](started.uploadId);
      expect(await reconcileUpload(started.uploadId, deps), breakIt).toMatchObject({ kind: "failed" });
      expect(await row(video.id), breakIt).toEqual({
        videoUrl: video.videoUrl,
        muxPlaybackId: oldId + breakIt.length,
        muxAssetId: "AssetOld0000000",
        muxUploadId: null,
        muxUploadState: "failed",
        durationSeconds: null,
      });
    }
    expect(checks).toEqual([]);
  });

  it("a cancellation (in the dashboard, or by the button) clears the upload with nothing to report", async () => {
    const video = await cdnVideo();
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    mux.cancelled(started.uploadId);
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "cancelled" });
    expect(await row(video.id)).toMatchObject({ muxUploadId: null, muxUploadState: null, muxPlaybackId: null });

    const again = await startUpload(video.id, ORIGIN, deps);
    if (!again.ok) throw new Error("should start");
    expect(await cancelUpload(video.id, deps)).toMatchObject({ kind: "cancelled" });
    expect(await row(video.id)).toMatchObject({ muxUploadId: null, muxUploadState: null });
    expect(mux.uploads().find((upload) => upload.id === again.uploadId)?.status).toBe("cancelled");
  });

  it("the button cannot cancel once the file has arrived: Mux refuses, and the honest answer is where the upload stands", async () => {
    const video = await cdnVideo();
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    mux.fileArrives(started.uploadId);
    expect(await cancelUpload(video.id, deps)).toMatchObject({ kind: "preparing" });
    expect(await row(video.id)).toMatchObject({ muxUploadId: started.uploadId, muxUploadState: "preparing" });
  });

  it("an upload a staff member replaced cannot touch the row when it finally finishes", async () => {
    const video = await cdnVideo();
    const first = await startUpload(video.id, ORIGIN, deps);
    const second = await startUpload(video.id, ORIGIN, deps);
    if (!first.ok || !second.ok) throw new Error("both should start");

    // The fake cancelled the first at Mux; pretend Mux had already taken the file and finished it anyway.
    mux.uploads();
    mux.cancelled(first.uploadId);
    const stale = mux.assetReady(second.uploadId);
    // The first upload's notification arrives: nobody is waiting for it.
    expect(await reconcileUpload(first.uploadId, deps)).toMatchObject({ kind: "unknown" });
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: null, muxUploadId: second.uploadId });
    // The second's does the work.
    expect(await reconcileUpload(second.uploadId, deps)).toMatchObject({ kind: "ready" });
    expect(await row(video.id)).toMatchObject({ muxPlaybackId: stale.playbackId, muxUploadId: null });
  });

  it("never writes a playback id that is not signed, and never one the catalogue's check refuses (the upload stays so it can be checked again)", async () => {
    const publicVideo = await cdnVideo();
    const started = await startUpload(publicVideo.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    mux.assetReady(started.uploadId, { policy: "public" });
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "failed", message: expect.stringContaining("no signed playback id") });
    expect(await row(publicVideo.id)).toMatchObject({ muxPlaybackId: null, muxUploadId: null, muxUploadState: "failed" });
    expect(checks).toEqual([]);

    const keyVideo = await cdnVideo();
    const second = await startUpload(keyVideo.id, ORIGIN, deps);
    if (!second.ok) throw new Error("should start");
    const { playbackId } = mux.assetReady(second.uploadId);
    checkAnswer = { ok: false, reason: "refused", message: "Mux refused the signed request for that id (status 403)." };
    expect(await reconcileUpload(second.uploadId, deps)).toMatchObject({ kind: "not-confirmed", message: expect.stringContaining("status 403") });
    expect(await row(keyVideo.id)).toMatchObject({ muxPlaybackId: null, muxUploadId: second.uploadId, muxUploadState: "preparing" });

    // The key is fixed; Check with Mux now finishes the job.
    checkAnswer = { ok: true };
    expect(await checkUpload(keyVideo.id, deps)).toMatchObject({ kind: "ready" });
    expect(await row(keyVideo.id)).toMatchObject({ muxPlaybackId: playbackId, muxUploadId: null, muxUploadState: null });
  });

  it("a video that lives in Mux only (no CDN address) is uploaded to the same way", async () => {
    const video = await cdnVideo({ videoUrl: null });
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    const { playbackId, assetId } = mux.assetReady(started.uploadId);
    expect(await reconcileUpload(started.uploadId, deps)).toMatchObject({ kind: "ready" });
    expect(await row(video.id)).toMatchObject({ videoUrl: null, muxPlaybackId: playbackId, muxAssetId: assetId });
  });

  it("throws, writing nothing, when Mux cannot be reached, so the webhook answers 500 and Mux tries again", async () => {
    const video = await cdnVideo();
    const started = await startUpload(video.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    mux.failNext();
    await expect(reconcileUpload(started.uploadId, deps)).rejects.toThrow();
    expect(await row(video.id)).toMatchObject({ muxUploadId: started.uploadId, muxUploadState: "waiting" });
  });

  it("one video's upload never touches another's", async () => {
    const a = await cdnVideo();
    const b = await cdnVideo({ muxPlaybackId: `Vitest${randomBytes(6).toString("hex")}` });
    const started = await startUpload(a.id, ORIGIN, deps);
    if (!started.ok) throw new Error("should start");
    mux.assetReady(started.uploadId);
    await reconcileUpload(started.uploadId, deps);
    expect(await row(b.id)).toMatchObject({ muxPlaybackId: b.muxPlaybackId, muxUploadId: null, muxUploadState: null });
  });
});
