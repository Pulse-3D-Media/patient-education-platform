/**
 * Captions on both players: the narration written out as words on the
 * picture, shown when the viewer presses CC (off until then). Browser code,
 * plain functions with no React in them (a React hook may not change an
 * element it was handed; the React Compiler's lint refuses it), used by the
 * loader (video-source-loader.ts) and useVideoSource.
 *
 * WHERE THEY COME FROM. A video in Mux may have an English caption track,
 * which Mux writes from the narration (lib/mux-captions.ts). Mux lists it in
 * the stream's playlist, so the player finds it in the stream itself and
 * nothing about it is stored or asked for separately. A CDN file has none:
 * no CC button appears for it.
 *
 * HOW THEY ARE SHOWN. The browser loads the track's words but does not draw
 * them (the track's mode is "hidden"); PlayerOverlay draws them itself,
 * large, on a dark band, lifted clear of the controls whenever the controls
 * are up and well below the clinic's mark. That way they look the same with
 * the browser's own HLS (Safari: the track is one of the element's
 * textTracks) and with hls.js (which puts the track it loads on the element
 * too, as a "hidden" text track when its subtitleDisplay is off).
 *
 * THE PHONE'S OWN FULL SCREEN (an iPhone). Our overlay is not drawn there,
 * so while the phone's own player is up the track is switched to "showing"
 * and the phone draws the captions itself, in the style the phone's
 * accessibility settings ask for; its own captions button works too. Back on
 * the page, the track is "hidden" again and our overlay takes over. A choice
 * made with the phone's own captions button counts as the person's choice:
 * back on the page, CC shows it and our overlay follows it.
 *
 * THE DEVICE'S OWN PREFERENCE. With the browser's own HLS (Safari), a phone
 * or computer whose accessibility settings ask for captions switches a
 * caption track on ("showing") by itself. Until the person presses our CC
 * button, the player never switches such a track off: it takes it as CC on
 * (the button shows on, and our overlay draws the words instead of the
 * browser). Only a press of CC turns them off. hls.js (Chrome, Edge,
 * Firefox) is not told of any such setting, so there they start off.
 *
 * Nothing about the choice is stored: it lasts as long as the page.
 */

/** The text tracks that are captions or subtitles (hls.js and Safari may also add "metadata" tracks, which are not). */
export function captionTracksOf(video: HTMLVideoElement): TextTrack[] {
  const list = video.textTracks;
  const tracks: TextTrack[] = [];
  if (!list) return tracks;
  for (let i = 0; i < list.length; i += 1) {
    const track = list[i];
    if (track.kind === "subtitles" || track.kind === "captions") tracks.push(track);
  }
  return tracks;
}

/** The one track to show: English if there is one, else the first. */
export function pickCaptionTrack<T extends { language: string }>(tracks: T[]): T | null {
  return tracks.find((track) => track.language.toLowerCase().startsWith("en")) ?? tracks[0] ?? null;
}

/**
 * The browser's own HLS (Safari): load the chosen track's words without the
 * browser drawing them ("hidden"), or switch every track off ("disabled").
 * `systemPlayer` is true while an iPhone's own full-screen player is up: the
 * phone then draws them ("showing").
 */
export function applyNativeCaptions(video: HTMLVideoElement, on: boolean, systemPlayer = false): void {
  const tracks = captionTracksOf(video);
  const chosen = on ? pickCaptionTrack(tracks) : null;
  for (const track of tracks) {
    const mode: TextTrackMode = track === chosen ? (systemPlayer ? "showing" : "hidden") : "disabled";
    if (track.mode !== mode) track.mode = mode;
  }
}

/**
 * The browser's own HLS: the choice to put on the caption tracks, from the
 * person's own (true or false once they have pressed CC, null before). Before
 * any press, a track the device itself switched on ("showing", from its
 * accessibility settings) means on; otherwise null: leave the tracks exactly
 * as the browser has them, never switching off what the device chose.
 */
export function nativeCaptionChoice(video: HTMLVideoElement, choice: boolean | null): boolean | null {
  if (choice !== null) return choice;
  return captionTracksOf(video).some((track) => track.mode === "showing") ? true : null;
}

/**
 * Leaving an iPhone's own full-screen player: what the person chose there. If
 * they turned captions on or off with the phone's own captions button, the
 * tracks say so ("showing" or not) and that is now their choice; otherwise
 * their choice stays as it was (null if they never chose).
 */
export function choiceAfterSystemPlayer(video: HTMLVideoElement, choice: boolean | null): boolean | null {
  const shown = captionTracksOf(video).some((track) => track.mode === "showing");
  return shown !== (choice ?? false) ? shown : choice;
}

/**
 * The lines to draw now: the words of every cue being said at this moment on
 * the track that is switched on. None when captions are off.
 */
export function activeCaptionLines(video: HTMLVideoElement): string[] {
  const track = captionTracksOf(video).find((t) => t.mode === "hidden" || t.mode === "showing");
  const cues = track?.activeCues;
  if (!cues) return [];
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i += 1) {
    const text = (cues[i] as TextTrackCue & { text?: string }).text;
    if (typeof text === "string") lines.push(...cueLines(text));
  }
  return lines;
}

/**
 * A cue's words as plain lines. WebVTT may carry a few tags (<i>, <b>, a
 * speaker's <v Name>, timing marks) and a few escaped characters; the tags
 * are dropped and the characters put back. The words are drawn as text by
 * React, never as HTML, so nothing in a caption file can run on the page.
 */
export function cueLines(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&lrm;|&rlm;/g, "")
    .replace(/&amp;/g, "&")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Two lists of lines are the same (so the overlay is not redrawn for nothing). */
export function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
