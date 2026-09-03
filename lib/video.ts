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
