import { CAPTION_LANGUAGE, CAPTION_TRACK_NAME, type AssetFacts, type MuxUploadGateway, type UploadFacts } from "../mux";

/**
 * An in-memory stand-in for the parts of Mux an upload uses, for the tests.
 * Nothing in the app imports it.
 *
 * It behaves the way Mux documents direct uploads:
 *
 *   - Asking for an upload gives an id and a one-time address, and the
 *     upload sits at "waiting" until a file arrives.
 *   - When the file arrives Mux makes an asset ("preparing") and the upload
 *     becomes "asset_created" with the asset's id on it.
 *   - The asset becomes "ready" with its playback ids, or "errored".
 *   - An upload nobody sends a file to is "cancelled" (if asked) or
 *     "timed_out" (when its address runs out). Cancelling is refused once an
 *     asset exists.
 *   - An id Mux does not know answers null (a 404).
 *
 * The controls below move an upload through those states from the test, the
 * way the real Mux would behind the app's back. `failNext()` makes the next
 * call fail, for "Mux is down".
 */

type FakeUpload = {
  id: string;
  url: string;
  status: UploadFacts["status"];
  assetId: string | null;
  corsOrigin: string;
  title: string;
  externalId: string;
  /** What the upload asked Mux to caption, as the real gateway asks: English, from the narration (lib/mux.ts). */
  captions: { languageCode: string; name: string }[];
};
type FakeAsset = AssetFacts;

let serial = 0;

export function fakeMux(tag: string) {
  const next = (prefix: string) => `${prefix}vitest${tag}${(serial += 1).toString().padStart(4, "0")}`;
  const uploads = new Map<string, FakeUpload>();
  const assets = new Map<string, FakeAsset>();
  let failure: Error | null = null;
  let generateCalls = 0;

  function maybeFail() {
    if (failure) {
      const error = failure;
      failure = null;
      throw error;
    }
  }

  const gateway: MuxUploadGateway = {
    async createUpload({ corsOrigin, title, externalId }) {
      maybeFail();
      const id = next("Upload");
      const upload: FakeUpload = {
        id,
        url: `https://uploads.fake-mux.test/${id}`,
        status: "waiting",
        assetId: null,
        corsOrigin,
        title,
        externalId,
        captions: [{ languageCode: CAPTION_LANGUAGE, name: CAPTION_TRACK_NAME }],
      };
      uploads.set(id, upload);
      return { id, url: upload.url };
    },
    async getUpload(uploadId) {
      maybeFail();
      const upload = uploads.get(uploadId);
      return upload ? { id: upload.id, status: upload.status, assetId: upload.assetId } : null;
    },
    async getAsset(assetId) {
      maybeFail();
      const asset = assets.get(assetId);
      return asset ? { ...asset, playbackIds: asset.playbackIds.map((entry) => ({ ...entry })), captionTracks: asset.captionTracks.map((entry) => ({ ...entry })) } : null;
    },
    async cancelUpload(uploadId) {
      maybeFail();
      const upload = uploads.get(uploadId);
      if (!upload) throw Object.assign(new Error("Mux answered 404."), { name: "MuxApiError", status: 404 });
      if (upload.status !== "waiting") throw Object.assign(new Error("Mux answered 400."), { name: "MuxApiError", status: 400 });
      upload.status = "cancelled";
    },
    async generateCaptions(assetId, audioTrackId) {
      maybeFail();
      generateCalls += 1;
      const asset = assets.get(assetId);
      if (!asset || asset.audioTrackId !== audioTrackId) throw Object.assign(new Error("Mux answered 404."), { name: "MuxApiError", status: 404 });
      asset.captionTracks.push({ id: next("Text"), status: "preparing", languageCode: CAPTION_LANGUAGE, name: CAPTION_TRACK_NAME, generated: true });
    },
  };

  const must = (uploadId: string) => {
    const upload = uploads.get(uploadId);
    if (!upload) throw new Error(`fakeMux: no upload ${uploadId}`);
    return upload;
  };

  return {
    gateway,
    /** The uploads asked for so far, oldest first. */
    uploads: () => [...uploads.values()].map((upload) => ({ ...upload })),
    /** The file has arrived: Mux makes the asset and starts preparing it. */
    fileArrives(uploadId: string) {
      const upload = must(uploadId);
      const assetId = next("Asset");
      assets.set(assetId, { id: assetId, status: "preparing", playbackIds: [], durationSeconds: null, uploadId, audioTrackId: null, captionTracks: [] });
      upload.status = "asset_created";
      upload.assetId = assetId;
      return assetId;
    },
    /** The asset is ready, with one playback id of the given policy (signed unless a test says otherwise). */
    assetReady(uploadId: string, options: { policy?: string; durationSeconds?: number; playbackId?: string } = {}) {
      const upload = must(uploadId);
      const assetId = upload.assetId ?? this.fileArrives(uploadId);
      const asset = assets.get(assetId)!;
      const playbackId = options.playbackId ?? next("Play");
      asset.status = "ready";
      asset.playbackIds = [{ id: playbackId, policy: options.policy ?? "signed" }];
      asset.durationSeconds = options.durationSeconds ?? 125;
      asset.audioTrackId = next("Audio");
      // As Mux does for an upload that asked for them: the captions start being made once the video is ready.
      for (const caption of upload.captions) {
        asset.captionTracks.push({ id: next("Text"), status: "preparing", languageCode: caption.languageCode, name: caption.name, generated: true });
      }
      return { assetId, playbackId };
    },
    /**
     * An asset made somewhere else (the Mux dashboard, before captions were
     * asked for): ready, with a sound track (unless `silent`) and no captions.
     */
    existingAsset(options: { silent?: boolean; status?: AssetFacts["status"] } = {}) {
      const assetId = next("Asset");
      assets.set(assetId, {
        id: assetId,
        status: options.status ?? "ready",
        playbackIds: [{ id: next("Play"), policy: "signed" }],
        durationSeconds: 125,
        uploadId: null,
        audioTrackId: options.silent ? null : next("Audio"),
        captionTracks: [],
      });
      return assetId;
    },
    /** Mux has finished (or failed) every caption track it was making on this asset. */
    captionsFinish(assetId: string, status: "ready" | "errored" = "ready") {
      for (const track of assets.get(assetId)?.captionTracks ?? []) if (track.status === "preparing") track.status = status;
    },
    /** The caption tracks on an asset now. */
    captionTracks: (assetId: string) => (assets.get(assetId)?.captionTracks ?? []).map((track) => ({ ...track })),
    /** How many times Mux was asked to make captions for an existing asset. */
    generateCalls: () => generateCalls,
    /** Mux could not prepare the file. */
    assetFails(uploadId: string) {
      const upload = must(uploadId);
      const assetId = upload.assetId ?? this.fileArrives(uploadId);
      assets.get(assetId)!.status = "errored";
    },
    /** The upload itself failed before an asset existed. */
    uploadFails(uploadId: string) {
      must(uploadId).status = "errored";
    },
    /** The address ran out with no file. */
    timesOut(uploadId: string) {
      must(uploadId).status = "timed_out";
    },
    /** Cancelled in the Mux dashboard. */
    cancelled(uploadId: string) {
      must(uploadId).status = "cancelled";
    },
    /** Mux has no record of it at all. */
    forget(uploadId: string) {
      uploads.delete(uploadId);
    },
    /** The next call to Mux fails with this error (Mux unreachable, say). */
    failNext(error: Error = Object.assign(new Error("fetch failed"), { name: "TypeError" })) {
      failure = error;
    },
  };
}
