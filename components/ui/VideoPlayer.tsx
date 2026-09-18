"use client";

import { useEffect, useRef, useState } from "react";
import { ClinicMark } from "./ClinicMark";
import { CloseIcon, FullscreenIcon } from "./icons";
import { PLACEHOLDER_CHIP, PRIMARY_BUTTON } from "./styles";
import { playRefusalIsFailure, resumePoint, SLOW_AFTER_MS } from "@/lib/playback";

/**
 * The library's full-screen procedure player.
 *
 * It uses the BROWSER'S OWN video controls (play, seek, sound, captions
 * when the file has them). Until the branding work it drew its own; the
 * browser's were chosen because they are the most dependable on a tablet,
 * a screen reader already knows them, and a captions button comes with them
 * the day a video gets captions.
 *
 * Nothing is ever laid over the picture. The Close button, the title, the
 * "Placeholder animation" chip and the clinic's mark each sit in a row of
 * their own above it, because an anatomy label can be anywhere in a frame.
 *
 * Playback starts as soon as the player opens (autoPlay), which is inside
 * the tap that opened it, so sound is allowed. There is no Download entry
 * in the browser's menu (controlsList). That is tidiness, not protection.
 *
 * WHEN THE VIDEO WILL NOT LOAD: a calm panel with Try again, which reloads
 * the file and carries on from where it stopped. The check one frame after
 * opening catches a file that failed before this component was listening.
 *
 * The square button asks the browser to put the whole player full screen,
 * where the browser can; where it cannot, the player already fills the
 * screen, so nothing is lost.
 *
 * One honest limit (measured in Chrome and Edge): while the keyboard's
 * focus is inside the browser's controls, after a click on the timeline
 * say, the browser keeps key presses to itself and the library never hears
 * Escape. The Close button always works, and Tab reaches it.
 */
export function VideoPlayer({ src, title, subtitle, placeholder, poster, clinicName, logoUrl = null, onClose }: {
  src: string; title: string; subtitle?: string; placeholder?: boolean; poster?: string;
  clinicName?: string; logoUrl?: string | null; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const resumeAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => { if (video.current?.error) setFailed(true); });
    return () => { cancelAnimationFrame(id); clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (failed) retryButton.current?.focus({ preventScroll: true });
  }, [failed]);
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  function ready() { clearTimeout(timer.current); setSlow(false); }
  function fail() {
    const point = resumePoint(video.current?.currentTime);
    if (point) resumeAt.current = point;
    ready();
    setFailed(true);
  }
  function retry() {
    const element = video.current;
    if (!element) return;
    setFailed(false);
    element.load();
    element.play().catch((error: unknown) => {
      if (playRefusalIsFailure((error as { name?: string })?.name)) fail();
    });
    requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled && box.current?.requestFullscreen) await box.current.requestFullscreen();
      // Already in the accessible expanded overlay if fullscreen is unavailable.
    } catch { /* A denied request leaves the expanded player usable. */ }
  }

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-black text-white">
      <header className="flex shrink-0 items-center gap-3 px-4 py-2">
        <button type="button" onClick={onClose} aria-label="Close video and return to the library"
          className="flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 focus-visible:outline-2 focus-visible:outline-white">
          <CloseIcon className="h-5 w-5" />Close
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-[15px] text-[#bfbfbf]">{subtitle}</p>}
        </div>
        <button type="button" onClick={fullscreen} aria-label={full ? "Exit fullscreen" : "Request fullscreen if supported"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
          <FullscreenIcon className="h-6 w-6" />
        </button>
      </header>
      <div className="relative flex min-h-10 shrink-0 items-center px-4">
        {placeholder && <span className={PLACEHOLDER_CHIP}>Placeholder animation</span>}
        {clinicName && <ClinicMark logoUrl={logoUrl} name={clinicName} size="patient" className="right-4 top-1" />}
      </div>
      <div className="relative min-h-48 flex-1">
        <video ref={video} src={src} poster={poster} autoPlay playsInline controls={!failed} controlsList="nodownload"
          aria-label={title} aria-hidden={failed || undefined} tabIndex={failed ? -1 : 0}
          className={`absolute inset-0 h-full w-full object-contain ${failed ? "invisible" : ""}`}
          onError={fail} onPlaying={ready} onCanPlay={ready}
          onWaiting={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS); }}
          onLoadedMetadata={(event) => {
            if (resumeAt.current) {
              event.currentTarget.currentTime = Math.min(resumeAt.current, event.currentTarget.duration || resumeAt.current);
              resumeAt.current = 0;
            }
          }} />
        {failed && <div role="alert" className="relative flex min-h-48 flex-col items-center justify-center gap-4 bg-black p-6 text-center">
          <p className="text-xl">This video did not load.</p>
          <p className="text-base text-[#bfbfbf]">Check your connection, then try again.</p>
          <button ref={retryButton} type="button" onClick={retry} className={`${PRIMARY_BUTTON} min-h-12`}>Try again</button>
        </div>}
      </div>
      <p role="status" className={slow && !failed ? "shrink-0 px-4 py-2 text-base" : "sr-only"}>
        {slow && !failed ? "Still loading. A slow connection can take a little longer." : ""}
      </p>
    </div>
  );
}
