import "server-only";
import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { isPlaybackIdShape } from "./playback-source";

/**
 * The only file that talks to Mux, and the only file that holds the signing
 * key. Server only: the "server-only" guard at the top makes the build fail
 * if browser code ever imports it, the same guard lib/db/client.ts carries.
 *
 * Mux hosts the finished animations once they move off the Webflow CDN.
 * Every video there has a playback id with the SIGNED policy, which means
 * Mux refuses any request for it that does not carry a token this file
 * made. A token is a short signed note (a JWT, signed with RS256) saying
 * which playback id, for what (the video, or a still from it), and until
 * when. Mux publishes the format in its secure playback guide; nothing here
 * is a guess at it.
 *
 * Two settings, in .env and in Vercel, never in code (rule 7):
 *
 *   MUX_SIGNING_KEY_ID        the id of a signing key made in the Mux
 *                             dashboard (Settings, Signing Keys). Not secret
 *                             on its own, but a setting.
 *   MUX_SIGNING_PRIVATE_KEY   the private half of that key, as Mux hands it
 *                             out: the PEM text, base64 encoded. A SECRET. The
 *                             plain PEM is accepted too.
 *
 * With either missing nothing can be signed: muxIsConfigured() says so, a
 * video that has moved to Mux is "unavailable" to its players (never the CDN
 * file instead), and the catalogue refuses to save a playback id, because it
 * cannot check one. Every other video plays as before.
 *
 * No Mux package is installed (rule 6): a token is a few lines of Node's own
 * crypto, and the one check against Mux's servers is a plain HTTPS fetch.
 * Nothing here ever logs a token, a signed address or the key.
 */

/** The two settings, read from process.env unless a test hands in its own. */
export type MuxEnv = {
  MUX_SIGNING_KEY_ID?: string;
  MUX_SIGNING_PRIVATE_KEY?: string;
  MUX_TOKEN_ID?: string;
  MUX_TOKEN_SECRET?: string;
  MUX_WEBHOOK_SECRET?: string;
  [name: string]: string | undefined;
};

/** What a token is for. Mux uses a different audience for each, and a token for one is refused for another. */
export type MuxAudience = "video" | "thumbnail";

const AUDIENCE_CODE: Record<MuxAudience, string> = { video: "v", thumbnail: "t" };

/** Where Mux serves playlists and stills from. Both are in the content policy (lib/security-headers.ts). */
export const MUX_STREAM_ORIGIN = "https://stream.mux.com";
export const MUX_IMAGE_ORIGIN = "https://image.mux.com";

/** True when both settings are present and the key reads as a PEM key. */
export function muxIsConfigured(env: MuxEnv = process.env): boolean {
  return Boolean(env.MUX_SIGNING_KEY_ID?.trim()) && readPrivateKey(env) !== null;
}

/** The private key as PEM text, whichever way it was stored, or null when it is missing or not a PEM key. */
function readPrivateKey(env: MuxEnv): string | null {
  const raw = env.MUX_SIGNING_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const pem = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return pem.includes("-----BEGIN") && pem.includes("PRIVATE KEY-----") ? pem : null;
}

/** Base64 as a JWT wants it: no padding, URL-safe letters. */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** The extra claims a thumbnail token may carry. For a signed address they go in the token, never on the URL (Mux refuses a signed URL with other parameters). */
export type ThumbnailOptions = { time?: number; width?: number };

/**
 * Make one token. Throws a plain Error when Mux is not configured; callers
 * ask muxIsConfigured() first or catch it (lib/playback-auth.ts does).
 *
 * The claims, as Mux documents them: sub (the playback id), aud ("v" for
 * the video, "t" for a still), exp (seconds since 1970), kid (the signing
 * key's id; put in the header too, which is where the common libraries put
 * it, so either reading finds it), and for a still the picture's options.
 */
