import { refreshDelayMs, tokenHasExpired, type PlaybackSource } from "@/lib/playback-source";

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
 *     stream, and the library's grid of cards never loads it at all. Which
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
      element.src = next.src;
      element.load();
      if (startAt > 0) seekWhenReady(element, startAt);
      if (resume) element.play().catch(() => {});
      return;
    }

    let Hls: HlsModule["default"];
    try {
      Hls = (await (this.env.loadHls ?? (() => import("hls.js")))()).default;
    } catch {
      // The library did not arrive (the connection dropped mid-download). Try again fetches it again.
      if (!this.dead) this.env.getHooks().onFailure();
      return;
    }
    if (this.dead || this.current !== next || this.env.getElement() !== element) return;
    if (!Hls.isSupported()) {
      // No MediaSource here after all. The browser's own HLS, if it claims any, is the last resort; otherwise nothing can play a stream.
      if (element.canPlayType("application/vnd.apple.mpegurl")) {
        element.src = next.src;
        element.load();
        if (startAt > 0) seekWhenReady(element, startAt);
        if (resume) element.play().catch(() => {});
      } else {
        this.env.getHooks().onFailure();
      }
      return;
    }

    const instance = new Hls({ startPosition: startAt > 0 ? startAt : -1 });
    this.hls = instance;
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // hls.js has already retried what it retries. The kind only, never the address.
      console.warn("Video stream failed:", data.type, data.details);
      if (this.hls === instance) this.env.getHooks().onFailure();
    });
    instance.loadSource(next.src);
    instance.attachMedia(element);
    if (resume) element.play().catch(() => {});
  }

  /** Ask the server for a fresh grant and swap to it where the video is. Resolves false when access has ended. */
  async refreshNow(): Promise<boolean> {
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
      }
      return true;
    }
    const element = this.env.getElement();
    const at = element ? element.currentTime : 0;
    const resume = element ? !element.paused && !element.ended : false;
    await this.attach(fresh, at, resume);
    return true;
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
      await this.refreshNow();
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

  /** Take everything down: the hls.js instance and its listeners, and the timers. Nothing answers after this. */
  destroy(): void {
    this.dead = true;
    clearTimeout(this.refreshTimer);
    this.dropHls();
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  private dropHls(): void {
    this.hls?.destroy();
    this.hls = null;
  }

  private scheduleRefresh(expiresAt: number): void {
    clearTimeout(this.refreshTimer);
    if (!this.env.getHooks().refresh) return;
    this.refreshTimer = setTimeout(() => void this.refreshNow(), refreshDelayMs(expiresAt, this.now()));
  }
}

/** Once the new file says how long it is, jump to where the old one was. */
function seekWhenReady(element: HTMLVideoElement, at: number) {
  const onReady = () => {
    element.removeEventListener("loadedmetadata", onReady);
    element.currentTime = Math.min(at, element.duration || at);
  };
  element.addEventListener("loadedmetadata", onReady);
}
