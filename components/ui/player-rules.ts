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

