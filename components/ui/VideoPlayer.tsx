"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClinicMark } from "./ClinicMark";
import {
  CloseIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  VolumeIcon,
} from "./icons";
import { PLACEHOLDER_CHIP, PRIMARY_BUTTON } from "./styles";
import { formatDuration } from "@/lib/format";
import { SLOW_AFTER_MS, playRefusalIsFailure, resumePoint } from "@/lib/playback";

/**
 * The full-screen procedure player, with our own controls instead of the
 * browser's: title top-left, a scrub bar with the current time and length,
 * play/pause and replay on the left, sound and fullscreen on the right.
 *
 * The controls fade out after a moment while the video plays and come back
 * on any mouse movement or tap. Every control is at least 44px so it works
 * on a tablet held in one hand.
 *
 * Playback starts as soon as the element mounts (autoPlay), which is inside
 * the tap that opened the player, so sound is allowed.
 *
 * THE STRIP ABOVE THE PICTURE. Two things have to stay on screen for as long
 * as the picture is: the amber "Placeholder animation" chip (when the video
 * is a sample standing in for the named procedure) and the clinic's mark
 * (its logo, or its name). Neither is laid over the picture, because an
 * anatomy label can be anywhere in a frame. They sit in a slim row of their
 * own above it, and come along when the player goes full screen. The title
 * and the controls do sit over the picture, but only while they are showing;
 * they fade away a moment after the last touch. The mark is branding, not
 * protection: see ClinicMark.
 *
 * WHEN THE VIDEO WILL NOT LOAD. A missing file, a blocked one, or a
 * connection that drops part-way: the picture is replaced by a calm panel
 * with one sentence and a Try again button, and the title bar (with Close)
 * stays up. Try again fetches the file afresh and carries on from where it
 * stopped. A video that is only slow gets a quiet "still loading" note
 * instead. Nothing technical is shown.
 *
 * A file can also fail BEFORE this component is listening (the browser
 * starts fetching the moment the element exists), so the element is asked
 * once, a frame after opening, whether it has already failed.
 *
 * Because the controls are ordinary buttons, the keyboard works everywhere
 * in the player: space or K plays and pauses, the arrows move ten seconds,
 * M mutes, F is full screen, and Escape (handled by the library page) closes.
 */
