"use client";

import type { ReactNode } from "react";
import { currentChapterIndex, type Chapter } from "@/lib/chapters";
import { formatDuration } from "@/lib/format";
import { ClinicMark } from "./ClinicMark";
import { CaptionsIcon, ExitFullscreenIcon, FullscreenIcon, MuteIcon, PauseIcon, PlayIcon, ReplayIcon, SkipBackIcon, SkipForwardIcon, VolumeIcon } from "./icons";
import { SKIP_SECONDS, seekValueText } from "./player-rules";
import { PLACEHOLDER_CHIP, PLAYER_FOCUS } from "./styles";
import type { PlayerControls } from "./usePlayerControls";
import type { PlayerCaptions } from "./useVideoSource";

/**
 * What both players lay over the picture, laid out the way Vimeo does it
 * (agreed by Evan and Van at the 2026-10-15 huddle, with a Vimeo screenshot):
 *
 *   - Top left: the clinic's logo (round, or a white tag for a wide
 *     wordmark) and the doctor's name (ClinicMark). The video's title joins
 *     them only in full screen: everywhere else the page writes it in full
 *     right above or under the player. Top right: the placeholder chip.
 *   - In the middle, on a phone or a tablet (a screen with no mouse): back
 *     10 seconds, play or pause, forward 10 seconds, each on a soft dark
 *     circle so it reads over a white frame (VIDEO_BUTTON_ALPHA in
 *     lib/branding.ts), sized to cover little of a phone's picture while
 *     staying at least 44px to tap. With a mouse there is nothing in the
 *     middle: the play button is at the bottom left, as on Vimeo.
 *     Which one shows is decided by the browser (the `computer:` variant in
 *     app/globals.css: a mouse or trackpad that can hover), never by its name.
 *   - Along the bottom: the play button (mouse only), the time, CC (only for
 *     a video with captions), sound and full screen, and a thin progress bar to drag, on a soft fade only as
 *     tall as that row (.video-scrim in app/globals.css). When the video has
 *     chapters (the library's watch page only), a small gap in the bar marks
 *     where each one starts, and the current chapter's name follows the time.
 *
 * All of it fades together a moment after the video starts, and comes back
 * when the video is paused, on a tap, or when the mouse moves over the
 * player (usePlayerControls decides). The one thing that never fades is the
 * amber "Placeholder animation" chip, top right, which stays for as long as
 * the picture does.
 *
 * It sits on exactly the picture (.picture-fit in app/globals.css), not on
 * the black bars around a letterboxed one, and it is the picture's tap
 * target: a tap shows or hides the controls, a click plays or pauses, a
 * double-click is full screen. Every control is at least 44px to tap.
 */
