"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ClinicMark, pictureRatio } from "./ClinicMark";
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
import { PRIMARY_BUTTON } from "./styles";
import { formatDuration } from "@/lib/format";
import { SLOW_AFTER_MS, playRefusalIsFailure, resumePoint } from "@/lib/playback";
import type { PlaybackSource } from "@/lib/playback-source";
import { useVideoSource } from "./useVideoSource";

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
 * THE STRIP ON THE PICTURE. A thin dark band across the top edge of the
 * picture (ClinicMark) carries what has to stay on screen for as long as the
 * picture does: the clinic's logo (or name), the signed-in person's name as
 * patients see it on the links they send ("Dr. Jane Smith, DO"),
 * when they hold a seat, and the amber "Placeholder animation" chip when the
 * video is a sample standing in for the named procedure. It sits on the
 * picture's own top edge, not the screen's, even where the picture is
 * letterboxed (OnPicture's arithmetic, in app/globals.css), and comes along
 * when the player goes full screen. It never takes a tap.
 *
 * The title row (with Close) and the controls sit over the picture only
 * while they are showing, and fade away a moment after the last touch. The
 * title row always starts just UNDER the strip (.below-picture-top), so the
 * two never overlap and Close is never under the band. The strip is
 * branding, not protection: see ClinicMark.
 *
 * FULL SCREEN. The Full screen button puts the whole player full screen,
 * strip included, wherever the browser can do that for part of a page
 * (Chrome, Edge, Android, Safari on a Mac and on an iPad). An iPhone cannot:
 * there the button hands the video to the phone's own player, which shows it
 * without the strip or these controls. The player already fills the screen
 * on an iPhone, so that is the one place full screen loses the strip.
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
  subtitle,
  placeholder = false,
  poster,
  clinicName,
  logoUrl = null,
  senderName = null,
  onClose,
}: {
  /** What to play, made on the server for this clinic. */
  source: PlaybackSource;
  /** Ask the server for a fresh address for the same video: the new source, or null when access has ended. */
  refresh?: () => Promise<PlaybackSource | null>;
  title: string;
  subtitle?: string;
  /** A still to show before the first frame arrives. Empty means the browser shows black. */
  poster?: string;
  /** True for a sample animation standing in for the named procedure. Keeps a chip on the strip the whole time. */
  placeholder?: boolean;
  /** The clinic's name, for the strip on the picture (in place of the logo when there is none). */
  clinicName: string;
  /** The clinic's checked logo address for the strip, or null to show its name. */
  logoUrl?: string | null;
  /** The signed-in person's name as patients see it ("Dr. Jane Smith, DO") when they hold a seat; null shows only the clinic. */
  senderName?: string | null;
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
  /** Access ended while the player was open (the server would not renew the stream). Said calmly, with no Try again. */
  const [ended, setEnded] = useState(false);
  const [slow, setSlow] = useState(false);
  /** The video's shape, width over height, once the file says; 16:9 until then. Places the strip on the picture's top edge. */
  const [ratio, setRatio] = useState(() => pictureRatio(undefined, undefined));
  const { reload } = useVideoSource(vid, source, {
    onFailure: () => fail(),
    refresh,
    onEnded: () => {
      clearSlow();
      window.clearTimeout(hideTimer.current);
      setVisible(true);
      setEnded(true);
    },
  });

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
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
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
      else if (Number.isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
        setRatio(pictureRatio(v.videoWidth, v.videoHeight));
      }
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
    // The hook fetches the file afresh, or a fresh signed address when the old one has run out, and starts the video.
    void reload(resumeAt.current);
    // Try again is about to disappear; hand the keyboard back to the player so the shortcuts keep working.
    window.requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
  };

  /** Nothing is playing and nothing can be: the failure panel, or access ended. The layout treats both alike. */
  const stopped = failed || ended;

  const togglePlay = () => {
    const v = vid.current;
    if (!v || stopped) return;
    if (v.paused) start(v);
    else v.pause();
    reveal();
  };

  const restart = () => {
    const v = vid.current;
    if (!v || stopped) return;
    v.currentTime = 0;
    start(v);
    reveal();
  };

  const seekBy = (seconds: number) => {
    const v = vid.current;
    if (!v || stopped) return;
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
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    const v = vid.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
      webkitFullscreenEnabled?: boolean;
    };
    const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      try {
        Promise.resolve((doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)).catch(() => {});
      } catch { /* Escape still leaves full screen. */ }
    } else if (el && request && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false)) {
      // The whole player goes, not just the video, so the strip and our controls come with it. (Older Safari on an
      // iPad and a Mac only knows the "webkit" name.) If the browser says no, the player already fills the screen,
      // so nothing is lost.
      try {
        Promise.resolve(request.call(el)).catch(() => {});
      } catch { /* As above: the player already fills the screen. */ }
    } else {
      // An iPhone has no full screen for part of a page, only the video element's own
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
  const fade = visible || stopped ? "opacity-100" : "pointer-events-none opacity-0";

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
      {/* The video's box. "picture-area" lets the strip and the title row find the picture's top edge inside it (app/globals.css);
          its size always comes from the screen, never from what is in it, which that needs. */}
      <div className="picture-area relative min-h-0 flex-1" style={{ "--picture-ratio": ratio } as CSSProperties}>
        <video
          ref={vid}
          // A plain file goes on the element here; a stream is put on by useVideoSource once the player is awake.
          src={source.kind === "file" ? source.src : undefined}
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
            setRatio(pictureRatio(v.videoWidth, v.videoHeight));
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
          aria-hidden={stopped || undefined}
          className={`absolute inset-0 h-full w-full object-contain ${stopped ? "invisible" : ""}`}
        />

        {/* Said only when the wait has gone on a while. It sits over the picture, but only while the picture is stuck. The element is always here so a screen reader hears the words when they arrive. */}
        <p
          role="status"
          className={
            slow && !stopped
              ? "pointer-events-none absolute left-1/2 top-1/2 z-10 w-max max-w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/70 px-4 py-2 text-center text-base text-white"
              : "sr-only"
          }
        >
          {slow && !stopped ? "Still loading. A slow connection can take a little longer." : ""}
        </p>

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

        {/* The strip on the picture's top edge: the whole time, failed or not, and never takes a tap. */}
        <div className="picture-fit pointer-events-none">
          <ClinicMark logoUrl={logoUrl} name={clinicName} senderName={senderName} placeholder={placeholder} />
        </div>

        {/* Title band. It starts just under the strip (below-picture-top; top-8 where a browser cannot place it), so Close is never under the band. */}
        <div
          className={`below-picture-top absolute inset-x-0 top-8 flex items-start justify-between gap-4 bg-gradient-to-b from-black/75 to-transparent px-5 pb-10 pt-3 transition-opacity duration-300 ${fade}`}
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

        {/* Controls band. Not there at all while the video has failed or access ended: there is nothing to control. */}
        {!stopped && (
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
