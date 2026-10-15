"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { pictureRatio } from "./ClinicMark";
import { CloseIcon, HeartIcon } from "./icons";
import { PlayerOverlay } from "./PlayerOverlay";
import { PRIMARY_BUTTON } from "./styles";
import { usePlayerControls } from "./usePlayerControls";
import { SLOW_AFTER_MS, resumePoint } from "@/lib/playback";
import type { PlaybackSource } from "@/lib/playback-source";
import { useVideoSource } from "./useVideoSource";

/**
 * The library's full-screen procedure player, for the surgeon in the room.
 * Its controls, and the clinic's logo, the title and the surgeon's name over
 * the picture, are the same Vimeo-style ones the patient's player uses
 * (PlayerOverlay and usePlayerControls; agreed at the 2026-10-15 huddle):
 * read those for the layout, the fading and what a tap does. Custom controls
 * here were decided by Evan on 2026-09-18, after a version with the
 * browser's own controls was tried and turned down.
 *
 * Close is top right, with the other controls: a tap anywhere brings it
 * back, and Escape (handled by the library page) closes the player from
 * anywhere. Playback starts as soon as the element mounts (autoPlay), which
 * is inside the tap that opened the player, so sound is allowed.
 *
 * The clinic's mark carries the signed-in person's name as patients see it
 * on the links they send ("Dr. Jane Smith, DO") when they hold a seat
 * (libraryStripName() on the category page), otherwise the clinic's name,
 * and the amber "Placeholder animation" chip stays top right the whole time
 * for a sample. It is branding, not protection: see ClinicMark.
 *
 * WHEN THE VIDEO WILL NOT LOAD. A missing file, a blocked one, or a
 * connection that drops part-way: the picture is replaced by a calm panel
 * with one sentence and a Try again button (Close stays). Try again fetches
 * the file afresh and carries on from where it stopped. A video that is only
 * slow gets a quiet "still loading" note in the middle instead. Nothing
 * technical is shown.
 *
 * A file can also fail BEFORE this component is listening (the browser
 * starts fetching the moment the element exists), so the element is asked
 * once, a frame after opening, whether it has already failed.
 *
 * WHAT IT PLAYS is a PlaybackSource the category page made on the server
 * (lib/playback-auth.ts): a plain file, or a signed, expiring Mux stream.
 * useVideoSource puts it on the element (the browser's own HLS where it has
 * it, hls.js loaded on demand elsewhere) and, a little before a signed
 * address runs out, asks the server for a fresh one through `refresh`,
 * which checks the clinic's plan again. When the answer is that access has
 * ended (the category came off the plan while the player was open) the
 * player says so calmly and renews nothing.
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
  onClose,
  favorite,
  onFirstPlay,
}: {
  /** What to play, made on the server for this clinic. */
  source: PlaybackSource;
  /** Ask the server for a fresh address for the same video: the new source, or null when access has ended. */
  refresh?: () => Promise<PlaybackSource | null>;
  title: string;
  /** Kept for the category page, which still passes the category's name; the player no longer shows it. */
  subtitle?: string;
  /** A still to show before the first frame arrives. Empty means the browser shows black. */
  poster?: string;
  /** True for a sample animation standing in for the named procedure. Keeps the amber chip on the picture the whole time. */
  placeholder?: boolean;
  /** The clinic's name, for its initials when there is no logo, and as the second line when the person holds no seat. */
  clinicName: string;
  /** The clinic's checked logo address, or null for its initials. */
  logoUrl?: string | null;
  /** The signed-in person's name as patients see it ("Dr. Jane Smith, DO") when they hold a seat; null shows the clinic's name. */
  senderName?: string | null;
  onClose: () => void;
  /** The heart beside Close: whether this video is one of the person's favorites, and what a tap does. Left out, there is no heart. */
  favorite?: { on: boolean; onToggle: () => void };
  /** Called once, the first time the video actually starts playing after the player opened (to count a library play). Never again for this opening, Try again included. */
  onFirstPlay?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const slowTimer = useRef<number | undefined>(undefined);
  /** Where to pick up after Try again. */
  const resumeAt = useRef(0);
  /** Whether this opening of the player has already been counted as a play. A ref, so Try again and a pause never count twice. */
  const counted = useRef(false);

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

  const close = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close the video and go back to the library"
      title="Close"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/45 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.6)] hover:bg-black/60"
    >
      <CloseIcon className="h-5 w-5" />
    </button>
  );

  return (
    <div
      ref={box}
      tabIndex={0}
      autoFocus
      role="group"
      aria-label={`${title}, video player`}
      onKeyDown={controls.onKey}
      onMouseMove={controls.reveal}
      onMouseLeave={controls.hide}
      className="flex min-h-0 flex-1 select-none flex-col bg-black outline-none"
    >
      {/* The video's box. "picture-area" lets the overlay find the picture inside it (app/globals.css); its size always
          comes from the screen, never from what is in it, which that needs. */}
      <div className="picture-area relative min-h-0 flex-1" style={{ "--picture-ratio": ratio } as CSSProperties}>
        <video
          ref={vid}
          // A plain file goes on the element here; a stream is put on by useVideoSource once the player is awake.
          src={source.kind === "file" ? source.src : undefined}
          poster={poster}
          autoPlay
          playsInline
          controlsList="nodownload"
          onPlaying={() => {
            clearSlow();
            // The first time the picture really moves after opening: one library play (the browser's "playing" event, not the tap).
            if (!counted.current) {
              counted.current = true;
              onFirstPlay?.();
            }
          }}
          onCanPlay={clearSlow}
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
          showControls={!stopped}
          slow={slow && !stopped}
          topRight={
            favorite ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={favorite.onToggle}
                  aria-pressed={favorite.on}
                  aria-label={favorite.on ? `Remove ${title} from my favorites` : `Add ${title} to my favorites`}
                  title={favorite.on ? "Remove from my favorites" : "Add to my favorites"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/45 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.6)] hover:bg-black/60"
                >
                  <HeartIcon filled={favorite.on} className={`h-5 w-5 ${favorite.on ? "text-brand-bright" : ""}`} />
                </button>
                {close}
              </div>
            ) : (
              close
            )
          }
        />

        {stopped && (
          // Calm, and never the word "error". Announced to a screen reader when it appears. The same panel says, with
          // no Try again, that the video is no longer on the clinic's plan when the server would not renew the stream.
          // Close stays reachable: it is in the overlay above, which keeps showing while nothing plays.
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