export function signPlaybackToken(
  playbackId: string,
  audience: MuxAudience,
  expiresAt: Date,
  options: ThumbnailOptions = {},
  env: MuxEnv = process.env,
): string {
  const keyId = env.MUX_SIGNING_KEY_ID?.trim();
  const privateKey = readPrivateKey(env);
  if (!keyId || !privateKey) throw new Error("Mux signing is not configured.");
  if (!isPlaybackIdShape(playbackId)) throw new Error("Not a Mux playback id.");

  const header = { alg: "RS256", typ: "JWT", kid: keyId };
  const claims: Record<string, string | number> = {
    sub: playbackId,
    aud: AUDIENCE_CODE[audience],
    exp: Math.floor(expiresAt.getTime() / 1000),
    kid: keyId,
  };
  if (audience === "thumbnail") {
    if (options.time !== undefined) claims.time = options.time;
    if (options.width !== undefined) claims.width = options.width;
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

/** The signed HLS playlist address for a video. The token is the only parameter, as Mux requires. */
export function signedPlaylistUrl(playbackId: string, expiresAt: Date, env: MuxEnv = process.env): string {
  return `${MUX_STREAM_ORIGIN}/${playbackId}.m3u8?token=${signPlaybackToken(playbackId, "video", expiresAt, {}, env)}`;
}

/** The signed address of one still from the video, at `time` seconds, `width` pixels across. */
export function signedThumbnailUrl(playbackId: string, expiresAt: Date, options: ThumbnailOptions = { time: 1, width: 640 }, env: MuxEnv = process.env): string {
  return `${MUX_IMAGE_ORIGIN}/${playbackId}/thumbnail.jpg?token=${signPlaybackToken(playbackId, "thumbnail", expiresAt, options, env)}`;
}

// ---------------------------------------------------------------------------
// Checking a playback id before the catalogue saves it.
// ---------------------------------------------------------------------------

/** How long to wait for Mux when checking an id. A staff member is waiting on the form. */
const CHECK_TIMEOUT_MS = 10_000;

/** What checking a playback id found. The message is written for the staff member and holds no address or token. */
export type PlaybackIdCheck =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "bad-id" | "public" | "refused" | "unreachable"; message: string };

/**
 * Ask Mux whether a playback id is one this app can use: it must have the
 * SIGNED policy, and the key here must be the one Mux knows. Two plain
 * requests for the id's playlist, and what each answer means:
 *
 *   without a token, Mux ANSWERS   the id is public (or a token on it would
 *                                  be refused: Mux fails a token on a public
 *                                  id on purpose). Not for us: refused.
 *   with our token, Mux REFUSES    the id is unknown, or the key does not
 *                                  match the account. Refused, with the
 *                                  status in words.
 *   without: refused, with: answered   a signed id our key can open. Saved.
 *
 * Mux's own API could say the same with an access token, which would be two
 * more secrets to keep; this asks the question the app actually depends on
 * instead, with the one key it already has. The body of either answer is
 * never read. `options.fetch` is for the tests, which hand in a stand-in.
 */
export async function checkPlaybackId(playbackId: string, options: { env?: MuxEnv; fetch?: typeof fetch; now?: Date } = {}): Promise<PlaybackIdCheck> {
  const env = options.env ?? process.env;
  const ask = options.fetch ?? fetch;
  if (!isPlaybackIdShape(playbackId)) return { ok: false, reason: "bad-id", message: "That does not look like a Mux playback id. Copy it from the asset's page in the Mux dashboard." };
  if (!muxIsConfigured(env)) {
    return { ok: false, reason: "not-configured", message: "Mux signing is not set up on this deployment, so the playback id cannot be checked or used. Add the signing key first." };
  }

  const plain = `${MUX_STREAM_ORIGIN}/${playbackId}.m3u8`;
  const signed = signedPlaylistUrl(playbackId, new Date((options.now ?? new Date()).getTime() + 5 * 60_000), env);
  try {
    const unsigned = await ask(plain, { method: "GET", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (unsigned.ok) {
      return { ok: false, reason: "public", message: "Mux plays that id without a token, so its policy is public, not signed. Make a signed playback id for the asset and use that one." };
    }
    const withToken = await ask(signed, { method: "GET", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!withToken.ok) {
      // The status says what kind of no it was (404 an unknown id, 403 a key Mux does not recognise); the body is not read.
      console.error("Mux: the signed check of a playback id was refused", withToken.status);
      return {
        ok: false,
        reason: "refused",
        message: `Mux refused the signed request for that id (status ${withToken.status}). Check the id, and that the signing key here belongs to the same Mux environment.`,
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("Mux: could not be reached to check a playback id", error instanceof Error ? error.name : "unknown error");
    return { ok: false, reason: "unreachable", message: "Mux could not be reached to check the playback id. Nothing was saved. Try again in a moment." };
  }
}

// ---------------------------------------------------------------------------
// Uploading from the app: Mux's own API, with an access token.
//
// Three more settings, in .env and in Vercel, never in code (rule 7):
//
//   MUX_TOKEN_ID        an access token with Video permissions, made in the
//   MUX_TOKEN_SECRET    Mux dashboard (Settings, Access Tokens). The id is a
//                       setting; the secret is a SECRET. Together they are the
//                       sign-in to Mux's API. They never reach the browser:
//                       the browser is handed only the one-time upload
//                       address Mux gives back.
//   MUX_WEBHOOK_SECRET  the signing secret from the webhook's page in Mux, so
//                       a notification can be proved to come from Mux.
//
// With the token missing, the upload control on /pulse/videos says uploads
// are not set up here and does nothing; pasting ids still works. Every call
// goes through muxUploadGateway below, so the tests can hand the flow an
// in-memory stand-in (lib/testing/fake-mux.ts), as lib/stripe.ts does for
// Stripe. Nothing here logs an upload address, the token or a body.
// ---------------------------------------------------------------------------

export const MUX_API_ORIGIN = "https://api.mux.com";

/**
 * The quality Mux prepares an uploaded video at. Mux offers "basic", "plus"
 * and "premium"; the higher ones cost more per minute and add resolutions
 * and features the animations do not need today. Evan chose Basic on
 * 2026-10-05, when the first animation was moved to Mux by hand at that
 * quality and played well on a phone and a computer. Changing it later is
 * this one line.
 */
export const UPLOAD_VIDEO_QUALITY = "basic";

/**
 * How long a one-time upload address stays usable, in seconds: two hours.
 * Long enough for a large file on a slow office connection; after that Mux
 * marks the upload "timed_out" and the row's in-flight mark is cleared the
 * next time the upload is looked at.
 */
export const UPLOAD_TIMEOUT_SECONDS = 2 * 60 * 60;

/** How long to wait for Mux's API. A staff member is waiting on the page. */
const API_TIMEOUT_MS = 10_000;

/** True when the API token is set AND signing is configured: an asset made with the signed policy would play for nobody without the signing key. */
export function muxUploadsAreConfigured(env: MuxEnv = process.env): boolean {
  return Boolean(env.MUX_TOKEN_ID?.trim()) && Boolean(env.MUX_TOKEN_SECRET?.trim()) && muxIsConfigured(env);
}

/** Where a direct upload stands, as Mux reports it. */
export type UploadStatus = "waiting" | "asset_created" | "errored" | "cancelled" | "timed_out";
export type UploadFacts = { id: string; status: UploadStatus; assetId: string | null };

/** Where an asset stands, and the facts the catalogue writes when it is ready. */
export type AssetStatus = "preparing" | "ready" | "errored";
export type AssetFacts = {
  id: string;
  status: AssetStatus;
  /** Every playback id on the asset with its policy. The flow uses only one with the policy "signed". */
  playbackIds: { id: string; policy: string }[];
  durationSeconds: number | null;
  /** The direct upload the asset came from, when it came from one. */
  uploadId: string | null;
};

/**
 * Everything the upload flow asks of Mux. The real one is below; the tests
 * use lib/testing/fake-mux.ts. `getUpload` and `getAsset` answer null for
 * an id Mux does not know (a 404), so the flow can tell "gone" from "down".
 */
export type MuxUploadGateway = {
  /** Ask Mux for a one-time upload address. The asset it will make gets the SIGNED policy and UPLOAD_VIDEO_QUALITY, nothing else. */
  createUpload(input: { corsOrigin: string }): Promise<{ id: string; url: string }>;
  getUpload(uploadId: string): Promise<UploadFacts | null>;
  getAsset(assetId: string): Promise<AssetFacts | null>;
  /** Cancel an upload whose file has not arrived. Mux refuses once an asset exists; the caller then looks at the upload instead. */
  cancelUpload(uploadId: string): Promise<void>;
};

/** Mux answered, but not with success. Carries the status only, never the body. */
export class MuxApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`Mux answered ${status}.`);
    this.name = "MuxApiError";
    this.status = status;
  }
}

/** A Mux setting is missing on this deployment. */
export class MuxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MuxConfigError";
  }
}

/**
 * One request to Mux's API, signed in with the access token (HTTP Basic
 * auth, as Mux documents). Answers the `data` object Mux wraps every answer
 * in, null for a 404, and throws MuxApiError for any other refusal. The body
 * of a refusal is never read or logged.
 */
async function muxApi(method: "GET" | "POST" | "PUT", path: string, body: unknown, env: MuxEnv, ask: typeof fetch): Promise<Record<string, unknown> | null> {
  const id = env.MUX_TOKEN_ID?.trim();
  const secret = env.MUX_TOKEN_SECRET?.trim();
  if (!id || !secret) throw new MuxConfigError("MUX_TOKEN_ID and MUX_TOKEN_SECRET are not set.");
  const response = await ask(`${MUX_API_ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new MuxApiError(response.status);
  const answer = (await response.json()) as { data?: unknown };
  if (!answer.data || typeof answer.data !== "object") throw new MuxApiError(response.status);
  return answer.data as Record<string, unknown>;
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** Read Mux's upload object into the facts the flow uses. A status Mux adds later reads as "waiting", which changes nothing. */
function readUpload(data: Record<string, unknown>): UploadFacts {
  const status = text(data.status);
  const known: UploadStatus[] = ["waiting", "asset_created", "errored", "cancelled", "timed_out"];
  return {
    id: text(data.id) ?? "",
    status: known.includes(status as UploadStatus) ? (status as UploadStatus) : "waiting",
    assetId: text(data.asset_id),
  };
}

/** Read Mux's asset object into the facts the flow uses. A status Mux adds later reads as "preparing", which changes nothing. */
function readAsset(data: Record<string, unknown>): AssetFacts {
  const status = text(data.status);
  const known: AssetStatus[] = ["preparing", "ready", "errored"];
  const ids = Array.isArray(data.playback_ids) ? data.playback_ids : [];
  const duration = typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0 ? Math.round(data.duration) : null;
  return {
    id: text(data.id) ?? "",
    status: known.includes(status as AssetStatus) ? (status as AssetStatus) : "preparing",
    playbackIds: ids
      .map((entry) => (entry && typeof entry === "object" ? { id: text((entry as Record<string, unknown>).id) ?? "", policy: text((entry as Record<string, unknown>).policy) ?? "" } : null))
      .filter((entry): entry is { id: string; policy: string } => entry !== null && entry.id !== ""),
    durationSeconds: duration,
    uploadId: text(data.upload_id),
  };
}

/** The real gateway, with `fetch` and the environment handed in so the tests can see exactly what Mux is asked. */
export function makeMuxUploadGateway(options: { env?: MuxEnv; fetch?: typeof fetch } = {}): MuxUploadGateway {
  const env = options.env ?? process.env;
  const ask = options.fetch ?? fetch;
  return {
    async createUpload({ corsOrigin }) {
      const data = await muxApi(
        "POST",
        "/video/v1/uploads",
        {
          cors_origin: corsOrigin,
          timeout: UPLOAD_TIMEOUT_SECONDS,
          // The SIGNED policy and the chosen quality, and nothing else: no
          // MP4 downloads (static renditions), no Mux Data, no captions.
          new_asset_settings: { playback_policies: ["signed"], video_quality: UPLOAD_VIDEO_QUALITY },
        },
        env,
        ask,
      );
      const id = text(data?.id);
      const url = text(data?.url);
      if (!id || !url) throw new MuxApiError(200);
      return { id, url };
    },
    async getUpload(uploadId) {
      const data = await muxApi("GET", `/video/v1/uploads/${encodeURIComponent(uploadId)}`, undefined, env, ask);
      return data ? readUpload(data) : null;
    },
    async getAsset(assetId) {
      const data = await muxApi("GET", `/video/v1/assets/${encodeURIComponent(assetId)}`, undefined, env, ask);
      return data ? readAsset(data) : null;
    },
    async cancelUpload(uploadId) {
      await muxApi("PUT", `/video/v1/uploads/${encodeURIComponent(uploadId)}/cancel`, undefined, env, ask);
    },
  };
}

/** The gateway the app uses. */
export const muxUploadGateway: MuxUploadGateway = makeMuxUploadGateway();

// ---------------------------------------------------------------------------
// Webhooks: proving a notification came from Mux.
// ---------------------------------------------------------------------------

/** The webhook signing secret. Throws a MuxConfigError when it is missing. */
export function getMuxWebhookSecret(env: MuxEnv = process.env): string {
  const secret = env.MUX_WEBHOOK_SECRET?.trim();
  if (!secret) throw new MuxConfigError("MUX_WEBHOOK_SECRET is not set.");
  return secret;
}

/** How old a notification may be before it is refused as a replay. Mux's own libraries allow five minutes. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** The signature did not check out. The message says only which way. */
export class MuxSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MuxSignatureError";
  }
}

/**
 * Check a notification's signature and hand back its body as JSON, or
 * throw. Exactly as Mux documents it: the "Mux-Signature" header holds
 * "t=<seconds since 1970>,v1=<signature>", and the signature is an HMAC
 * with SHA-256, in hexadecimal, over the timestamp, a dot and the RAW body,
 * keyed with the webhook's signing secret. The body must be the exact bytes
 * Mux sent (re-spaced JSON fails, which is the point), and a notification
 * older than the tolerance is refused as a replay. The comparison takes the
 * same time whether or not the signatures match (timingSafeEqual).
 */
export function verifyMuxWebhook(rawBody: string, signatureHeader: string | null, secret: string, now: Date = new Date()): unknown {
  const parts = new Map<string, string[]>();
  for (const piece of (signatureHeader ?? "").split(",")) {
    const [key, value] = piece.trim().split("=", 2);
    if (key && value) parts.set(key, [...(parts.get(key) ?? []), value]);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  const signatures = parts.get("v1") ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) throw new MuxSignatureError("Unable to read the signature header.");
  if (Math.abs(now.getTime() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new MuxSignatureError("The notification is too old.");

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const matches = signatures.some((given) => {
    const bytes = /^[0-9a-f]+$/i.test(given) ? Buffer.from(given, "hex") : Buffer.alloc(0);
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
  });
  if (!matches) throw new MuxSignatureError("The signature does not match.");

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new MuxSignatureError("The body is not JSON.");
  }
}
