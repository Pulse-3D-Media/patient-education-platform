import { describe, expect, it } from "vitest";
import { describeVideoSource, hasPlayableSource, usesProtectedPlayback } from "./video";

/** Where a video's file lives, in the Videos table's words, with plain values. */

const CDN = "https://cdn.prod.website-files.com/abc/knee.mp4";

describe("describeVideoSource", () => {
  it("says Mux once a playback id is on the row, whatever the address says", () => {
    expect(describeVideoSource({ videoUrl: CDN, muxPlaybackId: "Sig00000001" })).toBe("Mux");
    expect(describeVideoSource({ videoUrl: null, muxPlaybackId: "Sig00000001" })).toBe("Mux");
  });

  it("says CDN for the Webflow CDN, Other for another https address, and No file for a video with neither", () => {
    expect(describeVideoSource({ videoUrl: CDN, muxPlaybackId: null })).toBe("CDN");
    expect(describeVideoSource({ videoUrl: "https://example.com/knee.mp4", muxPlaybackId: null })).toBe("Other");
    expect(describeVideoSource({ videoUrl: null, muxPlaybackId: null })).toBe("No file");
    expect(describeVideoSource({ videoUrl: "", muxPlaybackId: null })).toBe("No file");
  });
});

describe("hasPlayableSource and usesProtectedPlayback", () => {
  it("a video needs a Mux id or an address to have something to play", () => {
    expect(hasPlayableSource({ videoUrl: CDN, muxPlaybackId: null })).toBe(true);
    expect(hasPlayableSource({ videoUrl: null, muxPlaybackId: "Sig00000001" })).toBe(true);
    expect(hasPlayableSource({ videoUrl: null, muxPlaybackId: null })).toBe(false);
    expect(usesProtectedPlayback({ muxPlaybackId: "Sig00000001" })).toBe(true);
    expect(usesProtectedPlayback({ muxPlaybackId: null })).toBe(false);
  });
});
