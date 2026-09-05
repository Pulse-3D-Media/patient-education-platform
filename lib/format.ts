/**
 * Turns a number of seconds into the "4:12" style shown on the library cards,
 * in the player and on the admin page. Whole seconds only. Anything that is
 * not a real number (a video whose length is not known yet) reads as "0:00".
 */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The reassuring version of a video's length, for the patient page: "About a
 * minute" or "About 2 minutes", never a stopwatch reading like "1:50". A
 * patient deciding whether they have time to press play wants the rough size,
 * not the exact figure.
 *
 * Under a minute and a half reads "About a minute". Anything longer is rounded
 * to the nearest whole minute. Returns null when the length is not known, so
 * the page can leave the line out rather than guess.
 */
export function describeDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 90) return "About a minute";
  return `About ${Math.round(seconds / 60)} minutes`;
}
