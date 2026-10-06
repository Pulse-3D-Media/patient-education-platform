import type { Video } from "@prisma/client";

/**
 * Plain facts about where a video's file lives. Pure and safe for the
 * browser: nothing here builds an address a player could load.
 *
 * Building the address is the server's job, in lib/playback-auth.ts, which
 * is the only place a playback address is made: a plain CDN address for a
 * video still on the Webflow CDN, or a signed, expiring Mux address for a
 * video that has moved, and only for someone the server has just
 * authorized. Never read video.videoUrl in a page or component to play it;
 * ask that module. (The split keeps the signing key out of any module the
 * browser might import: see rule 8.)
 *
 * Since October 2026 a video may have no CDN address at all: one uploaded to
 * Mux from the app lives in Mux only. A video with neither an address nor a
 * Mux playback id has nothing to play, and cannot be published.
 */

/** The fields that say where a video lives. */
export type VideoSourceFacts = Pick<Video, "videoUrl" | "muxPlaybackId">;

/** True once the video has moved to Mux: it then plays only through a signed address, and never from its CDN file. */
export function usesProtectedPlayback(video: Pick<Video, "muxPlaybackId">): boolean {
  return Boolean(video.muxPlaybackId);
}

/** True when the video has something to play: a Mux playback id, or a CDN address. Publishing needs this. */
export function hasPlayableSource(video: VideoSourceFacts): boolean {
  return usesProtectedPlayback(video) || Boolean(video.videoUrl);
}

/**
 * Where a video's file lives, as a word for the Videos table on /pulse.
 * "Mux" once a signed playback id is on the row (the CDN address, if any,
 * is then only the record of where the file came from), "CDN" for a file
 * on the Webflow CDN, "Other" for any other https address, and "No file"
 * for a video that has neither yet (one whose upload has not finished).
 */
export function describeVideoSource(video: VideoSourceFacts): "Mux" | "CDN" | "Other" | "No file" {
  if (usesProtectedPlayback(video)) return "Mux";
  if (!video.videoUrl) return "No file";
  return video.videoUrl.startsWith("https://cdn.prod.website-files.com/") ? "CDN" : "Other";
}
