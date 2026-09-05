"use client";

import { useRef, useState } from "react";
import { PlayIcon } from "@/components/ui/icons";
import { recordView } from "./actions";

/**
 * The patient's player: the video with one big Play button over it.
 *
 * Before the first tap, the Play button is the only thing on screen (the
 * rules file: nothing to click except play). After it, the browser's own
 * controls take over, because those are the controls a patient already knows
 * from every other video on their phone.
 *
 * Client component because the tap itself has to start playback (browsers
 * only allow sound when the person has just tapped), and because the first
 * play is what counts as a view.
 */
export function WatchPlayer({ src, title, code }: { src: string; title: string; code: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const counted = useRef(false);

  function play() {
    video.current?.play().catch(() => {
      // The browser refused to start (for example, the file has not arrived
      // yet). The Play button stays on screen so the patient can tap again.
    });
  }

  function onPlay() {
    setStarted(true);
    if (counted.current) return;
    counted.current = true;
    // Count the view in the background. If it fails, the video still plays.
    recordView(code).catch(() => {});
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-2xl">
      <video
        ref={video}
        src={src}
        preload="auto"
        playsInline
        controls={started}
        controlsList="nodownload"
        onPlay={onPlay}
        aria-label={title}
        className="h-full w-full object-contain"
      />

      {!started && (
        <button
          type="button"
          onClick={play}
          aria-label={`Play ${title}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/30"
        >
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#2a829b] text-white shadow-[0_8px_30px_rgba(0,0,0,.6)] ring-4 ring-white/20 transition active:scale-95">
            <PlayIcon className="ml-1 h-12 w-12" />
          </span>
          <span className="text-lg font-medium text-white">Tap to play</span>
        </button>
      )}
    </div>
  );
}
