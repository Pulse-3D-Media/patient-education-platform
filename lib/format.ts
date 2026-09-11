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

/**
 * The opposite of formatDuration, for the video form on /pulse/videos: turns
 * what a staff member typed into whole seconds. Accepts "4:12" (minutes and
 * seconds), "1:04:12" (hours too) or a plain number of seconds such as "252".
 *
 * Returns null for an empty box (the length is not known), and undefined for
 * text that is not a duration at all ("4:70", "abc", "-5"), so the form can
 * tell "left empty" from "typed wrong".
 */
export function parseDuration(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return undefined;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds > 59 || (match[1] !== undefined && minutes > 59)) return undefined;

  return hours * 3600 + minutes * 60 + seconds;
}
