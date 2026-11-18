import { refreshDelayMs, tokenHasExpired, tokenRunsOutSoon, type PlaybackSource } from "@/lib/playback-source";
import { applyNativeCaptions, captionTracksOf, choiceAfterSystemPlayer, nativeCaptionChoice, pickCaptionTrack } from "./captions";

/**
 * Puts a PlaybackSource (lib/playback-source.ts) onto a <video> element and
 * keeps it playable: the machinery behind useVideoSource, as a plain object
 * with no React in it, so it can be read on its own and tested with a
 * stand-in element. Browser code; it never decides what may be played, it
 * only loads what the server handed it, and asks the server again when a
 * signed address is about to run out.
 *
 * "file"  the plain MP4 address. The player writes it on the <video> in the
 *         page's HTML as well (so the browser starts fetching before React
 *         is awake, which is what keeps the patient's first frame fast);
 *         the loader then finds it already there and does nothing.
 *
 * "stream"  a signed HLS playlist from Mux. Two ways to play one:
 *
 *   - the browser's own HLS, where it has it (Safari on iPhone, iPad and
 *     Mac): the address goes straight on the element, like a file;
 *   - everywhere else, hls.js, loaded only now (a dynamic import), so no
 *     browser downloads a streaming library for a page that never plays a
 *     stream, and the library's grid of cards never loads it at all. (The
 *     patient page may start that same download a moment sooner, at the
 *     tick, for a video it knows will be a stream: warmUpStreamLibrary.) Which
 *     browsers count as "having HLS of their own" is decided by what they
 *     have, not by their name (browserPrefersNativeHls): Chrome and Android
 *     browsers also CLAIM they might play HLS and then do it badly or not at
 *     all, so the claim alone is not trusted.
 *
 *   Mux checks the token on every request, so a token that expires can stop
 *   a video that is still playing. A little before it runs out
 *   (refreshDelayMs) the loader asks the server for a fresh grant through
 *   `refresh`. The server decides again: a working link, or a clinic whose
 *   plan still allows the video, gets a new address and the player swaps to
 *   it where it was (same position, same playing or paused). Access that
 *   has ended gets nothing, `onEnded` is called, and nothing is renewed: a
 *   token already handed out keeps working until it expires, and video the
 *   phone has already loaded is already there (see CLAUDE.md, "The video
 *   boundary"). A refresh that merely failed (the connection dropped) is
 *   tried again shortly.
 *
 * "unavailable"  no address could be made. The player's "did not load" panel
 *         is shown at once (`onFailure`); Try again (`reload`) asks the
 *         server again. Never the CDN file instead.
 *
 * destroy() takes down the hls.js instance and its listeners and clears the
 * timers, so a player closed mid-stream leaves nothing running. Nothing here
 * logs an address or a token; an hls.js failure is logged by its kind only.
 */

type HlsModule = typeof import("hls.js");
type HlsInstance = import("hls.js").default;

export type LoaderHooks = {
  /** The video cannot be played right now: the player shows its calm panel. */
  onFailure: () => void;
  /** Ask the server for a fresh grant for the same video: the new source, or null when access has ended. Absent for a player with no way to ask. */
  refresh?: () => Promise<PlaybackSource | null>;
  /** Access has ended for good: the player says so calmly. Nothing is renewed after this. */
  onEnded?: () => void;
  /** A fresh address from the server went on the element: a panel an earlier failure left up can go. */
  onRecovered?: () => void;
};

/** What the loader needs from its surroundings. The two optional ones are for the tests, which hand in a stand-in library and a clock. */
export type LoaderEnvironment = {
  /** The element, looked up each time, because the player's ref may not be filled when the loader is made. */
  getElement: () => HTMLVideoElement | null;
  /** The player's callbacks, looked up each time so the latest ones are used. */
  getHooks: () => LoaderHooks;
  loadHls?: () => Promise<HlsModule>;
  now?: () => number;
  /** Whether this browser plays HLS by itself (and well). Decided in the browser, never on the server. */
  prefersNativeHls?: (element: HTMLVideoElement) => boolean;
  /** Captions (captions.ts): whether the viewer has CC on, and where to say whether the video has a caption track at all. */
  captions?: CaptionHooks;
};

