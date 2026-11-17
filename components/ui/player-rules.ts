/**
 * The small rules both players share (the patient's and the library's), with
 * no browser and no React, so they can be tested on their own. The players
 * themselves are app/watch/[code]/WatchPlayer.tsx and
 * components/ui/VideoPlayer.tsx; the shared machinery is usePlayerControls.ts
 * and PlayerOverlay.tsx next to this file.
 */

/** How long the controls (and the logo, title and doctor's name) stay up after the last touch or mouse movement while the video plays. */
export const HIDE_AFTER_MS = 2600;

/** How far the back and forward buttons and the arrow keys move the video. */
export const SKIP_SECONDS = 10;

/**
 * What a tap or click on the picture itself does (not on one of the
 * buttons), the way Vimeo and a phone's own player do it:
 *
 *   - a mouse click plays or pauses;
 *   - a finger tap hides the controls when they are showing over a playing
 *     video, and shows them otherwise (the middle button plays and pauses).
 */
export function pictureTapAction(pointerType: string, controlsShowing: boolean, playing: boolean): "toggle-play" | "hide" | "show" {
  if (pointerType === "mouse") return "toggle-play";
  return controlsShowing && playing ? "hide" : "show";
}

/**
 * The letters in the logo's circle when a clinic has no logo (or it does not
 * load): the first letter of its first two real words, "Summit Orthopedics"
 * is "SO", "The Knee Clinic" is "KC". Never empty: a name with no letters at
 * all gives "?".
 */
export function clinicInitials(name: string): string {
  const small = new Set(["the", "of", "and", "for", "at", "a", "an", "&"]);
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0);
  const meaningful = words.filter((word) => !small.has(word.toLowerCase()));
  const picked = (meaningful.length > 0 ? meaningful : words).slice(0, 2);
  const letters = picked.map((word) => word[0].toUpperCase()).join("");
  return letters || "?";
}


/** How a clinic's logo is shown in the mark on the video, decided by its own shape once it has loaded. */
export type LogoShape = "round" | "wide" | "tall";

/**
 * A logo's shape from its natural size (logo refresh, November 2026):
 *
 *   - "round": roughly square (from 4:5 to 13:10). It fills the round frame,
 *     cropped a little at most, as the October design did for every logo.
 *   - "wide": a wordmark, wider than 13:10. Shown whole on a small white
 *     rounded tag, so its words read instead of being cropped to nonsense.
 *   - "tall": taller than 4:5. Shown whole inside the round frame.
 *
 * A size that cannot be read (an SVG with no size of its own reports 0) is
 * treated as round, which is what the mark showed before.
 */
export function logoShape(width: number, height: number): LogoShape {
  if (!(width > 0) || !(height > 0)) return "round";
  const ratio = width / height;
  if (ratio > 1.3) return "wide";
  if (ratio < 0.8) return "tall";
  return "round";
}

/**
 * A length of time in words, for a screen reader: "1 minute 5 seconds",
 * "4 minutes", "45 seconds", "1 hour 2 minutes 3 seconds". Whole seconds,
 * rounded down, as the player's own "1:05" is. Nothing, or a number that is
 * not a time, reads as "0 seconds".
 */
export function spokenTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [h > 0 ? part(h, "hour") : "", m > 0 ? part(m, "minute") : "", s > 0 ? part(s, "second") : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 seconds";
}

/**
 * What a screen reader says for the progress bar, instead of a bare number
 * of seconds: "1 minute 5 seconds of 4 minutes 12 seconds". Before the
 * video's length is known, just where it is.
 */
export function seekValueText(time: number, duration: number): string {
  return Number.isFinite(duration) && duration > 0 ? `${spokenTime(time)} of ${spokenTime(duration)}` : spokenTime(time);
}
