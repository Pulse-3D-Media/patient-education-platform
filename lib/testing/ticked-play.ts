import { acceptShareDisclaimer, recordSharePlay } from "@/lib/db/shares";
import { DISCLAIMER } from "@/lib/education-note";

/**
 * For tests only: what a real patient's player does before a play start.
 *
 * Since November 2026 a first-play link's first play is claimed only once the
 * "for education only" box has been ticked on it (recordSharePlay in
 * lib/db/shares.ts), because the real player only gets the video after a
 * recorded tick. Tests that are about plays, deadlines and pausing rather
 * than about the box call this instead of recordSharePlay: it ticks the box
 * at the same moment (which does nothing on a link that is not working, as on
 * the real page), then records the play, and answers exactly what
 * recordSharePlay answers. Nothing in the app imports it.
 */
export async function playAfterTick(code: string, now: Date = new Date()) {
  await acceptShareDisclaimer(code, DISCLAIMER.version, now);
  return recordSharePlay(code, now);
}