export type CaptionHooks = {
  /**
   * The person's choice: CC on (true), off (false), or not chosen yet (null). Asked each time a stream goes on, so
   * the choice carries across a swap to a fresh address.
   */
  wanted: () => boolean | null;
  /**
   * The device made the choice instead: its accessibility settings switched captions on before any press of CC, or
   * the person used an iPhone's own captions button in its full-screen player. The CC button follows (captions.ts).
   */
  adopt: (on: boolean) => void;
  /** The video on the element has a caption track (true) or not (false). Only a stream can; a file never does. */
  onAvailable: (available: boolean) => void;
};

/** How soon to try again after a refresh that failed for a passing reason. */
export const RETRY_REFRESH_MS = 30_000;

/**
 * Does this browser play HLS by itself, and well? Only Apple's browsers do
 * (Safari on iPhone, iPad and Mac), and they are found by what they have,
 * never by their name: an iPhone has no MediaSource at all (so hls.js could
 * not run there anyway), and Safari 17 and later is the one browser with
 * ManagedMediaSource. Chrome 152 on Windows and Android browsers also answer
 * "maybe" to the question and then play HLS badly or not at all (seen in
 * October 2026), so the answer alone is not trusted: they get hls.js.
 */
export function browserPrefersNativeHls(element: HTMLVideoElement): boolean {
  if (!element.canPlayType("application/vnd.apple.mpegurl")) return false;
  const w = window as unknown as Record<string, unknown>;
  return !("MediaSource" in w) || "ManagedMediaSource" in w;
}

/**
 * Wraps a fetch so it is made once and every caller shares the answer, but a
 * fetch that FAILED is forgotten, so the next caller fetches again. Used for
 * hls.js: the patient page may start fetching it early (at the tick) and the
 * loader asks again when the stream arrives; both get the same download, and
 * an early fetch that dropped never stands in the way of the real one.
 */
export function shareUntilFailure<T>(fetchOnce: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const made = fetchOnce();
      pending = made;
      made.catch(() => {
        if (pending === made) pending = null;
      });
    }
    return pending;
  };
}

/** hls.js, fetched at most once per page (and again only after a failed try). */
export const loadHlsLibrary: () => Promise<HlsModule> = shareUntilFailure(() => import("hls.js"));

/**
 * Start fetching hls.js now, before a stream has arrived, on a browser that
 * will need it. The patient page calls this at the tick for a video it knows
 * will be a stream, so the library downloads while the tick's own request is
 * on its way, instead of only after its answer. Nothing happens on a browser
 * that plays HLS itself (Safari: it never downloads the library), and the
 * page's first load never waits for it (the tick comes after the page is
 * up). A failure is ignored here: the loader's own ask, a moment later,
 * fetches again (shareUntilFailure) and says so if that fails too.
 */
export function warmUpStreamLibrary(
  element: HTMLVideoElement | null,
  { prefersNativeHls = browserPrefersNativeHls, load = loadHlsLibrary }: { prefersNativeHls?: (element: HTMLVideoElement) => boolean; load?: () => Promise<unknown> } = {},
): void {
  if (!element || prefersNativeHls(element)) return;
  load().catch(() => {});
}

export class SourceLoader {
  /** The source currently on the element (it moves on after a refresh, while the page's prop stays what it handed in). */
  private current: PlaybackSource = { kind: "unavailable" };
  private hls: HlsInstance | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by destroy(), so a late answer from the server or from the hls.js import changes nothing. */
  private dead = false;

  constructor(private readonly env: LoaderEnvironment) {}

  /** What is on the element right now. For the tests. */
  get source(): PlaybackSource {
    return this.current;
  }

