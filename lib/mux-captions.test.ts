import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import { REVIEW_LINK_MS, UPLOAD_AGAIN, englishCaptionTrack, readCaptionState, requestCaptions, type CaptionDeps } from "./mux-captions";
import { fakeMux } from "./testing/fake-mux";

/**
 * Captions for a video in Mux (lib/mux-captions.ts), against the real test
 * database, with Mux an in-memory stand-in (lib/testing/fake-mux.ts). What
 * these prove:
 *
 *   - where captions stand is read from Mux, never stored: none, being made,
 *     ready (with a review link signed for an hour), failed, no sound, and
 *     the cases where Mux cannot be asked (a CDN video, no asset id, Mux not
 *     set up here, Mux down), none of which throws;
 *   - Add captions asks Mux once, from the asset's sound track; pressed again,
 *     or twice at the same moment, it asks for nothing more;
 *   - a refusal from Mux is answered in words, with "upload the file again";
 *     Mux being down is thrown on for the action to answer;
 *   - our database is never written.
 *
 * A stand-in is not Mux: asking for captions on a real asset in Mux's
 * Development environment, and reading them, is the check on a preview.
 */

const createdVideoIds: string[] = [];
let mux: ReturnType<typeof fakeMux>;
let signed: { playbackId: string; trackId: string; expiresAt: Date }[];
let deps: CaptionDeps;
const NOW = new Date("2026-11-17T12:00:00Z");

async function muxVideo(assetId: string | null, data: { muxPlaybackId?: string | null } = {}) {
  const video = await prisma.video.create({
    data: {
      title: `Vitest captions ${randomBytes(3).toString("hex")}`,
      category: "KNEE",
      videoUrl: null,
      muxPlaybackId: `PlayCaptions${randomBytes(6).toString("hex")}`,
      muxAssetId: assetId,
      isPublished: true,
      ...data,
    },
  });
  createdVideoIds.push(video.id);
  return video;
}

const rowOf = (id: string) => prisma.video.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  mux = fakeMux(randomBytes(2).toString("hex"));
  signed = [];
  deps = {
    gateway: mux.gateway,
    configured: () => true,
    captionUrl: (playbackId, trackId, expiresAt) => {
      signed.push({ playbackId, trackId, expiresAt });
      return `https://stream.mux.com/${playbackId}/text/${trackId}.vtt?token=made-up`;
    },
    now: () => NOW,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
});

describe("englishCaptionTrack", () => {
  it("prefers a ready English track, then one being made, then one that failed; another language never counts", () => {
    const t = (id: string, status: "ready" | "preparing" | "errored", languageCode = "en") => ({ id, status, languageCode, name: "x", generated: true });
    expect(englishCaptionTrack([t("a", "errored"), t("b", "preparing"), t("c", "ready")])?.id).toBe("c");
    expect(englishCaptionTrack([t("a", "errored"), t("b", "preparing")])?.id).toBe("b");
    expect(englishCaptionTrack([t("a", "errored")])?.id).toBe("a");
    expect(englishCaptionTrack([t("a", "ready", "es")])).toBeNull();
  });
});

describe("readCaptionState", () => {
  it("says none for an existing asset with sound and no captions, without throwing or asking for anything", async () => {
    const assetId = mux.existingAsset();
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: assetId }, deps)).toEqual({ kind: "none" });
    expect(mux.generateCalls()).toBe(0);
  });

  it("follows a new upload's captions from being made to ready, with a review link signed for an hour on the video's own playback id", async () => {
    const { id: uploadId } = await mux.gateway.createUpload({ corsOrigin: "https://learn.example.test", title: "Knee", externalId: "x" });
    const { assetId } = mux.assetReady(uploadId);
    const video = { muxPlaybackId: "PlayKnee0001", muxAssetId: assetId };
    // An upload asks for captions as it is made: they are on their way as soon as the video is ready.
    expect(await readCaptionState(video, deps)).toEqual({ kind: "being-made" });

    mux.captionsFinish(assetId);
    const [track] = mux.captionTracks(assetId);
    expect(await readCaptionState(video, deps)).toEqual({ kind: "ready", name: "English", reviewUrl: `https://stream.mux.com/PlayKnee0001/text/${track.id}.vtt?token=made-up` });
    expect(signed).toEqual([{ playbackId: "PlayKnee0001", trackId: track.id, expiresAt: new Date(NOW.getTime() + REVIEW_LINK_MS) }]);
    expect(REVIEW_LINK_MS).toBe(60 * 60_000);
  });

  it("says ready without the link when the key cannot sign it, and failed when Mux could not make them", async () => {
    const { id: uploadId } = await mux.gateway.createUpload({ corsOrigin: "https://learn.example.test", title: "Knee", externalId: "x" });
    const { assetId } = mux.assetReady(uploadId);
    mux.captionsFinish(assetId);
    deps.captionUrl = () => {
      throw new Error("Mux signing is not configured.");
    };
    expect(await readCaptionState({ muxPlaybackId: "PlayKnee0001", muxAssetId: assetId }, deps)).toEqual({ kind: "ready", name: "English", reviewUrl: null });

    const other = mux.existingAsset();
    await mux.gateway.generateCaptions(other, (await mux.gateway.getAsset(other))!.audioTrackId!);
    mux.captionsFinish(other, "errored");
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: other }, deps)).toEqual({ kind: "failed" });
  });

  it("names every case where Mux cannot be asked, and never throws", async () => {
    expect(await readCaptionState({ muxPlaybackId: null, muxAssetId: null }, deps)).toEqual({ kind: "not-mux" });
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: null }, deps)).toEqual({ kind: "no-asset-id" });
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: "AssetNobodyKnows" }, deps)).toEqual({ kind: "unreachable" });
    mux.failNext();
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: mux.existingAsset() }, deps)).toEqual({ kind: "unreachable" });
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: mux.existingAsset({ silent: true }) }, deps)).toEqual({ kind: "no-sound" });
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: mux.existingAsset({ status: "preparing" }) }, deps)).toEqual({ kind: "video-not-ready" });
    expect(await readCaptionState({ muxPlaybackId: "PlayAny0001", muxAssetId: mux.existingAsset() }, { ...deps, configured: () => false })).toEqual({ kind: "not-configured" });
  });
});

