/**
 * What the patient player says, in words, to someone using a screen reader,
 * when its state changes without them pressing anything that would say so
 * itself. Pure, so it can be tested on its own; WatchPlayer puts the answer
 * in one "status" region that is always on the page (a region that appears
 * already filled is skipped by many screen readers, so the region stays and
 * only its words change).
 *
 * Said once per change, never repeated: the words only change when the
 * state does. Never the time played. And not "Getting the video ready",
 * because the tick moves the focus to Play, whose own description already
 * says that; the region only speaks up when Play becomes ready.
 *
 * The words are the ones the page already shows (or a short form of them),
 * so a sighted helper and a listening patient hear the same thing.
 */
export type PlayerState = {
  ticked: boolean;
  ready: boolean;
  started: boolean;
  loading: boolean;
  everPlayed: boolean;
  failed: boolean;
  ended: boolean;
  unavailable: boolean;
  acceptTrouble: boolean;
  clinicName: string;
};

export function playerAnnouncement(state: PlayerState): string {
  if (state.unavailable) return `This video isn't available right now. Please ask ${state.clinicName} about it.`;
  if (state.ended) return `This link has expired. ${state.clinicName} can send you a fresh one.`;
  if (state.failed) return "The video did not load. Check your connection, then try again.";
  if (state.acceptTrouble) return "We couldn't get the video ready. Check your connection, then try again.";
  if (state.started) return state.loading && !state.everPlayed ? "Loading the video." : "";
  if (state.ticked && state.ready) return "The video is ready. Tap Play to start.";
  return "";
}
