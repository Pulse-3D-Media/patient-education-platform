"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ClinicMark } from "@/components/ui/ClinicMark";
import { useVideoSource } from "@/components/ui/useVideoSource";
import { PhoneIcon, PlayIcon } from "@/components/ui/icons";
import { DISCLAIMER } from "@/lib/education-note";
import { SLOW_AFTER_MS, playRefusalIsFailure, resumePoint } from "@/lib/playback";
import type { PlaybackSource } from "@/lib/playback-source";
import { issueLink, newVisitKey } from "@/app/q/[code]/issue-link";
import { acceptDisclaimer } from "../accept-disclaimer";
import { recordPlay, refreshPlayback } from "./actions";
import { CallNumber } from "./CallButton";

/**
 * The patient's player: the "for education only" box, then the video with
 * one big Play button over it.
 *
 * THE BOX COMES FIRST (decided by Evan and Van on 2026-10-08). Above the
 * video, unticked: "I understand this video is for education only..."
 * (DISCLAIMER in lib/education-note.ts). Until it is ticked the video is
 * frozen: the page's HTML carries no playable address at all, only a still,
 * and Play is drawn dimmed with "Tick the box above to play" on it (a tap on
 * it moves to the box instead). Ticking it posts to the page's accept route
 * (acceptDisclaimer: /watch/<code>/accept, which records the tick on the
 * link, or /q/<code>/accept on a printed code, which records nothing yet),
 * and the answer is the video. The player starts loading it at once, while
 * the patient's thumb moves from the box to Play, so the Play tap starts it
 * straight away, inside the tap, which is the only moment an iPhone allows
 * sound. While the answer is on its way Play says "Getting the video ready".
 * Ticking NEVER starts the video by itself: only the Play tap does.
 *
 * ONCE TICKED, THE BOX GOES AWAY (Evan, 2026-10-10): it folds up over a
 * quarter of a second (at once for someone whose phone asks for less
 * motion), so the eye can follow the video moving up into its place, and the
 * keyboard's focus moves to Play, which turns from dimmed to ready as soon as
 * the video has arrived. It cannot be unticked: once ticked, the decision is
 * made for this page load. A reload brings the box back, unticked.
 *
 *   - Slow or failed: the ask is tried again by itself (see
 *     accept-disclaimer.ts); if nothing gets through, a calm line where the
 *     box was says so with a Try again button, and nothing else changes.
 *     Never an error page.
 *   - The link stopped working since the page was drawn (it ran out, paused,
 *     was taken down): the page is loaded again, and the server shows the
 *     right calm page (the paused one has Ask my clinic). On a printed code,
 *     the calm "not available" panel.
 *   - One request per page load: the box is gone once ticked, so it cannot
 *     be ticked twice; only Try again asks again, and only when no answer
 *     got through.
 *
 * Nothing about the tick is kept in the browser (no cookie, no storage): a
 * reload shows the box unticked again, and a tick there is a new record.
 *
 * Before the first tap on Play, the box and Play are the only things to press
 * (the rules file: nothing to click but play, and since October 2026 the box
 * before it). After it, the browser's own
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
 * THE STRIP ON THE VIDEO. A slim black row ABOVE the picture carries the
 * clinic's logo (or name) and the doctor's name, "Dr. Jane Smith, DO"
 * (ClinicMark; option C, Evan, 2026-10-15). It is there the whole time,
 * before the first play, while playing and above the "did not load" panel,
 * and nothing of ours is drawn over the picture once the video is playing,
 * so it never covers the browser's own buttons (Safari puts some in the
 * picture's top corners). It is branding, not protection.
 *
 * FULL SCREEN IS THE BROWSER'S OWN (Evan, 2026-10-15: our own full-screen
 * button, and the "Make the video bigger" button before it, looked like
 * workarounds; the buttons should be the ones every phone already shows).
 * The browser's full-screen button in its controls, a double-click on a
 * computer, or Android turning full screen when the phone is turned
 * sideways: all of them hand the video to the browser's own player, which
 * shows the video ALONE, without the strip, on every device. That is
 * accepted (it was always so on an iPhone). The video keeps playing
 * through the change, and coming back out leaves it where it was.
 * Picture-in-picture is left as it is (it too shows the video alone).
 *
 * WHAT IT PLAYS is a PlaybackSource made on the server (lib/playback-auth.ts)
 * and handed over by the accept route once the box is ticked: a plain file
 * for a video still on the CDN, or a
 * signed, expiring Mux stream for one that has moved. useVideoSource puts it
 * on the element, and, for a stream, asks the server for a fresh address a
 * little before the token runs out (refreshPlayback, which checks the link
 * again). The first real play may move the link's deadline (recordPlay); the
 * answer then carries a grant for the new deadline, which replaces the one
 * the tick brought, so the stream never stops short of the time the link
 * now has. When the link's time runs out while the page is open the player
 * says so in the same calm words as the expired page, with the clinic's
 * number, and renews nothing.
 *
 * ON A PRINTED QR CODE'S PAGE (/q/<code>: `qrCode` set, no `code` yet) there
 * is no patient link until the patient taps Play. The tap does two things at
 * once: it starts the video straight away, inside the tap, because phones
 * (iPhone Safari above all) only allow a video with sound to start in the
 * tap itself, not after waiting on the network; and it asks the server for
 * this visit's own link (issueLink, POST /q/<code>/issue). When the link
 * comes back the address bar is quietly changed to it (/watch/<new code>),
 * so a bookmark, a reload or the address passed to a relative is this
 * patient's link, not the poster's, and the play start, the deadline and
 * any fresh stream address all belong to that link from then on. No second
 * tap and no screen in between. A dropped connection is asked again with the
 * same one-time key (newVisitKey), so it never makes a second link; if the
 * server says the code cannot hand out a link right now (retired a moment
 * ago, the clinic closed), the video stops and the calm "not available"
 * panel says so, with the clinic's number. Opening the page makes nothing.
 */
