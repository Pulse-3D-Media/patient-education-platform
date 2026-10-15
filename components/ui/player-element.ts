import { playRefusalIsFailure } from "@/lib/playback";

/**
 * The few things both players' controls do TO the <video> element and the
 * player's box: play and pause, move the time, sound on and off, full
 * screen. Plain functions rather than inside the hook (usePlayerControls),
 * because a React hook may not change an element it was handed (the React
 * Compiler's lint refuses it).
 */

/** Play or pause; at the end, start again. Most refusals mean "not yet" (lib/playback.ts); only one that means "never" calls onFailure. */
export function playOrPause(video: HTMLVideoElement, onFailure: () => void): void {
  if (video.ended) video.currentTime = 0;
  if (video.paused) {
    video.play().catch((error: unknown) => {
      if (playRefusalIsFailure((error as { name?: string } | null)?.name)) onFailure();
    });
  } else {
    video.pause();
  }
}

/** Move the video to this many seconds in, kept between the start and the end. */
export function seekVideo(video: HTMLVideoElement, seconds: number): void {
  const end = Number.isFinite(video.duration) ? video.duration : 0;
  video.currentTime = Math.min(Math.max(0, seconds), end);
}

/** Sound off if it was on, on if it was off. Answers whether it is now off. */
export function flipMuted(video: HTMLVideoElement): boolean {
  video.muted = !video.muted;
  return video.muted;
}

/**
 * Full screen on or off. The whole player box goes, not just the video, so
 * the clinic's mark and the controls come with it, wherever the browser can
 * do that for part of a page (Chrome, Edge, Android, Safari on a Mac and an
 * iPad, with the older "webkit" names). An iPhone cannot: there the video
 * goes to the phone's own player, which shows it alone (accepted).
 */
export function toggleFullscreen(box: HTMLElement | null, video: HTMLVideoElement | null): void {
  const el = box as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
  const v = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
    webkitFullscreenEnabled?: boolean;
  };
  const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
  if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
    try {
      Promise.resolve((doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)).catch(() => {});
    } catch {
      /* Escape still leaves full screen. */
    }
  } else if (el && request && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false)) {
    try {
      Promise.resolve(request.call(el)).catch(() => {});
    } catch {
      /* The browser said no: nothing changes. */
    }
  } else {
    v?.webkitEnterFullscreen?.();
  }
}
