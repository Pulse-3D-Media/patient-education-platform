"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClinicMark, OnPicture, pictureRatio } from "@/components/ui/ClinicMark";
import { useModalFocus } from "@/components/ui/useModalFocus";
import { CloseIcon, FullscreenIcon, PhoneIcon, PlayIcon } from "@/components/ui/icons";
import { SLOW_AFTER_MS, playRefusalIsFailure, resumePoint } from "@/lib/playback";
import { recordPlay } from "./actions";
import { CallNumber } from "./CallButton";

/**
 * The patient's player: the video with one big Play button over it.
 *
 * Before the first tap, the Play button is the only thing on screen (the
 * rules file: nothing to click except play). After it, the browser's own
 * controls take over, because those are the controls a patient already knows
 * from every other video on their phone, and the ones their screen reader
 * and their captions setting already work with. They are never hidden or
 * replaced.
 *
 * The button is a dark triangle on a white circle, with "Tap to play" on a
 * white pill under it. That is deliberate: the first frame of the animation
 * is a near-white title card, and white text over a light frame is close to
 * invisible (about 2:1). Dark on white reads over any frame, light or dark.
 *
 * Client component because the tap itself has to start playback (browsers
 * only allow sound when the person has just tapped), and because the first
 * real play is what counts as a play start.
 *
 * What counts as a play start, and why it is tied to the `playing` event:
 * the browser fires `play` the moment play is asked for, and `playing` only
 * once frames are actually being shown. Loading the page, a text message
 * previewing it, the poster or the first bytes being fetched (preload), and
 * pausing and resuming fire neither one in a way that reaches the server:
 * the count is sent once per page load, the first time `playing` fires, and
 * never again on that page (`counted`), whatever happens after. That one
 * call is also what may move a first-play link's deadline, so nothing but
 * real playback can start the clock. Trying again after a failure does not
 * count twice.
 *
 * WHEN THE VIDEO WILL NOT LOAD. A missing file, a blocked one, or a
 * connection that drops part-way: the picture is replaced by a calm panel
 * with one sentence, a Try again button, and the clinic's number to call
 * when there is one. Try again reloads the file and picks up where it
 * stopped. Nothing technical reaches the patient, and nothing about the
 * failure is sent anywhere. A video that is only slow gets a quiet "still
 * loading" note over the picture instead, so a tap never looks ignored.
 *
 * THE STRIP ON THE VIDEO. A thin dark band across the top edge of the
 * picture carries the clinic's logo (or name) and the doctor's name, "Dr.
 * Jane Smith, DO" (ClinicMark). It is there the whole time: before the first play, while
 * playing, in the large view (both kinds), and as a row of its own above the
 * "did not load" panel, where there is no picture to lay it over. It never
 * takes a tap, and the browser's own controls sit along the BOTTOM of the
 * picture in Chrome, Edge and Android, so it covers none of them there. It
 * is branding, not protection: see ClinicMark.
 *
 * MAKING IT BIGGER. After play starts, a "Make the video bigger" button
 * appears under the video. What it does depends on what the browser can do,
 * checked at the moment of the tap rather than guessed from the device:
 *
 *   - Where the browser can put an element of the page full screen, the
 *     whole player goes full screen (not just the video), so the Close
 *     button and the strip come with it.
 *   - Where it cannot (iPhone Safari is the usual case, but the code asks
 *     the browser, it does not look for iPhones), or where the browser says
 *     no, the player expands over the page instead: fixed to the edges of
 *     the screen, inside the phone's safe areas, with the page behind it
 *     held still.
 *
 * Either way: a labelled Close button at the top, Escape closes it, the
 * video keeps playing through the change (it is the same <video>, never
 * re-created, and always playsInline), focus goes to Close on the way in
 * and back to the button on the way out, and the page is scrolled back to
 * where it was. Nothing locks the screen's rotation; turning the phone just
 * re-fits the picture, and nobody has to turn it to watch.
 *
 * One honest limit on Escape (measured in Chrome and Edge): while the
 * keyboard's focus is INSIDE the browser's own video controls (on the
 * timeline, say), the browser keeps every key press to itself and the page
 * never hears Escape. Tab still reaches Close from there, and Escape works
 * from Close and from the video itself. Keeping the browser's controls is
 * worth that; see the top of this note.
 *
 * THE BROWSER'S OWN FULL-SCREEN BUTTON hands the video to the browser's own
 * player, which shows the video alone: no strip, no Close. So where it can
 * be stopped reliably, it is: with `controlsList="nofullscreen"`, Chrome,
 * Edge and Android Chrome (all Chromium) draw that button greyed out and it
 * does nothing, and a double-click on the picture no longer goes full screen
 * either (measured in Edge, October 2026). The "Make the video bigger"
 * button below, which keeps the strip, is the way to go big there. Whether
 * turning an Android phone sideways still goes full screen by itself is a
 * phone check still owed. Nothing can hide that button in Safari (iPhone, iPad, Mac)
 * or Firefox; there, full screen from the browser's own button still shows
 * the video without the strip, and that is the browser's to decide.
 * Picture-in-picture is left as it is (it too shows the video alone).
 */