export function VideoPlayer({
  src,
  title,
  subtitle,
  placeholder = false,
  poster,
  clinicName,
  logoUrl = null,
  onClose,
}: {
  src: string;
  title: string;
  subtitle?: string;
  /** A still to show before the first frame arrives. Empty means the browser shows black. */
  poster?: string;
  /** True for a sample animation standing in for the named procedure. Keeps a chip above the picture the whole time. */
  placeholder?: boolean;
  /** The clinic's name, for the mark above the picture. Left out, there is no mark. */
  clinicName?: string;
  /** The clinic's checked logo address for that mark, or null to show its name. */
  logoUrl?: string | null;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const slowTimer = useRef<number | undefined>(undefined);
  /** Where to pick up after Try again. */
  const resumeAt = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);

  /** Show the controls, then hide them again after a pause if still playing. */
  const reveal = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (vid.current && !vid.current.paused) setVisible(false);
    }, 2600);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(slowTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A file that is missing or blocked can fail before this component is
  // listening, and the "error" event is then never heard. The element
  // remembers, so it is asked once, a frame after the player opens. The same
  // goes for the video's length, if that arrived before anyone was listening.
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const v = vid.current;
      if (!v) return;
      if (v.error) setFailed(true);
      else if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  // When the failure panel appears, put the keyboard on Try again.
  useEffect(() => {
    if (failed) retryButton.current?.focus({ preventScroll: true });
  }, [failed]);

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
    // The title bar holds Close, so it stays up for as long as the panel does.
    window.clearTimeout(hideTimer.current);
    setVisible(true);
    setFailed(true);
  };

  /** Ask the video to play. Most refusals mean "not yet" (see lib/playback.ts); only a file that cannot be played at all is a failure. */
  const start = (v: HTMLVideoElement) => {
    v.play().catch((error: unknown) => {
      if (playRefusalIsFailure((error as { name?: string } | null)?.name)) fail();
    });
  };

  /** Try again: fetch the file afresh and carry on from where it stopped. Inside the tap, so sound is still allowed. */
  const retry = () => {
    const v = vid.current;
    if (!v) return;
    setFailed(false);
    v.load();
    start(v);
    // Try again is about to disappear; hand the keyboard back to the player so the shortcuts keep working.
    window.requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
  };

  const togglePlay = () => {
    const v = vid.current;
    if (!v || failed) return;
    if (v.paused) start(v);
    else v.pause();
    reveal();
  };

  const restart = () => {
    const v = vid.current;
    if (!v || failed) return;
    v.currentTime = 0;
    start(v);
    reveal();
  };

  const seekBy = (seconds: number) => {
    const v = vid.current;
    if (!v || failed) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration || 0);
    reveal();
  };

  const toggleMute = () => {
    const v = vid.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    reveal();
  };

  const changeVolume = (value: number) => {
    const v = vid.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
    setVolume(value);
    setMuted(v.muted);
  };

  const toggleFullscreen = () => {
    const el = box.current;
    const v = vid.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (el?.requestFullscreen) {
      // The whole player goes, not just the video, so the strip and our controls come with it.
      // If the browser says no, the player already fills the screen, so nothing is lost.
      el.requestFullscreen().catch(() => {});
    } else {
      // iPhone Safari has no element fullscreen, only the video element's own
      // (which shows the video alone, without the strip or our controls).
      v?.webkitEnterFullscreen?.();
    }
    reveal();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "k") {
      // Space on a focused button already presses that button; only act when the player itself has the focus.
      if (e.key === " " && e.target !== e.currentTarget) return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight") seekBy(10);
    else if (e.key === "ArrowLeft") seekBy(-10);
    else if (e.key === "m") toggleMute();
    else if (e.key === "f") toggleFullscreen();
  };

  // A tap on the picture brings the controls back first; a second tap pauses.
  const onVideoClick = () => {
    if (!visible) reveal();
    else togglePlay();
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const fade = visible || failed ? "opacity-100" : "pointer-events-none opacity-0";

  return (
    <div
      ref={box}
      tabIndex={0}
      autoFocus
      role="group"
      aria-label={`${title}, video player`}
      onKeyDown={onKey}
      onMouseMove={reveal}
      onTouchStart={reveal}
      className="flex min-h-0 flex-1 select-none flex-col bg-black outline-none"
    >
      {/* The strip above the picture: what has to stay on screen the whole time, kept off the picture itself. */}
      {(placeholder || clinicName) && (
        <div className="relative flex h-10 shrink-0 items-center px-5">
          {placeholder && <span className={PLACEHOLDER_CHIP}>Placeholder animation</span>}
          {clinicName && <ClinicMark logoUrl={logoUrl} name={clinicName} size="patient" className="right-5 top-1" />}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <video
          ref={vid}
          src={src}
          poster={poster}
          autoPlay
          playsInline
          controlsList="nodownload"
          onClick={onVideoClick}
          onDoubleClick={toggleFullscreen}
          onPlay={() => {
            setPlaying(true);
            reveal();
          }}
          onPause={() => {
            setPlaying(false);
            reveal();
          }}
          onPlaying={clearSlow}
          onCanPlay={clearSlow}
          onWaiting={() => {
            // Out of data and waiting for more. Say so only if it goes on for a while.
            window.clearTimeout(slowTimer.current);
            slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
          }}
          onError={fail}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(v.duration);
            // After Try again, go back to where the video stopped.
            if (resumeAt.current > 0) {
              v.currentTime = Math.min(resumeAt.current, v.duration || resumeAt.current);
              resumeAt.current = 0;
            }
          }}
          onVolumeChange={(e) => {
            setMuted(e.currentTarget.muted);
            setVolume(e.currentTarget.volume);
          }}
          aria-label={title}
          // When it has failed, the panel below says so in our words; the hidden video should not say it again.
          aria-hidden={failed || undefined}
          className={`absolute inset-0 h-full w-full object-contain ${failed ? "invisible" : ""}`}
        />

        {/* Said only when the wait has gone on a while. It sits over the picture, but only while the picture is stuck. The element is always here so a screen reader hears the words when they arrive. */}
        <p
          role="status"
          className={
            slow && !failed
              ? "pointer-events-none absolute left-1/2 top-1/2 z-10 w-max max-w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/70 px-4 py-2 text-center text-base text-white"
              : "sr-only"
          }
        >
          {slow && !failed ? "Still loading. A slow connection can take a little longer." : ""}
        </p>

        {failed && (
          // Calm, and never the word "error". Announced to a screen reader when it appears.
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-xl font-semibold text-white">This video did not load.</p>
            <p className="text-base text-[#bfbfbf]">Check your connection, then try again.</p>
            <button ref={retryButton} type="button" onClick={retry} className={`${PRIMARY_BUTTON} min-h-12`}>
              Try again
            </button>
          </div>
        )}

        {/* Title band */}
        <div
          className={`absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/75 to-transparent px-5 pb-10 pt-4 transition-opacity duration-300 ${fade}`}
        >
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{title}</h2>
            {subtitle && <p className="text-sm text-[#bfbfbf]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the video and go back to the library"
            title="Close"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Controls band. Not there at all while the video has failed: there is nothing to control. */}
        {!failed && (
          <div
            className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-5 pb-3 pt-12 transition-opacity duration-300 ${fade}`}
          >
            <div className="flex items-center justify-between text-sm font-medium text-white">
              <span>{formatDuration(time)}</span>
              <span className="text-[#bfbfbf]">{formatDuration(duration)}</span>
            </div>

            {/* Scrub bar: a drawn track and thumb, with an invisible range input over it for dragging */}
            <div className="relative flex h-8 items-center">
              <div className="h-1 w-full rounded-full bg-white/25">
                <div className="h-full rounded-full bg-brand-bright" style={{ width: `${pct}%` }} />
              </div>
              <span
                className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow"
                style={{ left: `${pct}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={time}
                onChange={(e) => {
                  const v = vid.current;
                  if (v) v.currentTime = Number(e.target.value);
                  reveal();
                }}
                aria-label="Seek"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Control onClick={togglePlay} label={playing ? "Pause" : "Play"}>
                  {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
                </Control>
                <Control onClick={restart} label="Start over">
                  <ReplayIcon className="h-6 w-6" />
                </Control>
              </div>
              <div className="flex items-center gap-1">
                <Control onClick={toggleMute} label={muted ? "Unmute" : "Mute"}>
                  {muted ? <MuteIcon className="h-6 w-6" /> : <VolumeIcon className="h-6 w-6" />}
                </Control>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="hidden w-24 accent-brand-bright sm:block"
                />
                <Control onClick={toggleFullscreen} label={fullscreen ? "Exit full screen" : "Full screen"}>
                  {fullscreen ? <ExitFullscreenIcon className="h-6 w-6" /> : <FullscreenIcon className="h-6 w-6" />}
                </Control>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Control({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:bg-white/15 active:bg-white/25"
    >
      {children}
    </button>
  );
}
