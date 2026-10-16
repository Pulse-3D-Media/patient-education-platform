"use client";

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import type { Chapter } from "@/lib/chapters";
import { pictureRatio } from "./ClinicMark";
import { PlayIcon } from "./icons";
import { jumpVideo } from "./player-element";
import { PlayerOverlay } from "./PlayerOverlay";
import { PRIMARY_BUTTON } from "./styles";
import { usePlayerControls } from "./usePlayerControls";
import { SLOW_AFTER_MS, resumePoint } from "@/lib/playback";
import type { PlaybackSource } from "@/lib/playback-source";
import { useVideoSource } from "./useVideoSource";

/** What the watch page can ask of the player: go to a chapter's start. */
export type PlayerHandle = { jumpTo: (seconds: number) => void };

/**
 * The library's procedure player, for the surgeon in the room, on the watch
 * page (/library/watch/<id>). Its controls, and the clinic's logo, the title
 * and the surgeon's name over the picture, are the same Vimeo-style ones the
 * patient's player uses (PlayerOverlay and usePlayerControls; agreed at the
 * 2026-10-15 huddle): read those for the layout, the fading and what a tap
 * does. Custom controls here were decided by Evan on 2026-09-18, after a
 * version with the browser's own controls was tried and turned down.
 *
 * IT OPENS PAUSED (decided by Evan on 2026-10-15: a surgeon may open the
 * page while still talking to the patient). Until the first play there is
 * one big Play button in the middle and the clinic's mark, nothing else; the
 * video starts loading at once (preload) so the Play tap is quick. The tap
 * is what starts it, so sound is allowed. From then on the usual controls.
 * It fills whatever box the page gives it, and goes full screen itself.
 *
 * The clinic's mark carries the signed-in person's name as patients see it
 * on the links they send ("Dr. Jane Smith, DO") when they hold a seat
 * (libraryStripName() on the watch page), otherwise the clinic's name, and
 * the amber "Placeholder animation" chip stays top right the whole time for
 * a sample. It is branding, not protection: see ClinicMark.
 *
 * WHEN THE VIDEO WILL NOT LOAD. A missing file, a blocked one, or a
 * connection that drops part-way: the picture is replaced by a calm panel
 * with one sentence and a Try again button. Try again fetches
 * the file afresh and carries on from where it stopped. A video that is only
 * slow gets a quiet "still loading" note in the middle instead. Nothing
 * technical is shown.
 *
 * A file can also fail BEFORE this component is listening (the browser
 * starts fetching the moment the element exists), so the element is asked
 * once, a frame after opening, whether it has already failed.
 *
 * WHAT IT PLAYS is a PlaybackSource the watch page made on the server
 * (lib/playback-auth.ts): a plain file, or a signed, expiring Mux stream.
 * useVideoSource puts it on the element (the browser's own HLS where it has
 * it, hls.js loaded on demand elsewhere) and, a little before a signed
 * address runs out, asks the server for a fresh one through `refresh`,
 * which checks the clinic's plan again. When the answer is that access has
 * ended (the category came off the plan while the player was open) the
 * player says so calmly and renews nothing.
 *
 * CHAPTERS (the watch page's, set on /pulse/videos): small marks on the
 * progress bar and the current chapter's name beside the time, drawn by
 * PlayerOverlay. The page lists them in its Chapters panel, hears the time
 * through `onTimeChange` to light the current one, and jumps with the
 * `jumpTo` this player hands it through `ref` (playing on if it was
 * playing, staying paused if it was paused).
 */
