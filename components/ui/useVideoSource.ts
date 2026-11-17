"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PlaybackSource } from "@/lib/playback-source";
import { activeCaptionLines, captionTracksOf, sameLines } from "./captions";
import { SourceLoader, type LoaderHooks } from "./video-source-loader";

/**
 * Puts a PlaybackSource (lib/playback-source.ts) onto a player's <video>
 * element, for both players. The work is done by SourceLoader
 * (video-source-loader.ts, where the whole story is told); this hook only
 * ties one loader to the component's life:
 *
 *   - a loader is made when the player mounts and whenever the page hands in
 *     a new source, and destroyed (hls.js taken down, timers cleared) when
 *     the source changes or the player closes;
 *   - the player's callbacks are read fresh each time they are needed, so
 *     the loader always calls the latest ones;
 *   - `reload(startAt)` is what Try again calls;
 *   - when the page comes back into view, a stream whose token has run out
 *     (or is about to) is renewed at once (the loader's refreshIfStale);
 *   - `captions` is what the CC button needs (captions.ts): whether the video
 *     has a caption track, whether CC is on (off to start, for the page's
 *     lifetime only), the toggle, and the words to draw right now;
 *   - `null` means "nothing to play yet": no loader is made and the element
 *     is left empty. The patient page starts there, because it hands out the
 *     video only after the "for education only" box is ticked.
 */
export function useVideoSource(videoRef: RefObject<HTMLVideoElement | null>, source: PlaybackSource | null, hooks: LoaderHooks) {
  const latestHooks = useRef(hooks);
  useEffect(() => {
    latestHooks.current = hooks;
  });

  // Captions (captions.ts). Off until the viewer presses CC; kept here, above the loader, so the choice survives a
  // new source from the page as well as the loader's own swaps to a fresh address. Never stored anywhere: it lasts as
  // long as the page.
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const wantsCaptions = useRef(false);

  const loader = useRef<SourceLoader | null>(null);
  useEffect(() => {
    if (!source) return;
    const made = new SourceLoader({
      getElement: () => videoRef.current,
      getHooks: () => latestHooks.current,
      captions: { wanted: () => wantsCaptions.current, onAvailable: setCaptionsAvailable },
    });
    loader.current = made;
    void made.attach(source);
    return () => {
      made.destroy();
      if (loader.current === made) loader.current = null;
    };
  }, [source, videoRef]);

  // Coming back to the page (a phone woken up, a tab brought forward): a signed address whose token ran out while
  // nobody was looking is renewed now rather than at the next tap. The loader asks only when it is due.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loader.current?.refreshIfStale();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const reload = useCallback((startAt: number) => loader.current?.reload(startAt) ?? Promise.resolve(), []);

  /** CC: captions on if they were off, off if they were on. */
  const toggleCaptions = useCallback(() => {
    wantsCaptions.current = !wantsCaptions.current;
    setCaptionsOn(wantsCaptions.current);
    loader.current?.applyCaptions();
  }, []);

  const lines = useCaptionLines(videoRef, captionsOn && captionsAvailable);
  const captions: PlayerCaptions = { available: captionsAvailable, on: captionsOn, toggle: toggleCaptions, lines };
  return { reload, captions };
}

/** What the overlay needs to offer captions: whether the video has any, whether CC is on, the button's action, and the words to draw now. */
export type PlayerCaptions = { available: boolean; on: boolean; toggle: () => void; lines: string[] };

/**
 * The caption words being said right now, while captions are on: read from
 * the text track the loader switched on, each time its cues change (and when
 * a track arrives or the video jumps), never on a timer of our own.
 */
function useCaptionLines(videoRef: RefObject<HTMLVideoElement | null>, on: boolean): string[] {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const video = videoRef.current;
    if (!on || !video) return;
    const read = () => {
      const next = activeCaptionLines(video);
      setLines((previous) => (sameLines(previous, next) ? previous : next));
    };
    // Each caption track tells us when its current words change ("cuechange"); a track that arrives later (a fresh
    // address, hls.js making its track) is listened to as it comes.
    const listening = new Set<TextTrack>();
    const listen = () => {
      for (const track of captionTracksOf(video)) {
        if (!listening.has(track)) {
          track.addEventListener("cuechange", read);
          listening.add(track);
        }
      }
      read();
    };
    const tracks = video.textTracks;
    tracks?.addEventListener?.("addtrack", listen);
    tracks?.addEventListener?.("change", listen);
    video.addEventListener("seeked", read);
    listen();
    return () => {
      tracks?.removeEventListener?.("addtrack", listen);
      tracks?.removeEventListener?.("change", listen);
      video.removeEventListener("seeked", read);
      for (const track of listening) track.removeEventListener("cuechange", read);
    };
  }, [videoRef, on]);
  // While off, nothing is drawn (the last words read are simply not shown, and are replaced as soon as CC is on again).
  return on ? lines : NO_LINES;
}

const NO_LINES: string[] = [];
