/**
 * The small decisions both video players share, as plain functions with no
 * browser in them, so they can be tested without one.
 */

/**
 * When a browser refuses to start a video it says why with a name. Most of
 * those names mean "not yet" and the right response is to leave the Play
 * button where it is:
 *
 *   NotAllowedError  the browser wants a tap first (or wants it muted)
 *   AbortError       play was interrupted by a pause or a reload; harmless
 *
 * One means the video itself cannot be played, and the person needs to be
 * told, with a way to try again:
 *
 *   NotSupportedError  the file is missing, blocked, or not a video the
 *                      browser can read
 *
 * A video that fails while loading or part-way through says so differently
 * (the <video> element's own "error" event); the players listen for that
 * as well.
 */
export function playRefusalIsFailure(errorName: string | undefined | null): boolean {
  return errorName === "NotSupportedError";
}

/**
 * How long a video may sit waiting for data before the player says, gently,
 * that it is still loading. Long enough that an ordinary pause to buffer
 * never shows it; short enough that someone on a weak signal is not left
 * wondering whether their tap did anything.
 */
export const SLOW_AFTER_MS = 8000;

/**
 * Where to pick a video back up after "Try again". A failure part-way
 * through should resume where it stopped, not send the patient back to the
 * start; a failure before anything played starts from the beginning.
 * Anything that is not a sensible time counts as the beginning.
 */
export function resumePoint(currentTime: number | undefined | null): number {
  if (typeof currentTime !== "number" || !Number.isFinite(currentTime) || currentTime < 1) return 0;
  return currentTime;
}
