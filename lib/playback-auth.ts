import "server-only";
import { canUseVideo } from "./db/access";
import { getVideoForPlayback } from "./db/videos";
import { errorKind } from "./error-kind";
import { MUX_IMAGE_ORIGIN, MUX_STREAM_ORIGIN, muxIsConfigured, signedPlaylistUrl, signedThumbnailUrl } from "./mux";
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

/** What a source is built from: where the file lives (either may be empty) and, for the token's length, how long the video runs. */
export type PlayableVideo = { videoUrl: string | null; muxPlaybackId: string | null; durationSeconds: number | null };

/**
 * A source for one video, for a viewer whose permission ends at `windowEnd`
 * (null when only the plan governs, as in the library). The one function
 * that turns a row into something a player can load. A Mux id wins; with no
 * Mux id the CDN file plays; a video with neither (its upload has not
 * finished, and nothing lets it be published in that state) is unavailable.
 */
export function playbackForVideo(video: PlayableVideo, now: Date, windowEnd: Date | null): PlaybackSource {
  if (!usesProtectedPlayback(video) || !video.muxPlaybackId) {
    return video.videoUrl ? { kind: "file", src: video.videoUrl } : { kind: "unavailable" };
  }
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
 * What the patient page may say about the video before the "for education
 * only" box is ticked, so the phone can get ready while the patient reads:
 *
 *   origins  the bare addresses (scheme and host, nothing else) the video
 *            will come from, for the page's early-connection hints
 *            (<link rel="preconnect">): the phone looks the host up and
 *            opens the secure connection now, instead of after the tick.
 *            Mux's stream and still hosts for a video on Mux; the CDN's
 *            host for a plain file. Never a path, a playback id or a token:
 *            a host name says nothing about which video it is.
 *   stream   the video will be a Mux stream. The player then starts
 *            fetching its streaming library (hls.js) the moment the box is
 *            ticked, at the same time as the tick's own request, on the
 *            browsers that need it (see components/ui/video-source-loader.ts).
 *
 * Worked out from the same facts as playbackForVideo() (a Mux id wins, and
 * only where Mux can sign here), so the hints point where the video will
 * really come from. A video that will be unavailable gets no hints. Nothing
 * here is a permission: it plays nothing.
 */
export function earlyConnectionsFor(video: PlayableVideo): EarlyConnections {
  if (usesProtectedPlayback(video) && video.muxPlaybackId) {
    if (!muxIsConfigured()) return { origins: [], stream: false };
    return {
      // A browser keeps two kinds of connection to a host apart: the one the <video> element and its still use, and the
      // "anonymous" one a script's own requests use (hls.js fetches the stream that way on Android and Chrome). The
      // server cannot know which browser it is, so the stream host is warmed both ways; the still host only the first.
      origins: [
        { origin: MUX_STREAM_ORIGIN, anonymous: false },
        { origin: MUX_STREAM_ORIGIN, anonymous: true },
        { origin: MUX_IMAGE_ORIGIN, anonymous: false },
      ],
      stream: true,
    };
  }
  const origin = video.videoUrl ? httpsOriginOf(video.videoUrl) : null;
  return { origins: origin ? [{ origin, anonymous: false }] : [], stream: false };
}

/** See earlyConnectionsFor(). Bare origins only; safe to put in the page. */
export type EarlyConnections = { origins: { origin: string; anonymous: boolean }[]; stream: boolean };

/** The scheme and host of an https address, alone, or null for anything else. */
function httpsOriginOf(address: string): string | null {
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The picture the patient page shows on the video's box BEFORE the "for
 * education only" box is ticked: a still, never anything that plays. The
 * page's HTML carries no playable address at all until the tick (the accept
 * routes hand that out), so this is all the video's box has to show.
 *
 *   - a video on Mux: its signed still (Mux's thumbnail, a picture), bounded
 *     like any token by `windowEnd`, the link's deadline;
 *   - otherwise, or when Mux cannot sign here: the poster Pulse staff set on
 *     /pulse/videos, or nothing, and the box stays dark until the tick lets
 *     the file load its own first frame.
 *
 * Never logs: a deployment without Mux signing is reported once the patient
 * ticks the box and playbackForVideo is asked for the video itself.
 */
export function posterForVideo(video: PlayableVideo & { posterUrl: string | null }, now: Date, windowEnd: Date | null): string | null {
  if (usesProtectedPlayback(video) && video.muxPlaybackId && muxIsConfigured()) {
    const expiresAt = tokenExpiry(now, windowEnd, null);
    if (expiresAt) {
      try {
        return signedThumbnailUrl(video.muxPlaybackId, expiresAt);
      } catch {
        // A key that will not sign: no still, and the tick will show the calm "did not load" panel.
      }
    }
  }
  return video.posterUrl ?? null;
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
