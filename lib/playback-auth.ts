import "server-only";
import { canUseVideo } from "./db/access";
import { getVideoForPlayback } from "./db/videos";
import { errorKind } from "./error-kind";
import { muxIsConfigured, signedPlaylistUrl, signedThumbnailUrl } from "./mux";
import { tokenExpiry, type PlaybackSource } from "./playback-source";
import { usesProtectedPlayback } from "./video";

/**
 * The only place a playback address is built. Server only.
 *
 * A player never decides what it may play; it is handed a PlaybackSource
 * (lib/playback-source.ts) made here, for a viewer the server has just
 * authorized:
 *
 *   playbackForShare()         the patient. Authorization IS the link: the
 *                              page has already found it by its code and
 *                              checked it is working and its video published.
 *                              A signed address lives no longer than the
 *                              link does.
 *   playbackForLibraryVideo()  a signed-in person in the library. The clinic
 *                              comes from the server's own idea of who is
 *                              signed in (never the browser), and the
 *                              clinic's plan is asked about the video with
 *                              the same rule that governs new links
 *                              (canUseVideo). A video id on its own, sent by
 *                              a browser, obtains nothing.
 *
 * A video still on the Webflow CDN is a plain "file" source, as in Phase 1.
 * A video that has moved to Mux is a "stream" source: a signed playlist and
 * a signed still, with the moment they stop working. When no signed address
 * can be made (Mux not configured here, or no time left on the link) the
 * answer is "unavailable", never the CDN file: see lib/playback-source.ts.
 *
 * Honest about what this protects: a signed address limits who can START
 * playing, and for how long. It does not stop a screenshot, a screen
 * recording or every form of copying, and it does not pull back video a
 * phone has already loaded. A copied address works until its token expires.
 */

/** What a source is built from: where the file lives and, for the token's length, how long the video runs. */
export type PlayableVideo = { videoUrl: string; muxPlaybackId: string | null; durationSeconds: number | null };

/**
 * A source for one video, for a viewer whose permission ends at `windowEnd`
 * (null when only the plan governs, as in the library). The one function
 * that turns a row into something a player can load.
 */
export function playbackForVideo(video: PlayableVideo, now: Date, windowEnd: Date | null): PlaybackSource {
  if (!usesProtectedPlayback(video) || !video.muxPlaybackId) return { kind: "file", src: video.videoUrl };
  if (!muxIsConfigured()) {
    // Logged once per request, never with an address: the staff fix is a setting in Vercel, not anything on the page.
    console.error("Playback: a video has moved to Mux but Mux signing is not configured on this deployment.");
    return { kind: "unavailable" };
  }
  const expiresAt = tokenExpiry(now, windowEnd, video.durationSeconds === null ? null : video.durationSeconds * 1000);
  if (!expiresAt) return { kind: "unavailable" };
  try {
    return {
      kind: "stream",
      src: signedPlaylistUrl(video.muxPlaybackId, expiresAt),
      poster: signedThumbnailUrl(video.muxPlaybackId, expiresAt),
      expiresAt: expiresAt.getTime(),
    };
  } catch (error) {
    // A key that will not sign (damaged in the settings, say). The kind only, never the key or an address.
    console.error("Playback: could not sign a Mux address.", errorKind(error));
    return { kind: "unavailable" };
  }
}

/**
 * The patient's source. The caller (the patient page, or the play recording)
 * has already checked the link is working and its video published; this
 * only bounds the token to the link's deadline. A link at or past its
 * deadline gets "unavailable" for a Mux video (a CDN file is a plain
 * address either way, which the page never reaches for an expired link).
 */
export function playbackForShare(share: { expiresAt: Date; video: PlayableVideo }, now: Date): PlaybackSource {
  return playbackForVideo(share.video, now, share.expiresAt);
}

/**
 * A source for the library: the clinic's plan is asked about the video
 * first (the same rule that lets a link be made), and nothing is signed
 * when the answer is no. Null means refused: the clinic is not open, the
 * video is not on its plan, is a placeholder it is not shown, is not
 * published, or does not exist. The clinic id is the server's, from the
 * signed-in session; a clinic id from a form is never passed here.
 */
export async function playbackForLibraryVideo(clinicId: string, videoId: string, now: Date = new Date()): Promise<PlaybackSource | null> {
  const decision = await canUseVideo(clinicId, videoId);
  if (!decision.allowed) return null;
  const video = await getVideoForPlayback(videoId);
  if (!video || !video.isPublished) return null;
  return playbackForVideo(video, now, null);
}
