/**
 * What a player is handed to play, and the small rules about how long a
 * signed address may live. Pure and safe for the browser: no key, no
 * database, no Mux. The server works a source out (lib/playback-auth.ts,
 * server only) and hands it to the player as plain data.
 *
 * Two kinds of video exist side by side while the library moves to Mux:
 *
 *   "file"    a plain MP4 on the Webflow CDN, as every video was in Phase 1.
 *             The address is public and permanent; the player loads it as
 *             it always has.
 *   "stream"  a video that has moved to Mux with a SIGNED playback id. The
 *             address is an HLS playlist with a token on it that stops
 *             working at `expiresAt`, and a poster picture signed the same
 *             way. Only the server can make one, and only for someone it
 *             has just authorized (a working patient link, or a clinic
 *             whose plan allows the video).
 *   "unavailable"  the video has moved to Mux but no signed address could be
 *             made (the signing key is missing on this deployment, or the
 *             link's window has already closed). The player shows its calm
 *             "did not load" panel with Try again. NEVER the CDN file: a
 *             video that was moved to protected playback is not quietly
 *             handed out unprotected because signing failed.
 *
 * Mux checks the token on every request the player makes, so when the
 * token expires a video that is still playing can stop (Mux says so in its
 * secure playback guide). Two things keep a patient from ever seeing that:
 * the token lives at least as long as the video where the link allows it
 * (see tokenExpiry), and the player asks the server for a fresh grant a
 * little before the token runs out (see refreshDelayMs), for as long as
 * it is still authorized. Once access has ended, nothing is renewed.
 */

/** What the server hands a player. `expiresAt` and the like are plain numbers (milliseconds since 1970) so the whole thing crosses to the browser as data. */
export type PlaybackSource =
  | { kind: "file"; src: string }
  | {
      kind: "stream";
      /** The signed HLS playlist address. */
      src: string;
      /** A signed still from the video, for the card and the first frame. */
      poster: string;
      /** When the token on `src` and `poster` stops working, in milliseconds since 1970. */
      expiresAt: number;
    }
  | { kind: "unavailable" };

/**
 * How long a signed address lives when nothing shorter applies: one hour.
 * Long enough that an ordinary visit never sees a refresh; short enough
 * that a copied address stops working the same afternoon. Not a promise of
 * protection: a copied address works until its token expires, and a video
 * already loaded onto a phone is already there.
 */
export const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** The player asks for a fresh grant this long before the token runs out, so a slow answer still arrives in time. */
export const REFRESH_LEAD_MS = 90 * 1000;

/** A fresh grant is asked for no sooner than this after the last one, so a clock that is off cannot make the player ask over and over. */
export const MIN_REFRESH_DELAY_MS = 15 * 1000;

/**
 * When a token made now should stop working, or null when there is nothing
 * left to grant.
 *
 *   windowEnd   when the viewer's own permission ends: a patient link's
 *               deadline. Null when there is no deadline of that kind (the
 *               library, where the clinic's plan is checked again on every
 *               refresh instead).
 *   videoMs     how long the video runs, when known, so the token is never
 *               shorter than one whole viewing, as Mux asks. The link's own
 *               deadline still wins: a token never outlives the link.
 *
 * So: the usual lifetime, stretched to cover the video if the video is
 * longer, and cut to the link's deadline if that comes first. A link whose
 * deadline has passed gets nothing.
 */
export function tokenExpiry(now: Date, windowEnd: Date | null, videoMs: number | null = null): Date | null {
  const length = videoMs !== null && Number.isFinite(videoMs) && videoMs > 0 ? videoMs : 0;
  let expires = now.getTime() + Math.max(TOKEN_LIFETIME_MS, length);
  if (windowEnd !== null) {
    if (windowEnd.getTime() <= now.getTime()) return null;
    expires = Math.min(expires, windowEnd.getTime());
  }
  return new Date(expires);
}

/**
 * Whether the time left on a link can hold one whole viewing of the video.
 * When it cannot, the page says so in plain words rather than letting the
 * video stop part-way with no explanation. True when the video's length is
 * not known: there is nothing honest to say then.
 */
export function windowCoversVideo(now: Date, windowEnd: Date | null, durationSeconds: number | null): boolean {
  if (windowEnd === null || durationSeconds === null || !Number.isFinite(durationSeconds)) return true;
  return windowEnd.getTime() - now.getTime() >= durationSeconds * 1000;
}

/** How long the player waits before asking for a fresh grant: a little before the token runs out, and never sooner than the minimum. */
export function refreshDelayMs(expiresAt: number, now: number): number {
  return Math.max(MIN_REFRESH_DELAY_MS, expiresAt - REFRESH_LEAD_MS - now);
}

/** True once a token has run out: an address with it on no longer plays. */
export function tokenHasExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

/**
 * A Mux playback id as Mux hands them out: letters, digits and a few plain
 * symbols, never a slash or a space. Checked before a staff member's typed
 * id is used in an address or looked up.
 */
export function isPlaybackIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
