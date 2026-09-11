import type { Video } from "@prisma/client";

/**
 * The only place in the app that turns a Video into a URL the player can load.
 *
 * Phase 1: the animations live on the Webflow CDN, so we hand back the stored
 * address as-is.
 *
 * Phase 2: this will return a signed, expiring URL from Mux or Cloudflare
 * Stream. Only this function changes. No page has to change.
 *
 * Never read video.videoUrl directly in a page or component. Call this instead.
 */
export function getPlaybackUrl(video: Video): string {
  return video.videoUrl;
}

/**
 * Where a video's file lives, as a word for the Videos table on /pulse.
 * Phase 1: everything is a file on the Webflow CDN. Phase 2: a video with a
 * Mux (or Cloudflare Stream) id answers "Mux" here, and getPlaybackUrl()
 * above starts returning its signed address. Same file, same pair of
 * functions, so a page never has to know which it is.
 */
export function describeVideoSource(video: Pick<Video, "videoUrl">): "CDN" | "Other" {
  return video.videoUrl.startsWith("https://cdn.prod.website-files.com/") ? "CDN" : "Other";
}
