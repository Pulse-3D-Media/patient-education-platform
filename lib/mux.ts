import "server-only";
import { createSign } from "node:crypto";
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
export type MuxEnv = { MUX_SIGNING_KEY_ID?: string; MUX_SIGNING_PRIVATE_KEY?: string; [name: string]: string | undefined };

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
