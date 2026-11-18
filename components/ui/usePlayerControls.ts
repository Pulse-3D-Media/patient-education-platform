"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { flipMuted, playOrPause, seekVideo, toggleFullscreen } from "./player-element";
import { HIDE_AFTER_MS, SKIP_SECONDS, keyFirstPressWhileHidden, pictureTapAction } from "./player-rules";

/**
 * The machinery behind both players' controls (the patient's, WatchPlayer,
 * and the library's, VideoPlayer), so they behave exactly alike. What they
 * look like is PlayerOverlay.
 *
 * It listens to the <video> element itself (play, pause, the end, time,
 * length, sound) rather than being told by the player, so each player keeps
 * its own handlers for what only it does (counting a play start, moving a
 * link's deadline, "still loading").
 *
 * SHOWING AND HIDING. The controls, and the clinic's logo, the title and the
 * doctor's name with them, are up whenever the video is paused or has not
 * started. While it plays they fade away HIDE_AFTER_MS after the last touch
 * or mouse movement, and at once when the mouse leaves the player; any touch
 * or movement brings them back (Vimeo's behaviour, agreed at the 2026-10-15
 * huddle). The keyboard is treated the same way (Evan, 2026-11-17: "make the
 * controls fade while it plays"): any key press, or the keyboard's focus
 * moving onto the player or one of its buttons, brings them back and starts
 * the count again. When they have faded, the first key press only brings them
 * back, as the first tap on a faded picture does on a phone; the next press
 * acts (keyFirstPressWhileHidden in player-rules.ts). They never fade while
 * the video is paused, finished, waiting for data, or has failed. Fading is
 * only drawn: the buttons stay in the page for a screen reader, which presses
 * them without a key, so its presses act at once, as before.
 *
 * FULL SCREEN puts `box` (the whole player, the clinic's mark and our
 * controls with it) full screen wherever the browser can do that for part
 * of a page (Chrome, Edge, Android, Safari on a Mac and an iPad, with the
 * older "webkit" names). An iPhone cannot: there it hands the video to the
 * phone's own player, which shows the video alone (accepted, not fought).
 */