export function WatchPlayer({
  src,
  title,
  code,
  clinicName,
  logoUrl,
  senderName,
  call,
}: {
  src: string;
  title: string;
  code: string;
  clinicName: string;
  /** The clinic's logo for the strip on the picture, or null to use its name. */
  logoUrl: string | null;
  /** Who sent the link, as patients see it ("Dr. Jane Smith, DO"), for the strip. Null for a link with no sender recorded. */
  senderName: string | null;
  /** The clinic's phone as a tap-to-call link, when it has a valid one. Offered only if the video will not load. */
  call: { href: string; label: string } | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const biggerButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const counted = useRef(false);
  const slowTimer = useRef<number | undefined>(undefined);
  /** Where to pick up after Try again, and the page's scroll position to put back after the big view closes. */
  const resumeAt = useRef(0);
  const scrollBack = useRef(0);

  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  /** The video's shape, width over height, once the file says; 16:9 until then. Places the strip on the picture's top edge. */
  const [ratio, setRatio] = useState(() => pictureRatio(undefined, undefined));
  /** "fullscreen": the browser's element full screen. "overlay": our own expanded view, where that is not available. */
  const [big, setBig] = useState<"no" | "fullscreen" | "overlay">("no");
  useModalFocus(frame, big === "overlay");
  useEffect(() => {
    if (failed) retryButton.current?.focus({ preventScroll: true });
  }, [failed]);

  const clearSlow = useCallback(() => {
    window.clearTimeout(slowTimer.current);
    setSlow(false);
  }, []);

  useEffect(() => () => window.clearTimeout(slowTimer.current), []);

  // A file that is missing or blocked can fail within a fraction of a second,
  // BEFORE this component is live in the browser and listening: the server
  // sent the <video> in the page's HTML, and the browser started fetching it
  // at once. The "error" event has then already come and gone, and onError
  // below never hears it (measured: the event at about 0.3s, React attached
  // after it). The element remembers, though, so it is asked once, a frame
  // after the page comes alive.
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (video.current?.error) setFailed(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  function play() {
    video.current?.play().catch((error: unknown) => {
      // Most refusals mean "not yet" and the Play button simply stays (see
      // lib/playback.ts). Only a video that cannot be played at all is a failure.
      if (playRefusalIsFailure((error as { name?: string } | null)?.name)) fail();
    });
  }

  /** The video cannot be played right now. Remember where it was, and show the calm panel. */
  function fail() {
    // Keep the furthest point reached: a second failure, straight after Try again, reports 0 and must not wipe it.
    const point = resumePoint(video.current?.currentTime);
    if (point > 0) resumeAt.current = point;
    clearSlow();
    setFailed(true);
  }

  /** Try again: fetch the file afresh and carry on from where it stopped. Inside the tap, so sound is still allowed. */
  function retry() {
    const element = video.current;
    if (!element) return;
    setFailed(false);
    element.load();
    play();
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }

  /** Play was asked for: hand the patient the browser's own controls. */
  function onPlay() {
    setStarted(true);
    // The Play button is about to disappear. If it had the keyboard's focus, that focus would be dropped on the
    // floor; put it on the video instead, so the next key press (space to pause, the arrows to seek) reaches the
    // browser's controls. A tap on a phone shows no focus ring, so nothing changes for touch.
    if (document.activeElement === document.body || frame.current?.contains(document.activeElement)) {
      video.current?.focus({ preventScroll: true });
    }
  }

  /** Frames are actually showing: count the play start, once per page load. */
  function onPlaying() {
    clearSlow();
    if (counted.current) return;
    counted.current = true;
    // Recorded in the background, one attempt. If it does not get through,
    // the video still plays; the play is just not counted (see actions.ts).
    recordPlay(code).catch(() => {});
  }

  /** The video has run out of data and is waiting for more. Say so only if it goes on for a while. */
  function onWaiting() {
    window.clearTimeout(slowTimer.current);
    slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
  }

  /** The file's size is known: note its shape for the strip. After Try again, go back to where the video stopped. */
  function onLoadedMetadata() {
    const element = video.current;
    if (element) setRatio(pictureRatio(element.videoWidth, element.videoHeight));
    if (element && resumeAt.current > 0) {
      element.currentTime = Math.min(resumeAt.current, element.duration || resumeAt.current);
      resumeAt.current = 0;
    }
  }

  // ---- Making it bigger ---------------------------------------------------

  function makeBigger() {
    const element = frame.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    if (!element) return;
    scrollBack.current = window.scrollY;

    // Ask the browser what it can do, now, rather than guessing from the device.
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
    const allowed = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false;
    if (!request || !allowed) {
      setBig("overlay");
      return;
    }
    try {
      // Older Safari returns nothing here; everything else returns a promise that fails if the browser says no.
      Promise.resolve(request.call(element)).catch(() => setBig("overlay"));
    } catch {
      setBig("overlay");
    }
  }

  function makeSmaller() {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      // The "fullscreenchange" listener below does the rest once the browser has left full screen.
      try {
        Promise.resolve((doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)).catch(() => {});
      } catch { /* Native controls and Escape remain available. */ }
    } else {
      setBig("no");
    }
  }

  // The browser tells us when full screen starts and ends (the patient may
  // leave it with Escape or a swipe, not our button).
  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const current = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setBig((was) => (current && current === frame.current ? "fullscreen" : was === "fullscreen" ? "no" : was));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Going big: move focus to Close. Coming back: return focus to the button
  // that opened it, and put the page back where it was scrolled to.
  const wasBig = useRef(false);
  useEffect(() => {
    if (big !== "no") {
      wasBig.current = true;
      closeButton.current?.focus({ preventScroll: true });
    } else if (wasBig.current) {
      wasBig.current = false;
      window.scrollTo(0, scrollBack.current);
      (biggerButton.current ?? retryButton.current)?.focus({ preventScroll: true });
    }
  }, [big]);

  // Our own expanded view: hold the page behind it still, and let Escape close it.
  // (In the browser's full screen, Escape is the browser's, and it already works.)
  useEffect(() => {
    if (big !== "overlay") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBig("no");
    };
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [big]);

  /** While our expanded view is open, focus stays inside it: tabbing past the end comes back to Close. */
  function keepFocusInside(event: React.FocusEvent) {
    if (big !== "overlay") return;
    const next = event.relatedTarget as Node | null;
    if (next && !frame.current?.contains(next)) closeButton.current?.focus();
  }

  const isBig = big !== "no";

  return (
    <div>
      {/* This outer box keeps the video's place on the page while the player itself is expanded, so nothing below it jumps.
          It is a grid, and never shorter than what it holds (min-h-fit), so that in the one case where the player sits
          inside it rather than over it (the failure panel, below) the box grows to fit instead of squeezing or cutting
          off what is in it. On a wide screen, where the video's box is already taller than the panel, it stays as it is. */}
      <div className="relative grid min-h-fit w-full" style={failed ? undefined : { paddingTop: "56.25%" }}>
        <div
          ref={frame}
          tabIndex={-1}
          onBlur={keepFocusInside}
          role={big === "overlay" ? "dialog" : undefined}
          aria-modal={big === "overlay" ? true : undefined}
          aria-label={big === "overlay" ? `${title}, from ${clinicName}, large view` : undefined}
          className={
            isBig
              ? // Fixed to the edges of the screen (no viewport units, so the browser's bars sliding in and out just re-fit it), inside the phone's safe areas.
                "fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
              : failed
                ? // The failure panel holds a sentence, a button and a phone link. On a phone the video's box is only
                  // about 190px tall, too short for all of that at full size, and squeezing it shrank "Try again" to
                  // 26px (measured). So here the player takes its place IN the page and is as tall as it needs to be.
                  // The text under it moves down a little; nothing is playing, so nothing is lost. Nothing is
                  // clipped here either (no overflow-hidden): if a browser ever failed to grow the box, the phone
                  // link would hang below it rather than be cut off.
                  "relative flex min-w-0 flex-col rounded-[18px] bg-[#12202a] shadow-[0_10px_30px_-14px_rgba(18,32,42,.4)]"
                : // Rounded at every size: a phone is the only screen this page is used on.
                  "absolute inset-0 flex flex-col overflow-hidden rounded-[18px] bg-black shadow-[0_10px_30px_-14px_rgba(18,32,42,.4)]"
          }
        >
          {/* The bar across the top of the big view, with Close. It sits above the picture, not over it, so the strip on the picture never covers it. */}
          {isBig && (
            <div className="flex h-16 shrink-0 items-center gap-3 px-3">
              <button
                ref={closeButton}
                type="button"
                onClick={makeSmaller}
                aria-label="Close the large view and go back to the page"
                className="flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[17px] font-semibold text-[#12333f] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <CloseIcon className="h-5 w-5" />
                Close
              </button>
            </div>
          )}

          {/* No picture to lay it over while the video will not load: the strip is a row of its own above the panel (its top corners rounded like the panel's when the player is in the page). */}
          {failed && (
            <div className={isBig ? "" : "overflow-hidden rounded-t-[18px]"}>
              <ClinicMark logoUrl={logoUrl} name={clinicName} senderName={senderName} inFlow />
            </div>
          )}

          <div className={`relative flex flex-1 flex-col ${isBig ? "min-h-32" : "min-h-0"}`}>
            <video
              ref={video}
              src={src}
              preload="auto"
              playsInline
              // The browser's controls arrive with the first play, as they always have here: before it, the big
              // Play button is the only thing on the picture, and a control bar showing through under "Tap to play"
              // would be a second, smaller play button to aim at.
              controls={started && !failed}
              tabIndex={started && !failed ? 0 : -1}
              // nofullscreen: Chromium's own full-screen button would show the video without the strip. See the note at the top.
              controlsList="nodownload nofullscreen"
              onPlay={onPlay}
              onPlaying={onPlaying}
              onWaiting={onWaiting}
              onCanPlay={clearSlow}
              onLoadedMetadata={onLoadedMetadata}
              onError={fail}
              aria-label={title}
              // When it has failed, the panel below says so in our words. Without this a screen reader also reads
              // the browser's own "Unable to play media" from the video underneath, the same news twice.
              aria-hidden={failed || undefined}
              className={`absolute inset-0 h-full w-full object-contain ${failed ? "invisible" : ""}`}
            />

            {/* What is laid over the picture itself, from before the first play on: the strip on its top edge, and, only while
                the picture is stuck, a "still loading" note just under the strip. Neither takes a tap. */}
            {!failed && (
              <OnPicture ratio={ratio}>
                <ClinicMark logoUrl={logoUrl} name={clinicName} senderName={senderName} />
                {/* Said only when the wait has gone on a while, so a tap on a weak signal never looks ignored. The element is always here (while there is a picture) so a screen reader hears the words when they arrive; the "did not load" panel announces itself. */}
                <p
                  role="status"
                  className={
                    slow
                      ? "absolute left-3 top-11 max-w-[80%] rounded-xl bg-white/90 px-3 py-1.5 text-[15px] leading-[1.35] font-medium text-[#12333f]"
                      : "sr-only"
                  }
                >
                  {slow ? "Still loading. A slow connection can take a little longer." : ""}
                </p>
              </OnPicture>
            )}

            {!started && !failed && (
              // The keyboard focus ring is drawn just inside the edge, because the
              // rounded box clips anything drawn outside it.
              <button
                type="button"
                onClick={play}
                aria-label={`Play ${title}`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[18px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-4px] focus-visible:outline-[#1e5668]"
              >
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-[#12333f] shadow-[0_10px_34px_rgba(0,0,0,.4)] transition active:scale-95">
                  <PlayIcon className="ml-1 h-10 w-10" />
                </span>
                <span className="rounded-full bg-white px-4 py-2 text-[17px] font-semibold text-[#12333f] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
                  Tap to play
                </span>
              </button>
            )}

            {failed && (
              // Calm, like the expired page: no red, and never the word "error". Announced to a screen reader when it appears.
              // It is part of the page's flow (not laid over the video's box), so it is as tall as its words and buttons
              // need, and "shrink-0" on the two controls means they keep their full 48px whatever else happens.
              <div role="alert" className="relative flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] bg-[#12202a] px-5 py-6 text-center">
                <p className="text-[20px] leading-[1.35] font-semibold text-white">The video did not load.</p>
                <p className="max-w-[30ch] text-[16px] leading-[1.45] text-[#d5dde2]">Check your connection, then try again.</p>
                <button
                  ref={retryButton}
                  type="button"
                  onClick={retry}
                  className="mt-1 flex h-12 shrink-0 items-center rounded-full bg-white px-7 text-[17px] font-semibold text-[#12333f] transition active:scale-95 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Try again
                </button>
                {/* A tap-to-call link on a phone; on a computer, where it would do nothing useful, the number as plain words (see CallButton). */}
                {call && (
                  <>
                    <a
                      href={call.href}
                      className="flex min-h-12 shrink-0 items-center gap-2 rounded-full px-4 text-[16px] font-medium text-white underline underline-offset-4 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-white computer:hidden"
                    >
                      <PhoneIcon className="h-5 w-5 shrink-0" />
                      Still stuck? Call {call.label}
                    </a>
                    <CallNumber call={call} className="min-h-12 shrink-0 px-4 text-[16px] text-white" />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Offered once the video is playing, so that before the first tap there is still nothing to press but Play. Its space is kept from the start, so nothing under the video moves when it appears. */}
      <div className="mt-3 min-h-12">
        {started && !failed && (
          <button
            ref={biggerButton}
            type="button"
            onClick={makeBigger}
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border-2 border-[#c9c3b6] bg-white px-5 text-[17px] font-semibold text-[#12333f] transition active:scale-[0.99] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1e5668] sm:w-auto"
          >
            <FullscreenIcon className="h-5 w-5 shrink-0" />
            Make the video bigger
          </button>
        )}
      </div>
    </div>
  );
}
