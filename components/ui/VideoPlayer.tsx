"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatDuration } from "@/lib/format";

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
 */
export function VideoPlayer({
  src,
  title,
  subtitle,
  onClose,
}: {
  src: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  /** Show the controls, then hide them again after a pause if still playing. */
  const reveal = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (vid.current && !vid.current.paused) setVisible(false);
    }, 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const togglePlay = () => {
    const v = vid.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    reveal();
  };

  const restart = () => {
    const v = vid.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play();
    reveal();
  };

  const seekBy = (seconds: number) => {
    const v = vid.current;
    if (!v) return;
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
      void el.requestFullscreen();
    } else {
      // iPhone Safari has no element fullscreen, only the video element's own.
      v?.webkitEnterFullscreen?.();
    }
    reveal();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "k") {
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
  const fade = visible ? "opacity-100" : "pointer-events-none opacity-0";

  return (
    <div
      ref={box}
      tabIndex={0}
      autoFocus
      onKeyDown={onKey}
      onMouseMove={reveal}
      onTouchStart={reveal}
      className="relative min-h-0 flex-1 select-none bg-black outline-none"
    >
      <video
        ref={vid}
        src={src}
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
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted);
          setVolume(e.currentTarget.volume);
        }}
        className="absolute inset-0 h-full w-full object-contain"
      />

      {/* Title band */}
      <div
        className={`absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/75 to-transparent px-5 pt-4 pb-10 transition-opacity duration-300 ${fade}`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {subtitle && <p className="text-sm text-[#bfbfbf]">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Controls band */}
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
            <div className="h-full rounded-full bg-[#5fb8d4]" style={{ width: `${pct}%` }} />
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
              className="hidden w-24 accent-[#5fb8d4] sm:block"
            />
            <Control onClick={toggleFullscreen} label={fullscreen ? "Exit full screen" : "Full screen"}>
              {fullscreen ? <ExitFullscreenIcon className="h-6 w-6" /> : <FullscreenIcon className="h-6 w-6" />}
            </Control>
          </div>
        </div>
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
