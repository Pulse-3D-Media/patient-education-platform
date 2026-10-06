import { isPlaybackIdShape } from "./playback-source";

/**
 * Uploading a video to Mux from /pulse/videos: the plain facts both sides
 * share. Pure and safe for the browser: no key, no database, no Mux.
 *
 * How an upload works, in one paragraph. A staff member chooses a file on a
 * video's page. The server asks Mux for a one-time upload address (Mux calls
 * it a "direct upload") and hands that address to the browser, which sends
 * the file STRAIGHT to Mux: the file never passes through our server, which
 * could not take a file that size. Mux then makes an asset from the file,
 * with the SIGNED playback policy, and tells us when it is ready, by a
 * webhook (app/api/webhooks/mux) and by the "Check with Mux" button on the
 * video's page. When it is ready the new playback id and asset id are
 * written onto the SAME Video row, so every link already sent keeps working
 * and simply starts playing the new file. Until that moment the video keeps
 * playing whatever it had: the CDN file, or its old Mux asset.
 *
 * While all that happens the row remembers the upload in two columns:
 * Video.muxUploadId (Mux's id for the upload, so an event about it finds
 * the row) and Video.muxUploadState, one of the words below.
 */

/**
 * Where an upload stands, as stored in Video.muxUploadState.
 *
 *   "waiting"    the upload address was handed out; Mux has not received
 *                the file yet (it is being sent from a browser, or that
 *                browser was closed and nothing will arrive).
 *   "preparing"  Mux has the whole file and is making the asset. Usually a
 *                minute or two for an animation.
 *   "failed"     the last upload did not finish (Mux could not read the
 *                file, the address ran out before the file arrived, or Mux
 *                reported an error). The row was left exactly as it was.
 *                Shown until the staff member dismisses it or starts again.
 *
 * Nothing stored (null) means no upload in flight and nothing to report.
 */
export const UPLOAD_STATES = ["waiting", "preparing", "failed"] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

/** Read the stored word back. Anything else (a hand edit, say) reads as nothing to report. */
export function parseUploadState(value: string | null | undefined): UploadState | null {
  return (UPLOAD_STATES as readonly string[]).includes(value ?? "") ? (value as UploadState) : null;
}

/** The sentence the video's page shows for each state. Plain words, no percentages: Mux gives none worth repeating. */
export const UPLOAD_STATE_WORDS: Record<UploadState, string> = {
  waiting: "An upload has been started and Mux is waiting for the file. If it is being sent from another tab, leave that tab open until it finishes.",
  preparing: "Mux has the file and is preparing it. This usually takes a minute or two. The video keeps playing what it had until the new file is ready.",
  failed: "The last upload did not finish. The video was left as it was.",
};

/**
 * The kinds of Mux notification the webhook acts on. Each one is only a
 * reason to look: the webhook takes the upload id from the notification and
 * asks Mux where that upload stands now (reconcileUpload in
 * lib/mux-uploads.ts), exactly as the Stripe webhook does. Anything else
 * Mux sends is answered and dropped.
 */
export const HANDLED_MUX_EVENTS = [
  "video.upload.asset_created",
  "video.upload.cancelled",
  "video.upload.errored",
  "video.asset.ready",
  "video.asset.errored",
] as const;

export function isHandledMuxEvent(type: string): boolean {
  return (HANDLED_MUX_EVENTS as readonly string[]).includes(type);
}

/**
 * The two facts the webhook reads from a notification's body: its kind, and
 * which upload it is about. An upload notification carries the upload's id
 * as the object's own id; an asset notification carries the upload the
 * asset came from as `upload_id`. Nothing else in the body is read, and
 * nothing is believed: the upload's state is asked of Mux afterwards.
 */
export function readMuxEvent(body: unknown): { type: string; uploadId: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const event = body as { type?: unknown; data?: unknown };
  if (typeof event.type !== "string") return null;
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as { id?: unknown; upload_id?: unknown };
  const uploadId = event.type.startsWith("video.upload.") ? data.id : data.upload_id;
  return { type: event.type, uploadId: typeof uploadId === "string" && isPlaybackIdShape(uploadId) ? uploadId : null };
}

/**
 * How big a file the upload control accepts. Mux's own limit is far higher;
 * this stops a wrong file (a whole screen recording, a disk image) being
 * sent by mistake. Finished animations are tens to a few hundred megabytes.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/** The file kinds the control accepts: MP4 and QuickTime, which is what the animation tools export. */
export const ACCEPTED_UPLOAD_TYPES = "video/mp4,video/quicktime,.mp4,.mov";

/** Megabytes as a staff member would read them, for the "sent so far" line. Exact bytes, rounded, never a made-up percentage. */
export function describeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
