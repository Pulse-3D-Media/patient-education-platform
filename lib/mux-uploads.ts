import "server-only";
import { applyReadyUpload, clearUpload, dismissUploadFailure, findVideoIdByUploadId, getVideoUpload, markUploadStarted, setUploadState } from "./db/videos";
import { errorKind } from "./error-kind";
import { checkPlaybackId, muxUploadGateway, muxUploadsAreConfigured, type MuxUploadGateway, type PlaybackIdCheck } from "./mux";
import { UPLOAD_STATE_WORDS } from "./mux-upload";

/**
 * Uploading a video to Mux from the app. SERVER ONLY. The whole story is at
 * the top of lib/mux-upload.ts; this file is the three things the server
 * does, and the one rule that keeps them honest:
 *
 *   startUpload()      asks Mux for a one-time upload address, remembers the
 *                      upload on the video's row, and hands the address to
 *                      the browser (and to nobody else: it is never logged).
 *   reconcileUpload()  asks Mux where an upload stands NOW and applies that
 *                      to the row. The webhook and the "Check with Mux"
 *                      button both end here, so neither grants anything the
 *                      other would not, and a notification is never believed
 *                      on its own, exactly as the Stripe webhook works.
 *   cancelUpload()     asks Mux to cancel an upload whose file has not
 *                      arrived, and clears the row.
 *
 * THE RULE: the row changes only when Mux says the asset is ready, and only
 * if the row is still waiting for THAT upload. Every write here says "where
 * the video's in-flight upload is this one" (the muxUploadId column), so a
 * late notification about an upload a staff member has since replaced
 * changes nothing, and two notifications about the same upload, or a
 * notification and a button press at once, end in the same row. The video
 * keeps playing whatever it had until that one write.
 *
 * Nothing from Mux is logged but a status or the kind of an error.
 */

/** What the flow needs from outside, so the tests can hand in the stand-in (lib/testing/fake-mux.ts). */
export type UploadDeps = {
  gateway: MuxUploadGateway;
  /** The check the catalogue runs before any playback id is saved (lib/mux.ts): the policy is signed and this deployment's key opens it. */
  checkPlaybackId: (playbackId: string) => Promise<PlaybackIdCheck>;
  configured: () => boolean;
};

const REAL_DEPS: UploadDeps = { gateway: muxUploadGateway, checkPlaybackId: (id) => checkPlaybackId(id), configured: () => muxUploadsAreConfigured() };

/** Said wherever uploads cannot be offered on this deployment. */
export const UPLOADS_NOT_CONFIGURED = "Mux uploads are not set up on this deployment: the Mux access token or the signing key is missing. Pasting a playback id still works.";

export type StartUploadResult = { ok: true; uploadId: string; url: string } | { ok: false; error: string };

/**
 * Begin an upload for one video. The caller has checked for Pulse staff and
 * worked out `corsOrigin` from a trusted origin (lib/trusted-origin.ts):
 * Mux lets only a browser on that address send the file.
 *
 * An upload already in flight for the video is replaced: the row now waits
 * for the new one, and the old one is cancelled at Mux as a courtesy (a
 * failure there changes nothing: the old upload can no longer touch the
 * row, and Mux times it out on its own).
 */
export async function startUpload(videoId: string, corsOrigin: string, deps: UploadDeps = REAL_DEPS): Promise<StartUploadResult> {
  if (!deps.configured()) return { ok: false, error: UPLOADS_NOT_CONFIGURED };
  const video = await getVideoUpload(videoId);
  if (!video) return { ok: false, error: "That video no longer exists." };

  const upload = await deps.gateway.createUpload({ corsOrigin });
  const previous = await markUploadStarted(videoId, upload.id);
  if (previous.muxUploadId && previous.muxUploadId !== upload.id) {
    try {
      await deps.gateway.cancelUpload(previous.muxUploadId);
    } catch (error) {
      console.error("Mux: could not cancel a replaced upload.", errorKind(error));
    }
  }
  return { ok: true, uploadId: upload.id, url: upload.url };
}

/** What one look at an upload came to. The message is for the staff member; the kind is for the tests and the log. */
export type ReconcileOutcome = {
  kind: "unknown" | "waiting" | "preparing" | "ready" | "failed" | "cancelled" | "superseded" | "not-confirmed";
  message: string;
};

/**
 * Ask Mux where an upload stands and apply it. Safe to call any number of
 * times, in any order, from the webhook or the button: Mux's current answer
 * is the truth, and the row is written only where it still waits for this
 * upload. Throws when Mux or the database cannot be reached, so a webhook
 * answers 500 and Mux sends the notification again.
 */