export function PlayerOverlay({
  controls,
  title,
  clinicName,
  logoUrl,
  senderName,
  placeholder = false,
  showControls,
  slow,
  loading = false,
  topRight = null,
  chapters = [],
  captions = null,
}: {
  controls: PlayerControls;
  title: string;
  clinicName: string;
  logoUrl: string | null;
  senderName: string | null;
  /** True for a sample animation standing in for the named procedure: the amber chip, top right, the whole time. */
  placeholder?: boolean;
  /** False before the first play on the patient page (its own big Play button is the only thing to press) and while the video has failed: only the clinic's mark is drawn. */
  showControls: boolean;
  /** The video has been waiting for data a while: "still loading" in the middle, in place of the middle buttons. */
  slow: boolean;
  /**
   * The video is waiting for data right now (just after Play, or buffering): a small spinner in the middle, in place
   * of the middle buttons, until frames show again. Drawn only, never announced (the player says it once, in words, on
   * its own); the "still loading" sentence still takes over after a while. The patient player only, for now.
   */
  loading?: boolean;
  /** One of the player's own buttons for the top right (the library's Close). Fades with the controls. */
  topRight?: ReactNode;
  /** The video's chapters, sorted by time. Empty for none (always, on the patient page). */
  chapters?: Chapter[];
  /** Captions, from useVideoSource. The CC button shows only when the playing video has a caption track. */
  captions?: PlayerCaptions | null;
}) {
  const fade = controls.showing ? "opacity-100" : "pointer-events-none opacity-0";
  const pct = controls.duration ? (controls.time / controls.duration) * 100 : 0;
  const chapter = chapters[currentChapterIndex(chapters, controls.time)];
  // A mark for every chapter after the first, once the length is known and only where it falls inside the video.
  const marks = controls.duration ? chapters.filter((c) => c.startSeconds > 0 && c.startSeconds < controls.duration) : [];
  const playLabel = controls.finished ? "Play again" : controls.playing ? "Pause" : "Play";
  const playIcon = (size: string) =>
    controls.finished ? <ReplayIcon className={size} /> : controls.playing ? <PauseIcon className={size} /> : <PlayIcon className={`ml-0.5 ${size}`} />;

  return (
    <div
      // Without controls (before the first play on the patient page, or when the video has failed) it takes no taps, so
      // the player's own Play or Try again underneath gets them; only the top-right button stays live.
      className={`picture-fit @container z-10 ${showControls ? "" : "pointer-events-none"}`}
      onPointerUp={showControls ? controls.onPictureTap : undefined}
      onDoubleClick={showControls ? controls.toggleFullscreen : undefined}
    >
      {/* Top: the clinic's mark (left), the player's own button and the placeholder chip (right). The video's title joins
          the mark only in full screen, where the page's own title is out of sight. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-2.5 @xl:p-4">
        <div className={`min-w-0 transition-opacity duration-300 motion-reduce:transition-none ${fade}`}>
          <ClinicMark logoUrl={logoUrl} name={clinicName} title={controls.fullscreen ? title : null} senderName={senderName} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* On a narrow player (a phone) the short word, so the clinic's mark beside it keeps room for the doctor's name. */}
          {placeholder && (
            <span className={PLACEHOLDER_CHIP}>
              <span className="@xl:hidden">Placeholder</span>
              <span className="hidden @xl:inline">Placeholder animation</span>
            </span>
          )}
          {topRight && <div className={`transition-opacity duration-300 motion-reduce:transition-none ${controls.showing ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>{topRight}</div>}
        </div>
      </div>

      {/* Said only when the wait has gone on a while. The element is always here so a screen reader hears the words when they arrive. */}
      <p
        role="status"
        className={
          slow
            ? "pointer-events-none absolute left-1/2 top-1/2 w-max max-w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/70 px-4 py-2 text-center text-[15px] leading-[1.35] text-white"
            : "sr-only"
        }
      >
        {slow ? "Still loading. A slow connection can take a little longer." : ""}
      </p>

      {/* The caption words being said now, while CC is on (captions.ts). Drawn here rather than by the browser so they
          look the same everywhere: large, white on a dark band that reads over any frame, centred low on the picture,
          well under the clinic's mark, and lifted above the bottom row whenever the controls are up (or, on a phone, out of
          the way of the middle buttons until the controls fade). Takes no taps. Hidden from screen readers, which have the
          narration itself; the CC button says whether captions are on. */}
      {captions?.on && captions.lines.length > 0 && (
        <div
          data-captions=""
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 flex-col items-center gap-0.5 px-3 transition-[bottom] duration-300 ${
            showControls && controls.showing
              ? // Lifted above the bottom row. On a touch screen with a small player (a phone) there is no room between
                // the bottom row and the middle buttons, so there the words step aside until the controls fade again
                // (2.6 seconds after the last touch while playing; while paused nothing is being said).
                "bottom-[92px] hidden computer:flex @3xl:flex"
              : "flex bottom-3 @xl:bottom-5"
          }`}
        >
          {/* One band, the cue's lines joined and wrapped to the picture's width: a caption file's line breaks are made for
              a wide screen, and kept as they are they would wrap again on a phone, into twice as many rows. */}
          <span className="max-w-[min(94%,44rem)] rounded-md bg-black/80 px-2.5 py-0.5 text-center text-[clamp(17px,4.2cqw,34px)] font-medium leading-[1.3] text-white">
            {captions.lines.join(" ")}
          </span>
        </div>
      )}

      {/* Waiting for data, before the "still loading" sentence: a calm spinner, centred on the picture. */}
      {loading && !slow && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner className="h-14 w-14 @xl:h-16 @xl:w-16" />
        </div>
      )}

      {/* The middle, on a screen with no mouse: back 10 seconds, play or pause, forward 10 seconds. */}
      {showControls && !slow && !loading && (
        <div className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-7 transition-opacity duration-300 motion-reduce:transition-none computer:hidden @xl:gap-12 ${fade}`}>
          <Control live={controls.showing} onClick={() => controls.seekBy(-SKIP_SECONDS)} label="Back 10 seconds" size="h-11 w-11 bg-black/45 @xl:h-12 @xl:w-12">
            <SkipBackIcon className="h-6 w-6 @xl:h-7 @xl:w-7" />
          </Control>
          <Control live={controls.showing} onClick={controls.togglePlay} label={playLabel} size="h-13 w-13 bg-black/50 @xl:h-14 @xl:w-14">
            {playIcon("h-7 w-7 @xl:h-8 @xl:w-8")}
          </Control>
          <Control live={controls.showing} onClick={() => controls.seekBy(SKIP_SECONDS)} label="Forward 10 seconds" size="h-11 w-11 bg-black/45 @xl:h-12 @xl:w-12">
            <SkipForwardIcon className="h-6 w-6 @xl:h-7 @xl:w-7" />
          </Control>
        </div>
      )}

      {/* The bottom: play (with a mouse), the time, sound and full screen, then the progress bar. The dark fade behind them
          is only as tall as the row, and takes no taps of its own (only its buttons and the bar do): when an earlier, taller
          fade took taps, it swallowed every tap on Pause and the ten-second buttons on a short player. */}
      {showControls && (
        <div className={`video-scrim pointer-events-none absolute inset-x-0 bottom-0 px-1.5 pt-3 transition-opacity duration-300 motion-reduce:transition-none @xl:px-3 ${fade}`}>
          <div className="flex items-center">
            <span className="hidden computer:flex">
              <Control live={controls.showing} onClick={controls.togglePlay} label={playLabel} size="h-11 w-11">
                {playIcon("h-6 w-6")}
              </Control>
            </span>
            <span className="shrink-0 pl-2 text-[15px] font-medium tabular-nums text-white">
              {formatDuration(controls.time)} <span className="text-[#c9cfd3]">/ {formatDuration(controls.duration)}</span>
            </span>
            {chapter && (
              <span data-current-chapter="" className="min-w-0 truncate pl-2 text-[15px] font-medium text-white">
                <span aria-hidden="true" className="pr-2 text-[#c9cfd3]">·</span>
                {chapter.title}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center">
              {/* CC: only when the playing video has a caption track (a Mux video whose captions Mux has made; never a
                  CDN file). A toggle: its name stays "Captions" and a screen reader hears "on" or "off" from aria-pressed. */}
              {captions?.available && (
                <Control
                  live={controls.showing}
                  // Like sound and full screen: the press also starts the controls' fade over again. On faded controls a key
                  // press only brings them back first (usePlayerControls' onKey), the same as for every other button.
                  onClick={() => {
                    captions.toggle();
                    controls.reveal();
                  }}
                  label="Captions"
                  pressed={captions.on}
                  size="h-11 w-11"
                >
                  <CaptionsIcon on={captions.on} className="h-6 w-6" />
                </Control>
              )}
              <Control live={controls.showing} onClick={controls.toggleMute} label={controls.muted ? "Unmute" : "Mute"} size="h-11 w-11">
                {controls.muted ? <MuteIcon className="h-5 w-5" /> : <VolumeIcon className="h-5 w-5" />}
              </Control>
              <Control live={controls.showing} onClick={controls.toggleFullscreen} label={controls.fullscreen ? "Exit full screen" : "Full screen"} size="h-11 w-11">
                {controls.fullscreen ? <ExitFullscreenIcon className="h-5 w-5" /> : <FullscreenIcon className="h-5 w-5" />}
              </Control>
            </span>
          </div>

          {/* A thin drawn track and thumb, with an invisible range input over it for dragging (taller than it looks, so a finger finds it).
              The input itself cannot be seen, so when the keyboard is on it the whole bar gets the player's focus ring. */}
          <div className="relative mx-2.5 flex h-7 items-center rounded-md has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-white has-[input:focus-visible]:shadow-[0_0_0_6px_#12202a]">
            <div className="h-1 w-full rounded-full bg-white/30">
              <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </div>
            {/* Where each chapter starts: a small dark gap across the track, readable on the filled part and the empty part alike. */}
            {marks.map((mark) => (
              <span
                key={mark.startSeconds}
                data-chapter-mark=""
                className="pointer-events-none absolute h-1.5 w-[3px] -translate-x-1/2 bg-black/80"
                style={{ left: `${(mark.startSeconds / controls.duration) * 100}%` }}
              />
            ))}
            <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow" style={{ left: `${pct}%` }} />
            <input
              type="range"
              min={0}
              max={controls.duration || 0}
              step={0.1}
              value={controls.time}
              onChange={(event) => controls.seekTo(Number(event.target.value))}
              aria-label="Seek"
              // Read out as words ("1 minute 5 seconds of 4 minutes 12 seconds"), never a bare number of seconds.
              aria-valuetext={seekValueText(controls.time, controls.duration)}
              className={`${controls.showing ? "pointer-events-auto" : "pointer-events-none"} absolute inset-0 h-full w-full cursor-pointer opacity-0`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A small, calm "loading" ring: a soft dark circle (so it reads over a white
 * frame) with a white arc that turns slowly. For someone whose phone asks
 * for less motion it does not turn: the still arc says the same thing.
 * Hidden from screen readers; the player says "Loading" in words instead.
 */
export function Spinner({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  // "light": white on a soft dark circle, over the picture. "dark": the Pulse ink with no circle, inside the white Play button.
  const ink = tone === "light" ? "white" : "#12333f";
  return (
    <span data-spinner="" aria-hidden="true" className={`flex items-center justify-center rounded-full ${tone === "light" ? "bg-black/45" : ""} ${className}`}>
      <svg viewBox="0 0 24 24" className={`${tone === "light" ? "h-1/2 w-1/2" : "h-full w-full"} motion-safe:animate-spin [animation-duration:1.1s]`} fill="none">
        <circle cx="12" cy="12" r="9.5" stroke={ink} strokeOpacity=".25" strokeWidth="2.5" />
        <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * One of the player's round buttons: a white icon with a soft shadow, and a
 * soft circle under the finger or the mouse. `live` is false while the
 * controls are faded away: the button then takes no taps, so a tap where it
 * was only brings the controls back.
 */
function Control({
  live,
  onClick,
  label,
  size,
  pressed,
  children,
}: {
  live: boolean;
  onClick: () => void;
  label: string;
  size: string;
  /** For a button that is on or off (CC): said by a screen reader as "pressed" or not. */
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={pressed === undefined ? label : `${label} ${pressed ? "on" : "off"}`}
      className={`${live ? "pointer-events-auto" : "pointer-events-none"} flex shrink-0 items-center justify-center rounded-full text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.6)] transition hover:bg-white/15 active:bg-white/25 ${PLAYER_FOCUS} ${size}`}
    >
      {children}
    </button>
  );
}
