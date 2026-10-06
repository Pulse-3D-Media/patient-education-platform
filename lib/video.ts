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
 */

/** The fields that say where a video lives. */
export type VideoSourceFacts = Pick<Video, "videoUrl" | "muxPlaybackId">;

/** True once the video has moved to Mux: it then plays only through a signed address, and never from its CDN file. */
export function usesProtectedPlayback(video: Pick<Video, "muxPlaybackId">): boolean {
  return Boolean(video.muxPlaybackId);
}

/**
 * Where a video's file lives, as a word for the Videos table on /pulse.
 * "Mux" once a signed playback id is on the row (the CDN address is then
 * only the record of where the file came from), "CDN" for a file on the
 * Webflow CDN, "Other" for any other https address.
 */
export function describeVideoSource(video: VideoSourceFacts): "Mux" | "CDN" | "Other" {
  if (usesProtectedPlayback(video)) return "Mux";
  return video.videoUrl.startsWith("https://cdn.prod.website-files.com/") ? "CDN" : "Other";
}