export function usePlayerControls({
  video,
  box,
  enabled,
  onPlayFailure,
}: {
  video: RefObject<HTMLVideoElement | null>;
  /** What goes full screen: the whole player. */
  box: RefObject<HTMLElement | null>;
  /** False before the first play on the patient page, and while the video has failed or access has ended: the buttons and keys do nothing. */
  enabled: boolean;
  /** A play refused for good (the file cannot be played at all, see lib/playback.ts): the player shows its calm "did not load" panel. */
  onPlayFailure: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  /** The video played to its end: the play button starts it again. */
  const [finished, setFinished] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  /** The video is out of data and waiting for more (just after Play, or buffering): the controls stay up until frames show. */
  const waiting = useRef(false);
  /** The video could not be played: the controls stay up (the player shows its own calm panel). */
  const broken = useRef(false);

  /** May the controls fade right now? Only while the video is actually playing. */
  const mayFade = () => Boolean(video.current && !video.current.paused && !video.current.ended && !waiting.current && !broken.current);

  /** Show the controls, then hide them again after a pause if the video is still playing. */
  const reveal = () => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (mayFade()) setVisible(false);
    }, HIDE_AFTER_MS);
  };

  /** Hide the controls now, if the video is playing (a paused video keeps them up). */
  const hide = () => {
    window.clearTimeout(hideTimer.current);
    if (mayFade()) setVisible(false);
  };

  /**
   * The keyboard's focus came onto the player or one of its buttons (React's onFocus hears it from anything inside):
   * bring the controls back and start the count again. Only focus the browser would draw a ring for (the keyboard, or
   * a screen reader moving the focus); a finger's tap is already handled as a tap.
   */
  const onFocusIn = (event: React.FocusEvent) => {
    if (isKeyboardFocus(event.target)) reveal();
  };

  /** The video started playing: the controls show, then fade (an effect event, so the listeners below need not be added again on every draw). */
  const onStartedPlaying = useEffectEvent(() => reveal());

  // The element's own news. Read from the element, so nothing has to be passed in by the player.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onPlay = () => {
      setPlaying(true);
      setFinished(false);
      onStartedPlaying();
    };
    /** Keep the controls up from now (paused, finished, waiting, failed): no fade is counting down. */
    const holdUp = () => {
      window.clearTimeout(hideTimer.current);
      setVisible(true);
    };
    const onPause = () => {
      setPlaying(false);
      holdUp();
    };
    const onEnded = () => {
      setFinished(true);
      holdUp();
    };
    const onWaiting = () => {
      waiting.current = true;
      holdUp();
    };
    // Frames are showing again: fade as usual from now.
    const onFramesBack = () => {
      const wasHeldUp = waiting.current || broken.current;
      waiting.current = false;
      broken.current = false;
      if (wasHeldUp) onStartedPlaying();
    };
    const onError = () => {
      broken.current = true;
      holdUp();
    };
    const onTime = () => setTime(v.currentTime);
    const onLength = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    };
    const onVolume = () => setMuted(v.muted);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onFramesBack);
    v.addEventListener("error", onError);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onLength);
    v.addEventListener("durationchange", onLength);
    v.addEventListener("volumechange", onVolume);
    // The length may have arrived before anyone was listening; ask once, a frame later.
    const frameId = window.requestAnimationFrame(onLength);
    return () => {
      window.cancelAnimationFrame(frameId);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onFramesBack);
      v.removeEventListener("error", onError);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onLength);
      v.removeEventListener("durationchange", onLength);
      v.removeEventListener("volumechange", onVolume);
    };
  }, [video]);

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

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const togglePlay = () => {
    if (!video.current || !enabled) return;
    playOrPause(video.current, onPlayFailure);
    reveal();
  };

  const seekBy = (seconds: number) => {
    if (!video.current || !enabled) return;
    seekVideo(video.current, video.current.currentTime + seconds);
    reveal();
  };

  const seekTo = (seconds: number) => {
    if (!video.current || !enabled) return;
    seekVideo(video.current, seconds);
    reveal();
  };

  const toggleMute = () => {
    if (!video.current) return;
    setMuted(flipMuted(video.current));
    reveal();
  };

  const fullscreenOnOff = () => {
    toggleFullscreen(box.current, video.current);
    reveal();
  };

  /** A tap or click on the picture itself, not on one of the buttons. See pictureTapAction. */
  const onPictureTap = (event: React.PointerEvent) => {
    if ((event.target as Element).closest("button, input, a, [role=alert]")) return;
    const action = pictureTapAction(event.pointerType, visible, playing);
    if (action === "toggle-play") togglePlay();
    else if (action === "hide") hide();
    else reveal();
  };

  /**
   * Keys on the focused player: space or K plays and pauses, the arrows move ten seconds, M mutes, F is full screen.
   * Any key brings the controls back and starts the count again. If they had faded, that first press does nothing else
   * (it is not passed on to the focused button either), as the first tap on a faded picture only shows them; Tab and
   * the like still move as usual.
   */
  const onKey = (event: React.KeyboardEvent) => {
    const hidden = playing && !visible;
    reveal();
    if (hidden && keyFirstPressWhileHidden(event.key) === "show-only") {
      event.preventDefault();
      return;
    }
    if (!enabled) return;
    if (event.key === " " || event.key === "k") {
      // Space on a focused button already presses that button; only act when the player itself has the focus.
      if (event.key === " " && event.target !== event.currentTarget) return;
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // Ten seconds, from the player or from the progress bar alike (the bar's own step is a tenth of a second, and
      // without this the page would also scroll sideways).
      event.preventDefault();
      seekBy(event.key === "ArrowRight" ? SKIP_SECONDS : -SKIP_SECONDS);
    }
    else if (event.key === "m") toggleMute();
    else if (event.key === "f") fullscreenOnOff();
  };

  return {
    playing,
    finished,
    time,
    duration,
    muted,
    fullscreen,
    /** The controls are up: paused, not started, or touched a moment ago. */
    showing: visible || !playing,
    reveal,
    hide,
    /** For the player's outer box: onFocus. */
    onFocusIn,
    togglePlay,
    seekBy,
    seekTo,
    toggleMute,
    toggleFullscreen: fullscreenOnOff,
    onPictureTap,
    onKey,
  };
}

export type PlayerControls = ReturnType<typeof usePlayerControls>;

/** The browser would draw a focus ring here (:focus-visible). A browser too old to know the question answers no. */
function isKeyboardFocus(target: EventTarget | null): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}
