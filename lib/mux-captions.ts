import "server-only";
import type { CaptionState } from "./caption-state";
import { withCaptionRequestLock } from "./db/caption-lock";
import { getVideoForPulse } from "./db/videos";
import { errorKind } from "./error-kind";
import {
  CAPTION_LANGUAGE,
  MuxApiError,
  muxUploadGateway,
  muxUploadsAreConfigured,
  signedCaptionUrl,
  type AssetFacts,
  type CaptionTrackFacts,
  type MuxUploadGateway,
} from "./mux";

/**
 * Captions for a video that lives in Mux. SERVER ONLY.
 *
 * Captions are the narration written out as words on the picture, for a
 * patient who cannot hear it well, is somewhere they cannot turn the sound
 * up, or reads along to follow. Mux writes them from the video's sound
 * ("generated subtitles", Mux's speech-to-text), and keeps them on the asset
 * as an English "text" track; the player shows them when the patient or the
 * surgeon presses CC. Nothing about them is stored in our database: whether
 * a video has captions is read from Mux each time the video's page is drawn,
 * and the player finds them in the stream itself.
 *
 *   A NEW UPLOAD asks for them as it is made (createUpload in lib/mux.ts).
 *   AN EXISTING VIDEO gets them from "Add captions" on its page on
 *     /pulse/videos (requestCaptions below), which asks Mux to make them from
 *     the asset's sound track. Mux documents this for any asset (its
 *     "Generate track subtitles" call); its reference adds that customers on
 *     a contract must ask Mux support for an asset more than seven days old.
 *     If Mux refuses, the page says to upload the file again, which asks for
 *     captions as part of the upload.
 *   REVIEW. Speech-to-text gets medical words wrong. The video's page links
 *     to the caption text (an address signed here, for an hour) for a Pulse
 *     staff member to read through, with the way to correct it in Mux.
 *     Patients see the captions as soon as Mux has made them, so the review
 *     should happen straight away (see the PR that added this).
 *
 * Nothing here logs an address, a token or a body: only the kind of a failure.
 */

/** What the flow needs from outside, so the tests can hand in the stand-in (lib/testing/fake-mux.ts). */
export type CaptionDeps = {
  gateway: MuxUploadGateway;
  configured: () => boolean;
  /** The signed address of a caption track's text (lib/mux.ts). */
  captionUrl: (playbackId: string, trackId: string, expiresAt: Date) => string;
  now: () => Date;
  /** How long the page waits for Mux before saying it could not check just now. */
  checkMs: number;
};

const REAL_DEPS: CaptionDeps = {
  gateway: muxUploadGateway,
  configured: () => muxUploadsAreConfigured(),
  captionUrl: (playbackId, trackId, expiresAt) => signedCaptionUrl(playbackId, trackId, expiresAt),
  now: () => new Date(),
  checkMs: 4_000,
};

/** How long the review link on the video's page works. Long enough to read a script through; a page drawn again gets a new one. */
export const REVIEW_LINK_MS = 60 * 60_000;

export type { CaptionState };

/**
 * The English caption track that counts, if any: one that is ready, else one
 * still being made, else one that failed. A track someone uploaded in the Mux
 * dashboard (a corrected one) counts as much as a generated one.
 */
export function englishCaptionTrack(tracks: CaptionTrackFacts[]): CaptionTrackFacts | null {
  const english = tracks.filter((track) => track.languageCode.toLowerCase().startsWith(CAPTION_LANGUAGE));
  return english.find((t) => t.status === "ready") ?? english.find((t) => t.status === "preparing") ?? english.find((t) => t.status === "errored") ?? null;
}

/** Where captions stand on an asset Mux has described. */
function stateOfAsset(asset: AssetFacts, playbackId: string | null, deps: CaptionDeps): CaptionState {
  const track = englishCaptionTrack(asset.captionTracks);
  if (track?.status === "ready") {
    let reviewUrl: string | null = null;
    if (playbackId) {
      try {
        reviewUrl = deps.captionUrl(playbackId, track.id, new Date(deps.now().getTime() + REVIEW_LINK_MS));
      } catch (error) {
        // The signing key could not sign. The page says captions are ready, without the link.
        console.error(`Mux captions: could not sign the review link: ${errorKind(error)}`);
      }
    }
    return { kind: "ready", reviewUrl, name: track.name || "English" };
  }
  if (track?.status === "preparing") return { kind: "being-made" };
  if (asset.status !== "ready") return asset.status === "errored" ? { kind: "unreachable" } : { kind: "video-not-ready" };
  if (track?.status === "errored") return { kind: "failed" };
  if (!asset.audioTrackId) return { kind: "no-sound" };
  return { kind: "none" };
}

/** The facts about a video this needs: where it plays from. */
type VideoFacts = { muxPlaybackId: string | null; muxAssetId: string | null };

/**
 * Where captions stand when the answer needs no word from Mux (a CDN video,
 * Mux not set up here, no asset id), or null when Mux has to be asked. The
 * video's page draws this straight away, from the row alone.
 */