export function VideoPlayer({
  source,
  refresh,
  title,
  placeholder = false,
  poster,
  clinicName,
  logoUrl = null,
  senderName = null,
  onFirstPlay,
  chapters = [],
  onTimeChange,
  ref,
}: {
  /** What to play, made on the server for this clinic. */
  source: PlaybackSource;
  /** Ask the server for a fresh address for the same video: the new source, or null when access has ended. */
  refresh?: () => Promise<PlaybackSource | null>;
  title: string;
  /** A still to show until the first frame. Empty means the browser shows black (or the first frame, once it has it). */
  poster?: string;
  /** True for a sample animation standing in for the named procedure. Keeps the amber chip on the picture the whole time. */
  placeholder?: boolean;
  /** The clinic's name, for its initials when there is no logo, and as the second line when the person holds no seat. */
  clinicName: string;
  /** The clinic's checked logo address, or null for its initials. */
  logoUrl?: string | null;
  /** The signed-in person's name as patients see it ("Dr. Jane Smith, DO") when they hold a seat; null shows the clinic's name. */
  senderName?: string | null;
  /** Called once, the first time the video actually starts playing after the page opened (to count a library play). Never again for this opening, Try again included. */
  onFirstPlay?: () => void;
  /** The video's chapters, sorted by time: marks on the progress bar and the current one's name beside the time. Empty for none. */
  chapters?: Chapter[];
  /** Hears where the video is, whenever that changes (playing, or moved). */
  onTimeChange?: (seconds: number) => void;
  /** Hands the page jumpTo(), for the Chapters panel. */
  ref?: Ref<PlayerHandle>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const slowTimer = useRef<number | undefined>(undefined);
  /** Where to pick up after Try again. */
  const resumeAt = useRef(0);
  /** Whether this opening of the player has already been counted as a play. A ref, so Try again and a pause never count twice. */
  const counted = useRef(false);

  /** The video has been played at least once: until then the big Play button is all there is to press. */
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Access ended while the player was open (the server would not renew the stream). Said calmly, with no Try again. */
  const [ended, setEnded] = useState(false);
  const [slow, setSlow] = useState(false);
  /** The video's shape, width over height, once the file says; 16:9 until then. Keeps the overlay on the picture. */
  const [ratio, setRatio] = useState(() => pictureRatio(undefined, undefined));

  /** Nothing is playing and nothing can be: the failure panel, or access ended. */
  const stopped = failed || ended;

  const clearSlow = () => {
    window.clearTimeout(slowTimer.current);
    setSlow(false);
  };

  /** The video cannot be played right now. Remember where it was, and show the calm panel. */
  const fail = () => {
    // Keep the furthest point reached: a second failure, straight after Try again, reports 0 and must not wipe it.
    const point = resumePoint(vid.current?.currentTime);
    if (point > 0) resumeAt.current = point;
    clearSlow();
    setFailed(true);
  };

  const controls = usePlayerControls({ video: vid, box, enabled: !stopped, onPlayFailure: () => fail() });

  const { reload } = useVideoSource(vid, source, {
    onFailure: () => fail(),
    refresh,
    onEnded: () => {
      clearSlow();
      setEnded(true);
    },
  });

  useEffect(() => () => window.clearTimeout(slowTimer.current), []);

  // A tap in the Chapters panel: go to that chapter's start. Playing or paused stays as it was; nothing while the video has failed.
  useImperativeHandle(ref, () => ({
    jumpTo: (seconds: number) => {
      if (!vid.current || stopped) return;
      jumpVideo(vid.current, seconds);
      if (started) controls.reveal();
    },
  }));

  // A file that is missing or blocked can fail before this component is listening, and the "error" event is then
  // never heard. The element remembers, so it is asked once, a frame after the player opens.
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const v = vid.current;
      if (v?.error) setFailed(true);
      else if (v && v.videoWidth > 0) setRatio(pictureRatio(v.videoWidth, v.videoHeight));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  // When the failure panel appears, put the keyboard on Try again.
  useEffect(() => {
    if (failed) retryButton.current?.focus({ preventScroll: true });
  }, [failed]);

  /** Try again: fetch the file afresh and carry on from where it stopped. Inside the tap, so sound is still allowed. */
  const retry = () => {
    setFailed(false);
    // The hook fetches the file afresh, or a fresh signed address when the old one has run out, and starts the video.
    void reload(resumeAt.current);
    // Try again is about to disappear; hand the keyboard back to the player so the shortcuts keep working.
    window.requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={`${title}, video player`}
      onKeyDown={controls.onKey}
      onMouseMove={started ? controls.reveal : undefined}
      onMouseLeave={controls.hide}
      className="flex h-full min-h-0 w-full flex-1 select-none flex-col bg-black outline-none"
    >
      {/* The video's box. "picture-area" lets the overlay find the picture inside it (app/globals.css); its size always
          comes from the screen, never from what is in it, which that needs. */}
      <div className="picture-area relative min-h-0 flex-1" style={{ "--picture-ratio": ratio } as CSSProperties}>
        <video
          ref={vid}
          // A plain file goes on the element here; a stream is put on by useVideoSource once the player is awake.
          src={source.kind === "file" ? source.src : undefined}
          poster={poster}
          // Never autoPlay: the page opens paused and waits for the Play tap. It starts fetching straight away, so the tap is quick.
          preload="auto"
          playsInline
          controlsList="nodownload"
          onPlay={() => setStarted(true)}
          onPlaying={() => {
            clearSlow();
            // The first time the picture really moves after opening: one library play (the browser's "playing" event, not the tap).
            if (!counted.current) {
              counted.current = true;
              onFirstPlay?.();
            }
          }}
          onCanPlay={clearSlow}
          onTimeUpdate={(e) => onTimeChange?.(e.currentTarget.currentTime)}
          onSeeked={(e) => onTimeChange?.(e.currentTarget.currentTime)}
          onWaiting={() => {
            // Out of data and waiting for more. Say so only if it goes on for a while.
            window.clearTimeout(slowTimer.current);
            slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
          }}
          onError={fail}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setRatio(pictureRatio(v.videoWidth, v.videoHeight));
            // After Try again, go back to where the video stopped.
            if (resumeAt.current > 0) {
              v.currentTime = Math.min(resumeAt.current, v.duration || resumeAt.current);
              resumeAt.current = 0;
            }
          }}
          aria-label={title}
          // When it has failed, the panel below says so in our words; the hidden video should not say it again.
          aria-hidden={stopped || undefined}
          className={`absolute inset-0 h-full w-full object-contain ${stopped ? "invisible" : ""}`}
        />

        <PlayerOverlay
          controls={controls}
          title={title}
          clinicName={clinicName}
          logoUrl={logoUrl}
          senderName={senderName}
          placeholder={placeholder}
          chapters={chapters}
          // Before the first play only the clinic's mark is drawn; the big Play button below is the one thing to press.
          showControls={started && !stopped}
          slow={slow && !stopped}
        />

        {!started && !stopped && (
          // The page opens paused. On a phone the box is short, so the button sits low, clear of the clinic's mark in
          // the top left; on a wider player it is in the middle, a little low. The same look as the patient's Play.
          <button
            type="button"
            onClick={controls.togglePlay}
            aria-label={`Play ${title}`}
            className="group absolute inset-0 z-20 flex flex-col items-center justify-end gap-2 pb-4 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-4px] focus-visible:outline-white sm:justify-center sm:gap-3 sm:pb-0 sm:pt-12"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#12333f] shadow-[0_10px_34px_rgba(0,0,0,.4)] transition group-hover:scale-105 group-active:scale-95 sm:h-20 sm:w-20">
              <PlayIcon className="ml-1 h-8 w-8 sm:h-10 sm:w-10" />
            </span>
            <span className="rounded-full bg-white px-4 py-1.5 text-[16px] font-semibold text-[#12333f] shadow-[0_4px_16px_rgba(0,0,0,.3)] sm:text-[17px]">Play</span>
          </button>
        )}

        {stopped && (
          // Calm, and never the word "error". Announced to a screen reader when it appears. The same panel says, with
          // no Try again, that the video is no longer on the clinic's plan when the server would not renew the stream.
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-xl font-semibold text-white">{ended ? "This video is no longer available to your clinic." : "This video did not load."}</p>
            <p className="text-base text-[#bfbfbf]">{ended ? "It has come off your clinic's plan. Your office admin can add it back on Billing." : "Check your connection, then try again."}</p>
            {!ended && (
              <button ref={retryButton} type="button" onClick={retry} className={`${PRIMARY_BUTTON} min-h-12`}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
