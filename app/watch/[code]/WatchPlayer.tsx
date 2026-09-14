"use client";

import { useRef, useState } from "react";
import { PlayIcon } from "@/components/ui/icons";
import { recordPlay } from "./actions";

/**
 * The patient's player: the video with one big Play button over it.
 *
 * Before the first tap, the Play button is the only thing on screen (the
 * rules file: nothing to click except play). After it, the browser's own
 * controls take over, because those are the controls a patient already knows
 * from every other video on their phone.
 *
 * The button is a dark triangle on a white circle, with "Tap to play" on a
 * white pill under it. That is deliberate: the first frame of the animation
 * is a near-white title card, and white text over a light frame is close to
 * invisible (about 2:1). Dark on white reads over any frame, light or dark.
 *
 * Client component because the tap itself has to start playback (browsers
 * only allow sound when the person has just tapped), and because the first
 * real play is what counts as a play start.
 *
 * What counts as a play start, and why it is tied to the `playing` event:
 * the browser fires `play` the moment play is asked for, and `playing` only
 * once frames are actually being shown. Loading the page, a text message
 * previewing it, the poster or the first bytes being fetched (preload), and
 * pausing and resuming fire neither one in a way that reaches the server:
 * the count is sent once per page load, the first time `playing` fires, and
 * never again on that page (`counted`), whatever happens after. That one
 * call is also what may move a first-play link's deadline, so nothing but
 * real playback can start the clock.
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

  /** Play was asked for: hand the patient the browser's own controls. */
  function onPlay() {
    setStarted(true);
  }

  /** Frames are actually showing: count the play start, once per page load. */
  function onPlaying() {
    if (counted.current) return;
    counted.current = true;
    // Recorded in the background, one attempt. If it does not get through,
    // the video still plays; the play is just not counted (see actions.ts).
    recordPlay(code).catch(() => {});
  }

  return (
    // Rounded at every size: a phone is the only screen this page is used on.
    <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black shadow-[0_10px_30px_-14px_rgba(18,32,42,.4)]">
      <video
        ref={video}
        src={src}
        preload="auto"
        playsInline
        controls={started}
        controlsList="nodownload"
        onPlay={onPlay}
        onPlaying={onPlaying}
        aria-label={title}
        className="h-full w-full object-contain"
      />

      {!started && (
        // The keyboard focus ring is drawn just inside the edge, because the
        // rounded box clips anything drawn outside it.
        <button
          type="button"
          onClick={play}
          aria-label={`Play ${title}`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[18px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-4px] focus-visible:outline-[#1e5668]"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-[#12333f] shadow-[0_10px_34px_rgba(0,0,0,.4)] transition active:scale-95">
            <PlayIcon className="ml-1 h-10 w-10" />
          </span>
          <span className="rounded-full bg-white px-4 py-2 text-[17px] font-semibold text-[#12333f] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
            Tap to play
          </span>
        </button>
      )}
    </div>
  );
}