export function captionStateWithoutMux(video: VideoFacts, deps: Pick<CaptionDeps, "configured"> = REAL_DEPS): CaptionState | null {
  if (!video.muxPlaybackId) return { kind: "not-mux" };
  if (!deps.configured()) return { kind: "not-configured" };
  if (!video.muxAssetId) return { kind: "no-asset-id" };
  return null;
}

/**
 * Where a video's captions stand, asked of Mux as the page is drawn. Never
 * throws: Mux being down, or slower than deps.checkMs, is a state of its own
 * ("unreachable", said as "could not check just now" with a Check again
 * button), so the rest of the page draws as usual. The page streams this in
 * after the rest (a Suspense boundary), so a slow Mux never holds the page up.
 */
export async function readCaptionState(video: VideoFacts, deps: CaptionDeps = REAL_DEPS): Promise<CaptionState> {
  const known = captionStateWithoutMux(video, deps);
  if (known) return known;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<"too-slow">((resolve) => {
    timer = setTimeout(() => resolve("too-slow"), deps.checkMs);
  });
  try {
    const asset = await Promise.race([deps.gateway.getAsset(video.muxAssetId as string), tooSlow]);
    if (asset === "too-slow") {
      console.error("Mux captions: Mux did not answer in time; the page says it could not check just now");
      return { kind: "unreachable" };
    }
    if (!asset) return { kind: "unreachable" };
    return stateOfAsset(asset, video.muxPlaybackId, deps);
  } catch (error) {
    console.error(`Mux captions: could not read the asset: ${errorKind(error)}`);
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** The status of a refusal from Mux (400 to 499), or null for anything else (Mux down, a timeout). Read by name, as the stand-in's errors are not the class itself. */
function refusalStatus(error: unknown): number | null {
  if (!(error instanceof MuxApiError) && (error as { name?: unknown } | null)?.name !== "MuxApiError") return null;
  const status = (error as { status?: unknown }).status;
  // 401 and 403 are this deployment's token being refused: a settings problem, said as such by the action.
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401 && status !== 403 ? status : null;
}

/** What Add captions answers: a sentence for the staff member either way. */
export type CaptionRequestResult = { ok: string } | { error: string };

/** Said when Mux will not make captions for this asset: the way round it that always works. */
export const UPLOAD_AGAIN = "Upload the file again to get captions: a new upload asks Mux for them as it is made.";

/**
 * "Add captions": ask Mux to make English captions for a video already in
 * Mux. Safe to press twice: it asks Mux first whether the video has English
 * captions (ready or being made) and, if so, asks for nothing; two presses
 * at once take turns (withCaptionRequestLock), so the second hears what the
 * first did. A track that failed may be asked for again. Throws only when
 * Mux cannot be reached or answers with a failure; the action turns that
 * into words. Nothing is written to our database.
 */
export async function requestCaptions(videoId: string, deps: CaptionDeps = REAL_DEPS): Promise<CaptionRequestResult> {
  if (!deps.configured()) return { error: "Mux is not set up on this deployment (the access token or the signing key is missing), so captions cannot be asked for here." };
  const video = await getVideoForPulse(videoId);
  if (!video) return { error: "That video no longer exists." };
  if (!video.muxPlaybackId) return { error: "This video does not play from Mux, so it has no captions. Upload its file to Mux to get them." };
  const assetId = video.muxAssetId;
  if (!assetId) return { error: "This video's Mux asset id is not on its row. Copy it from the asset's page in the Mux dashboard into the Mux asset id box below, save, and try again." };

  return withCaptionRequestLock(videoId, async () => {
    const asset = await deps.gateway.getAsset(assetId);
    if (!asset) return { error: `Mux does not know this video's asset. Check the Mux asset id below. ${UPLOAD_AGAIN}` };
    const state = stateOfAsset(asset, null, deps);
    if (state.kind === "ready") return { ok: "This video already has English captions. Nothing new was asked for." };
    if (state.kind === "being-made") return { ok: "Mux is already making this video's captions. They usually take a few minutes. Nothing new was asked for." };
    if (state.kind === "video-not-ready") return { error: "Mux is still preparing this video. Try again once it is ready." };
    if (state.kind === "no-sound" || !asset.audioTrackId) return { error: "This video has no sound track in Mux, so there is no narration to write captions from." };
    if (state.kind === "unreachable") return { error: `Mux could not prepare this video, so it cannot make captions for it. ${UPLOAD_AGAIN}` };
    try {
      await deps.gateway.generateCaptions(asset.id, asset.audioTrackId);
    } catch (error) {
      // Mux answered, and said no (a 4xx): most likely an asset it will not caption any more. Mux being down throws on to the action.
      const status = refusalStatus(error);
      if (status !== null) {
        console.error(`Mux captions: the request was refused: ${status}`);
        return { error: `Mux would not make captions for this video (it answered ${status}). ${UPLOAD_AGAIN}` };
      }
      throw error;
    }
    return { ok: "Asked Mux for English captions. They usually take a few minutes; this page shows when they are ready." };
  });
}
