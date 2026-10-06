"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PlaybackSource } from "@/lib/playback-source";
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
 *   - `reload(startAt)` is what Try again calls.
 */
export function useVideoSource(videoRef: RefObject<HTMLVideoElement | null>, source: PlaybackSource, hooks: LoaderHooks) {
  const latestHooks = useRef(hooks);
  useEffect(() => {
    latestHooks.current = hooks;
  });

  const loader = useRef<SourceLoader | null>(null);
  useEffect(() => {
    const made = new SourceLoader({ getElement: () => videoRef.current, getHooks: () => latestHooks.current });
    loader.current = made;
    void made.attach(source);
    return () => {
      made.destroy();
      if (loader.current === made) loader.current = null;
    };
  }, [source, videoRef]);

  const reload = useCallback((startAt: number) => loader.current?.reload(startAt) ?? Promise.resolve(), []);
  return { reload };
}