describe("requestCaptions (Add captions)", () => {
  it("asks Mux once, from the asset's sound track, and writes nothing to our database", async () => {
    const assetId = mux.existingAsset();
    const video = await muxVideo(assetId);
    const before = await rowOf(video.id);

    expect(await requestCaptions(video.id, deps)).toEqual({ ok: expect.stringMatching(/^Asked Mux for English captions/) });
    expect(mux.generateCalls()).toBe(1);
    expect(mux.captionTracks(assetId)).toEqual([expect.objectContaining({ status: "preparing", languageCode: "en", name: "English", generated: true })]);
    expect(await rowOf(video.id)).toEqual(before);
  });

  it("is safe to press twice: the second press, and a press once they are ready, ask for nothing", async () => {
    const assetId = mux.existingAsset();
    const video = await muxVideo(assetId);
    await requestCaptions(video.id, deps);
    expect(await requestCaptions(video.id, deps)).toEqual({ ok: expect.stringMatching(/already making/) });
    mux.captionsFinish(assetId);
    expect(await requestCaptions(video.id, deps)).toEqual({ ok: expect.stringMatching(/already has English captions/) });
    expect(mux.generateCalls()).toBe(1);
    expect(mux.captionTracks(assetId)).toHaveLength(1);
  });

  it("takes turns when pressed twice at the same moment: Mux is asked once", async () => {
    const assetId = mux.existingAsset();
    const video = await muxVideo(assetId);
    // Slow Mux down so both presses would have read "none" before either request landed, without the lock.
    const slowGateway = {
      ...mux.gateway,
      getAsset: async (id: string) => {
        const answer = await mux.gateway.getAsset(id);
        await new Promise((resolve) => setTimeout(resolve, 150));
        return answer;
      },
    };
    const both = await Promise.all([requestCaptions(video.id, { ...deps, gateway: slowGateway }), requestCaptions(video.id, { ...deps, gateway: slowGateway })]);
    expect(mux.generateCalls()).toBe(1);
    expect(mux.captionTracks(assetId)).toHaveLength(1);
    expect(both.map((answer) => Object.keys(answer)[0])).toEqual(["ok", "ok"]);
  });

  it("asks again for a track that failed", async () => {
    const assetId = mux.existingAsset();
    const video = await muxVideo(assetId);
    await requestCaptions(video.id, deps);
    mux.captionsFinish(assetId, "errored");
    expect(await requestCaptions(video.id, deps)).toEqual({ ok: expect.stringMatching(/^Asked Mux/) });
    expect(mux.generateCalls()).toBe(2);
  });

  it("answers in words, asking for nothing, when it cannot help: no Mux, no asset id, no sound, not ready, gone, not set up", async () => {
    const cdn = await muxVideo(null, { muxPlaybackId: null });
    expect(await requestCaptions(cdn.id, deps)).toEqual({ error: expect.stringMatching(/does not play from Mux/) });
    expect(await requestCaptions((await muxVideo(null)).id, deps)).toEqual({ error: expect.stringMatching(/asset id is not on its row/) });
    expect(await requestCaptions((await muxVideo(mux.existingAsset({ silent: true }))).id, deps)).toEqual({ error: expect.stringMatching(/no sound track/) });
    expect(await requestCaptions((await muxVideo(mux.existingAsset({ status: "preparing" }))).id, deps)).toEqual({ error: expect.stringMatching(/still preparing/) });
    expect(await requestCaptions((await muxVideo("AssetNobodyKnows")).id, deps)).toEqual({ error: expect.stringContaining(UPLOAD_AGAIN) });
    expect(await requestCaptions((await muxVideo(mux.existingAsset())).id, { ...deps, configured: () => false })).toEqual({ error: expect.stringMatching(/not set up/) });
    expect(await requestCaptions("clz0000000000000000000000", deps)).toEqual({ error: "That video no longer exists." });
    expect(mux.generateCalls()).toBe(0);
  });

  it("says to upload the file again when Mux refuses, and throws Mux being down (or a refused token) on to the action", async () => {
    const video = await muxVideo(mux.existingAsset());
    const refusing = (status: number) => ({
      ...mux.gateway,
      generateCaptions: async () => {
        throw Object.assign(new Error(`Mux answered ${status}.`), { name: "MuxApiError", status });
      },
    });
    expect(await requestCaptions(video.id, { ...deps, gateway: refusing(400) })).toEqual({ error: `Mux would not make captions for this video (it answered 400). ${UPLOAD_AGAIN}` });
    await expect(requestCaptions(video.id, { ...deps, gateway: refusing(401) })).rejects.toMatchObject({ status: 401 });
    await expect(requestCaptions(video.id, { ...deps, gateway: refusing(503) })).rejects.toMatchObject({ status: 503 });
    mux.failNext();
    await expect(requestCaptions(video.id, deps)).rejects.toThrow("fetch failed");
  });
});
