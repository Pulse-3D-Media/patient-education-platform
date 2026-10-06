import { describe, expect, it } from "vitest";
import { describeBytes, isHandledMuxEvent, parseUploadState, readMuxEvent, UPLOAD_STATE_WORDS } from "./mux-upload";

/** The plain facts of an upload, with plain values: the stored word, what the webhook reads from a body, and the megabytes line. */

describe("parseUploadState", () => {
  it("reads the three words and nothing else", () => {
    expect(parseUploadState("waiting")).toBe("waiting");
    expect(parseUploadState("preparing")).toBe("preparing");
    expect(parseUploadState("failed")).toBe("failed");
    expect(parseUploadState(null)).toBeNull();
    expect(parseUploadState(undefined)).toBeNull();
    expect(parseUploadState("")).toBeNull();
    expect(parseUploadState("READY")).toBeNull();
    expect(parseUploadState("uploading")).toBeNull();
  });

  it("has a sentence for each word, with no percentage in it", () => {
    for (const word of ["waiting", "preparing", "failed"] as const) {
      expect(UPLOAD_STATE_WORDS[word]).toMatch(/\w/);
      expect(UPLOAD_STATE_WORDS[word]).not.toMatch(/%/);
    }
  });
});

describe("readMuxEvent", () => {
  it("takes the upload's own id from an upload notification, and the asset's upload_id from an asset notification", () => {
    expect(readMuxEvent({ type: "video.upload.asset_created", data: { id: "UploadAbc12345", asset_id: "AssetAbc12345" } })).toEqual({ type: "video.upload.asset_created", uploadId: "UploadAbc12345" });
    expect(readMuxEvent({ type: "video.asset.ready", data: { id: "AssetAbc12345", upload_id: "UploadAbc12345", playback_ids: [{ id: "x", policy: "signed" }] } })).toEqual({
      type: "video.asset.ready",
      uploadId: "UploadAbc12345",
    });
  });

  it("answers no upload for an asset made without one, or a body with junk where the id should be, and null for a body that is not a notification", () => {
    expect(readMuxEvent({ type: "video.asset.ready", data: { id: "AssetAbc12345" } })).toEqual({ type: "video.asset.ready", uploadId: null });
    expect(readMuxEvent({ type: "video.asset.ready", data: { id: "AssetAbc12345", upload_id: "../../etc/passwd" } })).toEqual({ type: "video.asset.ready", uploadId: null });
    expect(readMuxEvent({ type: "video.upload.cancelled", data: { id: 42 } })).toEqual({ type: "video.upload.cancelled", uploadId: null });
    expect(readMuxEvent({ type: "video.upload.cancelled" })).toEqual({ type: "video.upload.cancelled", uploadId: null });
    expect(readMuxEvent({ data: { id: "UploadAbc12345" } })).toBeNull();
    expect(readMuxEvent("video.asset.ready")).toBeNull();
    expect(readMuxEvent(null)).toBeNull();
  });
});

describe("isHandledMuxEvent", () => {
  it("acts on the upload and asset outcomes and nothing else", () => {
    for (const type of ["video.upload.asset_created", "video.upload.cancelled", "video.upload.errored", "video.asset.ready", "video.asset.errored"]) {
      expect(isHandledMuxEvent(type), type).toBe(true);
    }
    for (const type of ["video.upload.created", "video.asset.created", "video.asset.deleted", "video.live_stream.active", "", "invoice.paid"]) {
      expect(isHandledMuxEvent(type), type).toBe(false);
    }
  });
});

describe("describeBytes", () => {
  it("rounds to whole megabytes, says gigabytes past a thousand, and never goes negative", () => {
    expect(describeBytes(0)).toBe("0 MB");
    expect(describeBytes(1024 * 1024)).toBe("1 MB");
    expect(describeBytes(480.4 * 1024 * 1024)).toBe("480 MB");
    expect(describeBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
    expect(describeBytes(-5)).toBe("0 MB");
    expect(describeBytes(Number.NaN)).toBe("0 MB");
  });
});
