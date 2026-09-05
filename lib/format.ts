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