export function WatchPlayer({
  poster,
  title,
  code,
  clinicName,
  logoUrl,
  senderName,
  call,
  qrCode,
}: {
  /** A still for the video's box before the box is ticked (a signed Mux still, or the poster staff set), or null. Never a playable address. */
  poster: string | null;
  title: string;
  /** The patient link this page is for, or null on a printed code's page before the first tap. */
  code: string | null;
  /** The printed code, on a printed code's page: the first tap on Play asks for this visit's own link. */
  qrCode?: string;
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
  const retryButton = useRef<HTMLButtonElement>(null);
  const counted = useRef(false);
  const slowTimer = useRef<number | undefined>(undefined);
  /** Where to pick up after Try again. */
  const resumeAt = useRef(0);

  const tickBox = useRef<HTMLInputElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const tickId = useId();
  /** The box is ticked right now. */
  const [ticked, setTicked] = useState(false);
  /** What to play: nothing until a tick's answer brings it (see the note at the top). */
  const [source, setSource] = useState<PlaybackSource | null>(null);
  /** The tick's ask is on its way, so a second tick (or Try again) while it is on its way never sends a second ask. */
  const acceptInFlight = useRef(false);
  /** No answer got through: a calm line and Try again where the box was. */
  const [acceptTrouble, setAcceptTrouble] = useState(false);
  /** A stream played through hls.js arrives a moment after the answer (the library loads first); Play waits for the element to have it. */
  const [attached, setAttached] = useState(false);

  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The link's time ran out while the page was open (a stream's token was not renewed). Said calmly, with no Try again. */
  const [ended, setEnded] = useState(false);
  const [slow, setSlow] = useState(false);
  /** A printed code that cannot hand out a link right now (retired, or the clinic cannot show this video). Said calmly, with no Try again. */
  const [unavailable, setUnavailable] = useState(false);
  /** The patient link this page plays for: the one in the address, or, on a printed code's page, the one the first tap got. */
  const shareCode = useRef<string | null>(code);
  /** The request for this visit's link while it is on its way, so a second ask waits for the same answer. */
  const issuing = useRef<Promise<string | null> | null>(null);
  /** This visit's one-time key, made at the first tap and sent with every try. */
  const visitKey = useRef<string | null>(null);
  /** A grant for the link's new deadline, handed back when the first play moved it; used in place of asking the server at the next refresh. */
  const pendingGrant = useRef<PlaybackSource | null>(null);
  const { reload } = useVideoSource(video, source, {
    onFailure: () => fail(),
    refresh: async () => {
      const ready = pendingGrant.current;
      pendingGrant.current = null;
      if (ready) return ready;
      const linkCode = await ensureCode();
      if (!linkCode) return { kind: "unavailable" };
      const answer = await refreshPlayback(linkCode);
      return answer.ok ? answer.source : answer.reason === "ended" ? null : { kind: "unavailable" };
    },
    onEnded: () => {
      clearSlow();
      setEnded(true);
    },
  });
  useEffect(() => {
    if (failed) retryButton.current?.focus({ preventScroll: true });
  }, [failed]);

  const clearSlow = useCallback(() => {
    window.clearTimeout(slowTimer.current);
    setSlow(false);
  }, []);

  useEffect(() => () => window.clearTimeout(slowTimer.current), []);

  // (Before the box existed, a file in the page's HTML could fail before this component was listening, and an
  // effect here asked the element afterwards. The HTML carries no address now: the file arrives after the tick,
  // when the listeners below are already attached.)

  /** The box was ticked: it folds away, focus goes to Play, and the video is asked for (once per page load; see the note at the top). */
  function onTick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.checked || ticked) return;
    setTicked(true);
    // The box is about to disappear with the focus in it; put the focus on Play, where the next step is.
    playButton.current?.focus({ preventScroll: true });
    if (!source) void accept();
  }

  /** Tell the server the box was ticked, and take the video it hands back. */
  async function accept() {
    if (acceptInFlight.current) return;
    const target = code ? ({ kind: "link", code } as const) : qrCode ? ({ kind: "printed", code: qrCode } as const) : null;
    if (!target) return;
    acceptInFlight.current = true;
    setAcceptTrouble(false);
    const answer = await acceptDisclaimer(target, DISCLAIMER.version);
    acceptInFlight.current = false;
    if (answer.kind === "ready") {
      setSource(answer.source);
    } else if (answer.kind === "failed") {
      setAcceptTrouble(true);
    } else if (answer.kind === "not-working" && !code) {
      // A printed code that cannot hand out the video right now: the calm panel, as for a refused Play tap.
      setUnavailable(true);
    } else {
      // A link that stopped working since the page was drawn, or words the server no longer records: the server
      // draws the right page again (the paused page has Ask my clinic; the box comes back unticked with the new words).
      window.location.reload();
    }
  }

  /** Play was tapped before it could start: take the patient to the box instead. */
  function pointToBox() {
    tickBox.current?.focus();
    tickBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /**
   * The patient link this page plays for. On a printed code's page, the first
   * call asks the server for this visit's link (see the note at the top) and
   * every later call waits for the same answer; a request that could not get
   * through is asked again next time, with the same key. Null when there is
   * no link (yet, or at all).
   */
  function ensureCode(): Promise<string | null> {
    if (shareCode.current) return Promise.resolve(shareCode.current);
    if (!qrCode) return Promise.resolve(null);
    if (!issuing.current) {
      visitKey.current ??= newVisitKey();
      issuing.current = issueLink(qrCode, visitKey.current, DISCLAIMER.version).then((answer) => {
        if (answer.kind === "issued") {
          shareCode.current = answer.code;
          // The address bar now shows this patient's own link. Next.js keeps its router in step with this call.
          window.history.replaceState(null, "", `/watch/${answer.code}`);
          return answer.code;
        }
        if (answer.kind === "unavailable") {
          video.current?.pause();
          clearSlow();
          setUnavailable(true);
          return null;
        }
        if (answer.kind === "stale") {
          // The words on this page are not the ones the server records any more: draw the page again.
          window.location.reload();
          return null;
        }
        // The server could not be reached: the next ask tries again, with the same key, so no second link is made.
        issuing.current = null;
        return null;
      });
    }
    return issuing.current;
  }

  function play() {
    if (!ready) {
      pointToBox();
      return;
    }
    // On a printed code's page, ask for this visit's link now, alongside the play below (never before it: the play must start inside the tap).
    if (qrCode) void ensureCode();
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
    // The hook fetches the file afresh, or a fresh signed address when the old one has run out; it starts the video too.
    void reload(resumeAt.current);
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
    ensureCode()
      .then((linkCode) => (linkCode ? recordPlay(linkCode) : { recorded: false, playback: undefined }))
      .then((answer) => {
        // The first play moved the deadline: the stream's next refresh uses this grant, for the link's new window.
        if (answer.playback) pendingGrant.current = answer.playback;
      })
      .catch(() => {});
  }

  /** The video has run out of data and is waiting for more. Say so only if it goes on for a while. */
  function onWaiting() {
    window.clearTimeout(slowTimer.current);
    slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
  }

  /** The file's size is known: after Try again, go back to where the video stopped. */
  function onLoadedMetadata() {
    const element = video.current;
    if (element && resumeAt.current > 0) {
      element.currentTime = Math.min(resumeAt.current, element.duration || resumeAt.current);
      resumeAt.current = 0;
    }
  }

  /** Play can start the video: the box is ticked and the video is on the element (a file, or the phone's own HLS, is put on in the same moment; hls.js a moment later). */
  const ready = ticked && source !== null && (attached || source.kind !== "stream");

  /** Nothing is playing and nothing can be: the failure panel, or the link's time ran out. The layout treats both alike. */
  const stopped = failed || ended || unavailable;

  return (
    <div>
      {/* The box. Large on purpose: the whole row is the tap target (at least 48px tall), the square itself is 28px, and the
          words are the page's 20px body text. Once ticked it folds away (the grid row shrinks from its full height to
          nothing, so the fold needs no measuring) and is taken out of reach of the keyboard and screen readers (inert). */}
      <div
        data-education-box=""
        inert={ticked || undefined}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          ticked ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mb-4 rounded-2xl border-2 border-[#c9c3b6] bg-white px-4 py-3">
            <label htmlFor={tickId} className="flex min-h-12 cursor-pointer items-start gap-3.5 py-1">
              <input
                ref={tickBox}
                id={tickId}
                type="checkbox"
                checked={ticked}
                onChange={onTick}
                className="mt-0.5 h-7 w-7 shrink-0 cursor-pointer accent-[#12333f] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1e5668]"
              />
              <span className="text-[20px] leading-[1.45] text-[#12202a]">{DISCLAIMER.text}</span>
            </label>
          </div>
        </div>
      </div>
      {/* No answer got through: said calmly where the box was, with one way to try again. */}
      {acceptTrouble && (
        <div className="mb-4 rounded-2xl border-2 border-[#c9c3b6] bg-white px-4 py-3">
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-[17px] leading-[1.45] text-[#3a4c56]">We couldn&apos;t get the video ready. Check your connection, then try again.</p>
            <button
              type="button"
              onClick={() => void accept()}
              className="flex h-12 shrink-0 items-center rounded-full bg-[#12333f] px-7 text-[17px] font-semibold text-white transition active:scale-95 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1e5668]"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* The player: one rounded card, the strip on its top edge (the clinic's logo and the doctor's name, above the picture,
          never over it), then the video's box. */}
      <div className="overflow-hidden rounded-[18px] bg-black shadow-[0_10px_30px_-14px_rgba(18,32,42,.4)]">
        <ClinicMark logoUrl={logoUrl} name={clinicName} senderName={senderName} />

        {/* The video's box: 16:9 while there is a picture. It is a grid, and never shorter than what it holds (min-h-fit),
            so that in the one case where the player sits inside it rather than over it (the failure panel, below) the box
            grows to fit instead of squeezing or cutting off what is in it. */}
        <div className="relative grid min-h-fit w-full" style={stopped ? undefined : { paddingTop: "56.25%" }}>
          <div
            ref={frame}
            tabIndex={-1}
            className={
              stopped
                ? // The failure panel holds a sentence, a button and a phone link. On a phone the video's box is only
                  // about 190px tall, too short for all of that at full size, and squeezing it shrank "Try again" to
                  // 26px (measured). So here the player takes its place IN the page and is as tall as it needs to be.
                  // The text under it moves down a little; nothing is playing, so nothing is lost.
                  "relative flex min-w-0 flex-col bg-[#12202a]"
                : "absolute inset-0 flex flex-col bg-black"
            }
          >
            <div className="relative flex min-h-0 flex-1 flex-col">
              <video
                ref={video}
                // Nothing to play until the box is ticked: the page's HTML has a still at most. After the tick, a plain file
                // goes on here and the browser starts fetching at once (useVideoSource leaves it be); a stream is put on by
                // the hook. The still stays until the first frame replaces it.
                src={source?.kind === "file" ? source.src : undefined}
                poster={source?.kind === "stream" ? source.poster : (poster ?? undefined)}
                preload="auto"
                playsInline
                // The browser's controls arrive with the first play, as they always have here: before it, the big
                // Play button is the only thing on the picture, and a control bar showing through under "Tap to play"
                // would be a second, smaller play button to aim at. Their full-screen button is left on: it is the way to
                // go big (see the note at the top).
                controls={started && !stopped}
                tabIndex={started && !stopped ? 0 : -1}
                controlsList="nodownload"
                // The element has started taking the video (for hls.js, the moment the library is attached): Play is ready.
                onLoadStart={() => setAttached(true)}
                onPlay={onPlay}
                onPlaying={onPlaying}
                onWaiting={onWaiting}
                onCanPlay={clearSlow}
                onLoadedMetadata={onLoadedMetadata}
                onError={fail}
                aria-label={title}
                // When it has failed, the panel below says so in our words. Without this a screen reader also reads
                // the browser's own "Unable to play media" from the video underneath, the same news twice.
                aria-hidden={stopped || undefined}
                className={`absolute inset-0 h-full w-full object-contain ${stopped ? "invisible" : ""}`}
              />

              {/* Said only when the wait has gone on a while, so a tap on a weak signal never looks ignored. The one thing of
                  ours over a playing picture, and only while it is stuck; it takes no tap. The element is always here (while
                  there is a picture) so a screen reader hears the words when they arrive; the "did not load" panel announces itself. */}
              {!stopped && (
                <p
                  role="status"
                  className={
                    slow
                      ? "pointer-events-none absolute left-1/2 top-1/2 w-max max-w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white/90 px-3 py-1.5 text-center text-[15px] leading-[1.35] font-medium text-[#12333f]"
                      : "sr-only"
                  }
                >
                  {slow ? "Still loading. A slow connection can take a little longer." : ""}
                </p>
              )}

              {!started && !stopped && (
                // The keyboard focus ring is drawn just inside the edge, because the
                // rounded card clips anything drawn outside it.
                // Visibly not ready until the box is ticked and the video has arrived: the circle is dimmed and its line
                // says why. Not `disabled`, so a tap still does something useful: it takes the patient to the box.
                <button
                  ref={playButton}
                  type="button"
                  onClick={play}
                  aria-label={`Play ${title}`}
                  aria-disabled={ready ? undefined : true}
                  aria-describedby={ready ? undefined : `${tickId}-why`}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-4px] focus-visible:outline-[#1e5668]"
                >
                  <span
                    className={`flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-[0_10px_34px_rgba(0,0,0,.4)] transition ${
                      ready ? "text-[#12333f] active:scale-95" : "text-[#9aa5ac] opacity-70"
                    }`}
                  >
                    <PlayIcon className="ml-1 h-10 w-10" />
                  </span>
                  <span id={`${tickId}-why`} className="rounded-full bg-white px-4 py-2 text-[17px] font-semibold text-[#12333f] shadow-[0_4px_16px_rgba(0,0,0,.3)]">
                    {ready ? "Tap to play" : !ticked ? "Tick the box above to play" : acceptTrouble ? "Tap Try again above" : "Getting the video ready"}
                  </span>
                </button>
              )}

              {stopped && (
                // Calm, like the expired page: no red, and never the word "error". Announced to a screen reader when it appears.
                // It is part of the page's flow (not laid over the video's box), so it is as tall as its words and buttons
                // need, and "shrink-0" on the two controls means they keep their full 48px whatever else happens.
                // The same panel says, in the expired page's words, that the link's time ran out while the page was open;
                // there is no Try again then, because nothing is renewed once access has ended.
                <div role="alert" className="relative flex flex-1 flex-col items-center justify-center gap-3 bg-[#12202a] px-5 py-6 text-center">
                  <p className="text-[20px] leading-[1.35] font-semibold text-white">
                    {unavailable ? "This video isn't available right now." : ended ? "This link has expired." : "The video did not load."}
                  </p>
                  <p className="max-w-[30ch] text-[16px] leading-[1.45] text-[#d5dde2]">
                    {unavailable
                      ? `Please ask ${clinicName} about it.`
                      : ended
                        ? `Links stay open for a set time. ${clinicName} can send you a fresh one whenever you need it.`
                        : "Check your connection, then try again."}
                  </p>
                  {!ended && !unavailable && (
                    <button
                      ref={retryButton}
                      type="button"
                      onClick={retry}
                      className="mt-1 flex h-12 shrink-0 items-center rounded-full bg-white px-7 text-[17px] font-semibold text-[#12333f] transition active:scale-95 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      Try again
                    </button>
                  )}
                  {/* A tap-to-call link on a phone; on a computer, where it would do nothing useful, the number as plain words (see CallButton). */}
                  {call && (
                    <>
                      <a
                        href={call.href}
                        className="flex min-h-12 shrink-0 items-center gap-2 rounded-full px-4 text-[16px] font-medium text-white underline underline-offset-4 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-white computer:hidden"
                      >
                        <PhoneIcon className="h-5 w-5 shrink-0" />
                        {ended || unavailable ? "Call" : "Still stuck? Call"} {call.label}
                      </a>
                      <CallNumber call={call} className="min-h-12 shrink-0 px-4 text-[16px] text-white" />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
