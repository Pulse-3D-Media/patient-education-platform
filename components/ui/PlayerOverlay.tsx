"use client";

import type { ReactNode } from "react";
import { currentChapterIndex, type Chapter } from "@/lib/chapters";
import { formatDuration } from "@/lib/format";
import { ClinicMark } from "./ClinicMark";
import { ExitFullscreenIcon, FullscreenIcon, MuteIcon, PauseIcon, PlayIcon, ReplayIcon, SkipBackIcon, SkipForwardIcon, VolumeIcon } from "./icons";
import { SKIP_SECONDS } from "./player-rules";
import { PLACEHOLDER_CHIP } from "./styles";
import type { PlayerControls } from "./usePlayerControls";

/**
 * What both players lay over the picture, laid out the way Vimeo does it
 * (agreed by Evan and Van at the 2026-10-15 huddle, with a Vimeo screenshot):
 *
 *   - Top left: the clinic's logo in a round frame, the video's title and
 *     the doctor's name (ClinicMark). Top right: the library's Close.
 *   - In the middle, on a phone or a tablet (a screen with no mouse): back
 *     10 seconds, play or pause, forward 10 seconds, each on a soft dark
 *     circle so it reads over a white frame. With a mouse there is nothing
 *     in the middle: the play button is at the bottom left, as on Vimeo.
 *     Which one shows is decided by the browser (the `computer:` variant in
 *     app/globals.css: a mouse or trackpad that can hover), never by its name.
 *   - Along the bottom: the play button (mouse only), the time, sound and
 *     full screen, and a thin progress bar to drag. When the video has
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
  topRight = null,
  chapters = [],
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
  /** One of the player's own buttons for the top right (the library's Close). Fades with the controls. */
  topRight?: ReactNode;
  /** The video's chapters, sorted by time. Empty for none (always, on the patient page). */
  chapters?: Chapter[];
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
      {/* Top: the clinic's mark (left), the player's own button and the placeholder chip (right). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 @xl:p-4">
        <div className={`min-w-0 transition-opacity duration-300 ${fade}`}>
          <ClinicMark logoUrl={logoUrl} name={clinicName} title={title} senderName={senderName} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {placeholder && <span className={PLACEHOLDER_CHIP}>Placeholder animation</span>}
          {topRight && <div className={`transition-opacity duration-300 ${controls.showing ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>{topRight}</div>}
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

      {/* The middle, on a screen with no mouse: back 10 seconds, play or pause, forward 10 seconds. */}
      {showControls && !slow && (
        <div className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-5 transition-opacity duration-300 computer:hidden @xl:gap-10 ${fade}`}>
          <Control live={controls.showing} onClick={() => controls.seekBy(-SKIP_SECONDS)} label="Back 10 seconds" size="h-12 w-12 bg-black/40 @xl:h-14 @xl:w-14">
            <SkipBackIcon className="h-7 w-7 @xl:h-8 @xl:w-8" />
          </Control>
          <Control live={controls.showing} onClick={controls.togglePlay} label={playLabel} size="h-14 w-14 bg-black/50 @xl:h-16 @xl:w-16">
            {playIcon("h-7 w-7 @xl:h-8 @xl:w-8")}
          </Control>
          <Control live={controls.showing} onClick={() => controls.seekBy(SKIP_SECONDS)} label="Forward 10 seconds" size="h-12 w-12 bg-black/40 @xl:h-14 @xl:w-14">
            <SkipForwardIcon className="h-7 w-7 @xl:h-8 @xl:w-8" />
          </Control>
        </div>
      )}

      {/* The bottom: play (with a mouse), the time, sound and full screen, then the progress bar. The dark fade behind them
          takes no taps of its own (only its buttons and the bar do): on a short player, a phone's or a tablet's, it reaches
          up over the middle buttons, and when it took taps it swallowed every tap on Pause and the ten-second buttons. */}
      {showControls && (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-10 transition-opacity duration-300 @xl:px-3 ${fade}`}>
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
              <Control live={controls.showing} onClick={controls.toggleMute} label={controls.muted ? "Unmute" : "Mute"} size="h-11 w-11">
                {controls.muted ? <MuteIcon className="h-5 w-5" /> : <VolumeIcon className="h-5 w-5" />}
              </Control>
              <Control live={controls.showing} onClick={controls.toggleFullscreen} label={controls.fullscreen ? "Exit full screen" : "Full screen"} size="h-11 w-11">
                {controls.fullscreen ? <ExitFullscreenIcon className="h-5 w-5" /> : <FullscreenIcon className="h-5 w-5" />}
              </Control>
            </span>
          </div>

          {/* A thin drawn track and thumb, with an invisible range input over it for dragging (taller than it looks, so a finger finds it). */}
          <div className="relative mx-2 flex h-7 items-center">
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
              className={`${controls.showing ? "pointer-events-auto" : "pointer-events-none"} absolute inset-0 h-full w-full cursor-pointer opacity-0`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One of the player's round buttons: a white icon with a soft shadow, and a
 * soft circle under the finger or the mouse. `live` is false while the
 * controls are faded away: the button then takes no taps, so a tap where it
 * was only brings the controls back.
 */
function Control({ live, onClick, label, size, children }: { live: boolean; onClick: () => void; label: string; size: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${live ? "pointer-events-auto" : "pointer-events-none"} flex shrink-0 items-center justify-center rounded-full text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.6)] transition hover:bg-white/15 active:bg-white/25 ${size}`}
    >
      {children}
    </button>
  );
}