export async function reconcileUpload(uploadId: string, deps: UploadDeps = REAL_DEPS): Promise<ReconcileOutcome> {
  const videoId = await findVideoIdByUploadId(uploadId);
  if (!videoId) {
    // Not an error: an upload made in the Mux dashboard, or one a staff member replaced and this app has forgotten.
    console.error("Mux: a notification named an upload that is not on any video. Nothing was changed.");
    return { kind: "unknown", message: "Mux reported an upload this app does not know. Nothing was changed." };
  }

  const upload = await deps.gateway.getUpload(uploadId);
  if (!upload) {
    await clearUpload(videoId, uploadId, "failed");
    return { kind: "failed", message: "Mux has no record of this upload. The video was left as it was." };
  }

  switch (upload.status) {
    case "waiting":
      await setUploadState(videoId, uploadId, "waiting");
      return { kind: "waiting", message: UPLOAD_STATE_WORDS.waiting };
    case "cancelled":
      await clearUpload(videoId, uploadId, null);
      return { kind: "cancelled", message: "The upload was cancelled. The video is as it was." };
    case "timed_out":
      await clearUpload(videoId, uploadId, "failed");
      return { kind: "failed", message: "The upload address ran out before the file arrived. The video was left as it was. Choose the file and upload again." };
    case "errored":
      await clearUpload(videoId, uploadId, "failed");
      return { kind: "failed", message: "Mux reported an error with the upload. The video was left as it was. Choose the file and upload again." };
    case "asset_created":
      break;
  }

  const asset = upload.assetId ? await deps.gateway.getAsset(upload.assetId) : null;
  if (!asset) {
    // Mux says an asset exists but will not show it yet (or it was deleted in the dashboard). Keep waiting; the next look may find it.
    await setUploadState(videoId, uploadId, "preparing");
    return { kind: "preparing", message: UPLOAD_STATE_WORDS.preparing };
  }
  if (asset.status === "preparing") {
    await setUploadState(videoId, uploadId, "preparing");
    return { kind: "preparing", message: UPLOAD_STATE_WORDS.preparing };
  }
  if (asset.status === "errored") {
    await clearUpload(videoId, uploadId, "failed");
    return { kind: "failed", message: "Mux could not prepare the file (it may not be a video it can read). The video was left as it was." };
  }

  // Ready. Only a SIGNED playback id is ever written: the asset was asked for
  // with that policy, and the check below proves it, and that this
  // deployment's signing key opens it, before anything changes.
  const signed = asset.playbackIds.find((entry) => entry.policy === "signed");
  if (!signed) {
    console.error("Mux: an uploaded asset is ready but has no signed playback id. Nothing was written.");
    await clearUpload(videoId, uploadId, "failed");
    return { kind: "failed", message: "Mux prepared the file but gave it no signed playback id, so it was not put on the video. Check the asset in the Mux dashboard." };
  }
  const check = await deps.checkPlaybackId(signed.id);
  if (!check.ok) {
    // The asset is fine; the key here may not be. Leave the upload in flight so Check with Mux can try again once the settings are right.
    console.error("Mux: an uploaded asset is ready but its playback id could not be confirmed.", check.reason);
    await setUploadState(videoId, uploadId, "preparing");
    return { kind: "not-confirmed", message: `The new file is ready at Mux but could not be confirmed, so the video was left as it was. ${check.message}` };
  }

  const applied = await applyReadyUpload(videoId, uploadId, { playbackId: signed.id, assetId: asset.id, durationSeconds: asset.durationSeconds });
  if (!applied) return { kind: "superseded", message: "A newer upload has replaced this one. Nothing was changed." };
  return { kind: "ready", message: "The new file is ready. The video, and every link that points at it, now plays it." };
}

/** The "Check with Mux" button: look at the video's upload in flight, if it has one. */
export async function checkUpload(videoId: string, deps: UploadDeps = REAL_DEPS): Promise<ReconcileOutcome> {
  const video = await getVideoUpload(videoId);
  if (!video) return { kind: "unknown", message: "That video no longer exists." };
  if (!video.muxUploadId) return { kind: "unknown", message: "No upload is in flight for this video." };
  return reconcileUpload(video.muxUploadId, deps);
}

/**
 * The "Cancel upload" button. Mux can cancel an upload only while it is
 * waiting for the file; once the file has arrived the asset is being made,
 * and the honest answer is where it stands, so a refusal from Mux is
 * followed by a look.
 */
export async function cancelUpload(videoId: string, deps: UploadDeps = REAL_DEPS): Promise<ReconcileOutcome> {
  const video = await getVideoUpload(videoId);
  if (!video) return { kind: "unknown", message: "That video no longer exists." };
  if (!video.muxUploadId) return { kind: "unknown", message: "No upload is in flight for this video." };
  try {
    await deps.gateway.cancelUpload(video.muxUploadId);
  } catch (error) {
    console.error("Mux: could not cancel an upload; looking at it instead.", errorKind(error));
    return reconcileUpload(video.muxUploadId, deps);
  }
  await clearUpload(videoId, video.muxUploadId, null);
  return { kind: "cancelled", message: "The upload was cancelled. The video is as it was." };
}

/** The "Dismiss" on a failed upload's line. Clears the word; nothing else on the row is touched. */
export async function dismissFailure(videoId: string): Promise<void> {
  await dismissUploadFailure(videoId);
}