  /**
   * Put a source on the element. `startAt` and `resume` carry the position
   * and play state across a swap to a fresh address, so a refresh is not a
   * restart.
   */
  async attach(next: PlaybackSource, startAt = 0, resume = false): Promise<void> {
    const element = this.env.getElement();
    if (!element || this.dead) return;
    this.dropHls();
    this.current = next;
    clearTimeout(this.refreshTimer);
    // A file (or nothing) has no caption track: no CC button. A stream says for itself once its playlist is read.
    if (next.kind !== "stream") this.env.captions?.onAvailable(false);

    if (next.kind === "unavailable") {
      this.env.getHooks().onFailure();
      return;
    }

    if (next.kind === "file") {
      // Already there from the page's own HTML; only a swap writes it.
      if (element.getAttribute("src") !== next.src) {
        element.src = next.src;
        element.load();
        if (startAt > 0) seekWhenReady(element, startAt);
        if (resume) element.play().catch(() => {});
      }
      return;
    }

    this.scheduleRefresh(next.expiresAt);
    if ((this.env.prefersNativeHls ?? browserPrefersNativeHls)(element)) {
      this.watchNativeCaptions(element);
      element.src = next.src;
      element.load();
      if (startAt > 0) seekWhenReady(element, startAt);
      if (resume) element.play().catch(() => {});
      return;
    }

    let Hls: HlsModule["default"];
    try {
      Hls = (await (this.env.loadHls ?? loadHlsLibrary)()).default;
    } catch {
      // The library did not arrive (the connection dropped mid-download). Try again fetches it again.
      if (!this.dead) this.env.getHooks().onFailure();
      return;
    }
    if (this.dead || this.current !== next || this.env.getElement() !== element) return;
    if (!Hls.isSupported()) {
      // No MediaSource here after all. The browser's own HLS, if it claims any, is the last resort; otherwise nothing can play a stream.
      if (element.canPlayType("application/vnd.apple.mpegurl")) {
        this.watchNativeCaptions(element);
        element.src = next.src;
        element.load();
        if (startAt > 0) seekWhenReady(element, startAt);
        if (resume) element.play().catch(() => {});
      } else {
        this.env.getHooks().onFailure();
      }
      return;
    }

    const instance = new Hls(hlsSettings(startAt));
    this.hls = instance;
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // hls.js has already retried what it retries. The kind only, never the address.
      console.warn("Video stream failed:", data.type, data.details);
      if (this.hls === instance) this.env.getHooks().onFailure();
    });
    // Captions through hls.js's own subtitle track API. The playlist says whether there are any; once hls.js has the
    // track list, the one to load is chosen (or none, while CC is off: hls.js could otherwise pick one marked default).
    // subtitleDisplay off means hls.js loads the words onto a "hidden" text track on the element and the overlay draws them.
    instance.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (this.hls === instance) this.env.captions?.onAvailable(data.subtitleTracks.length > 0);
    });
    instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      if (this.hls === instance) this.applyHlsCaptions(instance);
    });
    // hls.js can change the track by itself afterwards: a fresh instance on the same element finds the text track the
    // last one left, and, seeing it off while it attaches, switches to "none" (seen in Chrome on a swap to a fresh
    // address). Whenever its choice and the viewer's differ, the viewer's is put back, a moment later so hls.js has
    // finished its own step first. Once they agree nothing more happens, so the two never take turns.
    instance.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => {
      setTimeout(() => {
        if (this.hls === instance && !this.dead) this.applyHlsCaptions(instance);
      }, 0);
    });
    instance.loadSource(next.src);
    instance.attachMedia(element);
    if (resume) element.play().catch(() => {});
  }

  /**
   * Ask the server for a fresh grant and swap to it where the video is.
   * Resolves false when access has ended. `fromTryAgain` is set by Try again
   * (reload): the player has already hidden its panel then, so a server that
   * cannot answer, with no token left to play on, must bring the panel back.
   * Otherwise the patient is left with a frozen picture and no words.
   */
  async refreshNow(fromTryAgain = false): Promise<boolean> {
    const ask = this.env.getHooks().refresh;
    if (!ask) return false;
    let fresh: PlaybackSource | null;
    try {
      fresh = await ask();
    } catch {
      fresh = { kind: "unavailable" };
    }
    if (this.dead) return false;
    if (fresh === null) {
      this.dropHls();
      clearTimeout(this.refreshTimer);
      this.env.getHooks().onEnded?.();
      return false;
    }
    if (fresh.kind === "unavailable") {
      // A passing failure, most likely. Try again before the token runs out, if there is time.
      const on = this.current;
      if (on.kind === "stream" && !tokenHasExpired(on.expiresAt, this.now())) {
        this.refreshTimer = setTimeout(() => void this.refreshNow(), RETRY_REFRESH_MS);
      } else if (fromTryAgain) {
        // Nothing left to play on and nothing new: the calm panel comes back, with Try again on it.
        this.env.getHooks().onFailure();
      }
      return true;
    }
    const element = this.env.getElement();
    const at = element ? element.currentTime : 0;
    const resume = element ? !element.paused && !element.ended : false;
    await this.attach(fresh, at, resume);
    if (!this.dead && this.current === fresh) this.env.getHooks().onRecovered?.();
    return true;
  }

  /**
   * The page has come back into view. A phone that slept, or a tab left in
   * the background, may not run timers, so the refresh due before the token
   * ran out may never have happened. Ask now if the token has run out or is
   * about to; otherwise the timer already set is enough. The server decides,
   * as always.
   */
  async refreshIfStale(): Promise<void> {
    const on = this.current;
    if (this.dead || on.kind !== "stream" || !this.env.getHooks().refresh) return;
    if (!tokenRunsOutSoon(on.expiresAt, this.now())) return;
    clearTimeout(this.refreshTimer);
    await this.refreshNow();
  }

  /**
   * Try again, from the player's button: load the same source afresh, or a
   * fresh one when the token has run out (or there never was a usable one).
   * `startAt` is where to pick up.
   */
  async reload(startAt: number): Promise<void> {
    const on = this.current;
    const stale = on.kind === "unavailable" || (on.kind === "stream" && tokenHasExpired(on.expiresAt, this.now()));
    if (stale && this.env.getHooks().refresh) {
      await this.refreshNow(true);
      return;
    }
    await this.attach(on, startAt, true);
    // A plain file is reloaded the way it always was: the element fetches it again and plays.
    if (on.kind === "file") {
      const element = this.env.getElement();
      if (element) {
        element.load();
        element.play().catch(() => {});
      }
    }
  }

  /**
   * CC was pressed: put the viewer's choice (captions.wanted()) on whatever is
   * playing. With hls.js, its subtitle track API; with the browser's own HLS,
   * the element's text tracks. The overlay draws the words either way.
   */
  applyCaptions(): void {
    if (this.dead) return;
    if (this.hls) {
      this.applyHlsCaptions(this.hls);
      return;
    }
    const element = this.env.getElement();
    if (element && this.nativeCaptions) this.putNativeChoice(element);
  }

  /** Take everything down: the hls.js instance and its listeners, and the timers. Nothing answers after this. */
  destroy(): void {
    this.dead = true;
    clearTimeout(this.refreshTimer);
    this.dropHls();
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  /** The person's choice, or null before they have made one. */
  private wantsCaptions(): boolean | null {
    return this.env.captions?.wanted() ?? null;
  }

  /**
   * The browser's own HLS: put the choice on the element's caption tracks. Before any press of CC, a track the device
   * switched on is taken as CC on (adopted, so the button shows it), and a device that switched nothing on is left
   * exactly as it is: the player never switches off what the device's own settings chose (captions.ts).
   */
  private putNativeChoice(element: HTMLVideoElement): void {
    const asked = this.wantsCaptions();
    const choice = nativeCaptionChoice(element, asked);
    if (choice === null) return;
    if (asked === null) this.env.captions?.adopt(choice);
    applyNativeCaptions(element, choice, this.systemPlayer);
  }

  /** hls.js: the English track (or the first) while CC is on, none while it is off. The words go on a "hidden" track. */
  private applyHlsCaptions(instance: HlsInstance): void {
    instance.subtitleDisplay = false;
    const languages = (instance.subtitleTracks ?? []).map((track) => ({ language: track.lang ?? "" }));
    // hls.js is told nothing of the device's caption settings: off until the person presses CC.
    const chosen = this.wantsCaptions() === true ? pickCaptionTrack(languages) : null;
    const index = chosen ? languages.indexOf(chosen) : -1;
    if (instance.subtitleTrack !== index) instance.subtitleTrack = index;
  }

  /** The browser's own HLS is on the element: listening to its text tracks (null when it is not). */
  private nativeCaptions: (() => void) | null = null;
  /** An iPhone's own full-screen player is up: the phone draws the captions there (captions.ts). */
  private systemPlayer = false;

  /**
   * The browser's own HLS (Safari): the stream's caption tracks appear on the
   * element's textTracks once it has read the playlist, and are replaced when
   * a fresh address goes on. Each time the list changes, say whether there are
   * any, and put the viewer's choice on the new ones, so CC stays as it was
   * across a swap.
   */
  private watchNativeCaptions(element: HTMLVideoElement): void {
    this.stopNativeCaptions();
    const tracks = element.textTracks;
    const update = () => {
      if (this.dead) return;
      this.env.captions?.onAvailable(captionTracksOf(element).length > 0);
      this.putNativeChoice(element);
    };
    const enterSystemPlayer = () => {
      this.systemPlayer = true;
      update();
    };
    const leaveSystemPlayer = () => {
      // A choice made with the phone's own captions button while its player was up is the person's choice now.
      const asked = this.wantsCaptions();
      const chosen = choiceAfterSystemPlayer(element, asked);
      if (chosen !== null && chosen !== asked) this.env.captions?.adopt(chosen);
      this.systemPlayer = false;
      update();
    };
    tracks?.addEventListener?.("addtrack", update);
    tracks?.addEventListener?.("removetrack", update);
    element.addEventListener("webkitbeginfullscreen", enterSystemPlayer);
    element.addEventListener("webkitendfullscreen", leaveSystemPlayer);
    this.nativeCaptions = () => {
      tracks?.removeEventListener?.("addtrack", update);
      tracks?.removeEventListener?.("removetrack", update);
      element.removeEventListener("webkitbeginfullscreen", enterSystemPlayer);
      element.removeEventListener("webkitendfullscreen", leaveSystemPlayer);
    };
    update();
  }

  private stopNativeCaptions(): void {
    this.nativeCaptions?.();
    this.nativeCaptions = null;
  }

  private dropHls(): void {
    this.hls?.destroy();
    this.hls = null;
    // Whichever engine was on, its caption listeners go with it (attach() starts the right ones again).
    this.stopNativeCaptions();
  }

  private scheduleRefresh(expiresAt: number): void {
    clearTimeout(this.refreshTimer);
    if (!this.env.getHooks().refresh) return;
    this.refreshTimer = setTimeout(() => void this.refreshNow(), refreshDelayMs(expiresAt, this.now()));
  }
}

/**
 * How hls.js is set up. `capLevelToPlayerSize` keeps it from fetching a
 * picture bigger than the player is drawn (in device pixels): a phone's
 * player is about 400 points wide, so it starts on a smaller, quicker
 * rendition instead of the largest one. hls.js watches the video element's
 * size (a ResizeObserver, in hls.js 1.7), so when the player goes full
 * screen, or a tablet turns sideways, the limit rises and it switches up to
 * a sharper rendition. Safari plays HLS itself and picks its own.
 */
export function hlsSettings(startAt: number) {
  return { startPosition: startAt > 0 ? startAt : -1, capLevelToPlayerSize: true };
}

/** Once the new file says how long it is, jump to where the old one was. */
function seekWhenReady(element: HTMLVideoElement, at: number) {
  const onReady = () => {
    element.removeEventListener("loadedmetadata", onReady);
    element.currentTime = Math.min(at, element.duration || at);
  };
  element.addEventListener("loadedmetadata", onReady);
}
