import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_LIFETIME_MS, type PlaybackSource } from "@/lib/playback-source";
import { activeCaptionLines, applyNativeCaptions, cueLines, pickCaptionTrack } from "./captions";
import { PlayerOverlay } from "./PlayerOverlay";
import type { PlayerControls } from "./usePlayerControls";
import type { PlayerCaptions } from "./useVideoSource";
import { SourceLoader, type LoaderHooks } from "./video-source-loader";

/**
 * Captions on both players (captions.ts), with stand-ins for the <video>
 * element, its text tracks and hls.js. No browser, no Mux. What these prove:
 *
 *   - the CC button is drawn only when the playing video has a caption
 *     track, is labelled, at least 44px, and says whether it is on;
 *   - the words being said are drawn while CC is on, and nothing while off;
 *   - with the browser's own HLS (Safari): the track is found on the
 *     element's textTracks, off ("disabled") to start, "hidden" (loaded, drawn
 *     by us) once CC is on, "showing" in an iPhone's own full-screen player;
 *   - with hls.js: the playlist's subtitle tracks say whether there are any,
 *     hls.js's subtitleTrack is -1 while off (even for a track marked
 *     default) and the English one once on, with subtitleDisplay off;
 *   - CC stays on across a swap to a fresh address, with either engine;
 *   - a plain file never offers captions.
 *
 * A real Mux stream with real captions, Safari, Chrome and real phones are
 * the checks in the pull request's walkthrough.
 */

const NOW = 1_800_000_000_000;

function stream(id: string): PlaybackSource {
  return { kind: "stream", src: `https://stream.mux.com/${id}.m3u8?token=t-${id}`, poster: `https://image.mux.com/${id}/thumbnail.jpg?token=p-${id}`, expiresAt: NOW + TOKEN_LIFETIME_MS };
}

/** A small event target, enough for the loader's listeners. */
function events() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(name: string, fn: () => void) {
      (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(fn);
    },
    removeEventListener(name: string, fn: () => void) {
      listeners.get(name)?.delete(fn);
    },
    fire(name: string) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn();
    },
    count(name: string) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

type FakeTrack = { kind: string; language: string; label: string; mode: TextTrackMode; activeCues: { text: string }[] | null } & ReturnType<typeof events>;

function track(kind: string, language: string, label = language): FakeTrack {
  return { kind, language, label, mode: "disabled", activeCues: null, ...events() };
}

/** Enough of a <video> element with a textTracks list for captions. */
function fakeVideo() {
  const list = Object.assign([] as FakeTrack[], events());
  const element = {
    ...events(),
    src: "",
    currentTime: 0,
    duration: 120,
    paused: true,
    ended: false,
    textTracks: list,
    getAttribute: () => null,
    load() {},
    play: () => Promise.resolve(),
    canPlayType: () => "maybe",
    /** Safari has read a playlist: its caption tracks replace the old ones. */
    tracksArrive(...tracks: FakeTrack[]) {
      while (list.length) {
        list.pop();
        list.fire("removetrack");
      }
      for (const t of tracks) {
        list.push(t);
        list.fire("addtrack");
      }
    },
  };
  return element as typeof element & HTMLVideoElement;
}

/** A stand-in for hls.js with its subtitle track API. */
function fakeHls() {
  type Instance = {
    handlers: Map<string, (event: string, data: unknown) => void>;
    subtitleTracks: { lang?: string; name: string }[];
    subtitleTrack: number;
    subtitleDisplay: boolean;
    destroyed: boolean;
    fire: (event: string, data?: unknown) => void;
  };
  const instances: Instance[] = [];
  class Hls {
    static isSupported = () => true;
    static Events = { ERROR: "hlsError", MANIFEST_PARSED: "hlsManifestParsed", SUBTITLE_TRACKS_UPDATED: "hlsSubtitleTracksUpdated", SUBTITLE_TRACK_SWITCH: "hlsSubtitleTrackSwitch" };
    record: Instance = {
      handlers: new Map(),
      subtitleTracks: [],
      // hls.js picks a track marked DEFAULT by itself: the loader must switch it off while CC is off.
      subtitleTrack: 0,
      subtitleDisplay: true,
      destroyed: false,
      fire: (event, data) => this.record.handlers.get(event)?.(event, data),
    };
    constructor() {
      instances.push(this.record);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.record.handlers.set(event, handler);
    }
    get subtitleTracks() {
      return this.record.subtitleTracks;
    }
    get subtitleTrack() {
      return this.record.subtitleTrack;
    }
    set subtitleTrack(value: number) {
      this.record.subtitleTrack = value;
    }
    get subtitleDisplay() {
      return this.record.subtitleDisplay;
    }
    set subtitleDisplay(value: boolean) {
      this.record.subtitleDisplay = value;
    }
    loadSource() {}
    attachMedia() {}
    destroy() {
      this.record.destroyed = true;
    }
  }
  return { instances, loadHls: async () => ({ default: Hls }) as unknown as typeof import("hls.js") };
}

/** A loader with CC wired as useVideoSource wires it: a switch the test flips, and a record of what was said about tracks. */
function make(element: HTMLVideoElement, native: boolean, refresh?: () => Promise<PlaybackSource | null>) {
  const hls = fakeHls();
  const state = { wanted: null as boolean | null, available: [] as boolean[], adopted: [] as boolean[] };
  const hooks: LoaderHooks = { onFailure: vi.fn(), refresh };
  const loader = new SourceLoader({
    getElement: () => element,
    getHooks: () => hooks,
    loadHls: hls.loadHls,
    now: () => Date.now(),
    prefersNativeHls: () => native,
    captions: {
      wanted: () => state.wanted,
      onAvailable: (yes) => state.available.push(yes),
      adopt: (on) => {
        state.adopted.push(on);
        state.wanted = on;
      },
    },
  });
  const press = (on: boolean) => {
    state.wanted = on;
    loader.applyCaptions();
  };
  return { loader, hls, state, press, hooks };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the caption words", () => {
  it("drops WebVTT's tags, puts escaped characters back and splits the lines", () => {
    expect(cueLines("<v Narrator>The <i>femur</i> is the thigh bone.</v>\nIt meets the tibia &amp; patella.")).toEqual(["The femur is the thigh bone.", "It meets the tibia & patella."]);
    expect(cueLines("&lt;b&gt; stays as text, not a tag &nbsp; ")).toEqual(["<b> stays as text, not a tag"]);
    expect(cueLines("  \n ")).toEqual([]);
  });

  it("chooses the English track, or the first when there is none", () => {
    expect(pickCaptionTrack([{ language: "es" }, { language: "en-US" }])).toEqual({ language: "en-US" });
    expect(pickCaptionTrack([{ language: "fr" }])).toEqual({ language: "fr" });
    expect(pickCaptionTrack([])).toBeNull();
  });

  it("reads the words being said from the track that is on, and none from a track that is off", () => {
    const video = fakeVideo();
    const english = track("subtitles", "en");
    english.activeCues = [{ text: "Your new knee\nis made of metal." }];
    video.tracksArrive(track("metadata", ""), english);
    expect(activeCaptionLines(video)).toEqual([]);
    applyNativeCaptions(video, true);
    expect(english.mode).toBe("hidden");
    expect(activeCaptionLines(video)).toEqual(["Your new knee", "is made of metal."]);
  });
});

describe("captions with the browser's own HLS (Safari, iPhone)", () => {
  it("offers CC once the stream's caption track appears, off to start, and loads it hidden (drawn by us) when pressed", async () => {
    const video = fakeVideo();
    const { loader, state, press } = make(video, true);
    await loader.attach(stream("aaa"));
    expect(state.available.at(-1)).toBe(false);

    const english = track("subtitles", "en", "English");
    const metadata = track("metadata", "");
    video.tracksArrive(metadata, english);
    expect(state.available.at(-1)).toBe(true);
    expect(english.mode).toBe("disabled");

    press(true);
    expect(english.mode).toBe("hidden");
    expect(metadata.mode).toBe("disabled");
    press(false);
    expect(english.mode).toBe("disabled");
  });

  it("in an iPhone's own full-screen player the phone draws them ('showing'), and back on the page they are ours again", async () => {
    const video = fakeVideo();
    const { loader, press } = make(video, true);
    await loader.attach(stream("aaa"));
    const english = track("subtitles", "en");
    video.tracksArrive(english);
    press(true);
    video.fire("webkitbeginfullscreen");
    expect(english.mode).toBe("showing");
    video.fire("webkitendfullscreen");
    expect(english.mode).toBe("hidden");
  });

  it("never switches off a track the device's own settings switched on: takes it as CC on until the person presses CC off", async () => {
    const video = fakeVideo();
    const { loader, press, state } = make(video, true, async () => stream("bbb"));
    await loader.attach(stream("aaa"));
    const english = track("subtitles", "en");
    english.mode = "showing"; // what Safari does with captions asked for in the accessibility settings
    video.tracksArrive(english);
    // Taken as CC on: the button shows on, and the words are ours to draw (hidden), not switched off.
    expect(state.adopted).toEqual([true]);
    expect(english.mode).toBe("hidden");
    // A swap to a fresh address keeps them on.
    await loader.refreshNow();
    const fresh = track("subtitles", "en");
    fresh.mode = "showing";
    video.tracksArrive(fresh);
    expect(fresh.mode).toBe("hidden");
    // Only the person's own press turns them off, and that holds on the next stream even if the device switches it on.
    press(false);
    expect(fresh.mode).toBe("disabled");
    const again = track("subtitles", "en");
    again.mode = "showing";
    video.tracksArrive(again);
    expect(again.mode).toBe("disabled");
  });

  it("before any press, leaves the tracks as the browser has them (never forces anything off)", async () => {
    const video = fakeVideo();
    const { loader, state } = make(video, true);
    await loader.attach(stream("aaa"));
    const english = track("subtitles", "en");
    english.mode = "hidden"; // whatever the browser chose, left alone
    video.tracksArrive(english);
    expect(english.mode).toBe("hidden");
    expect(state.adopted).toEqual([]);
  });

  it("a choice made with the phone's own captions button in its full-screen player is the person's choice back on the page", async () => {
    const video = fakeVideo();
    const { loader, state } = make(video, true);
    await loader.attach(stream("aaa"));
    const english = track("subtitles", "en");
    video.tracksArrive(english);
    video.fire("webkitbeginfullscreen");
    english.mode = "showing"; // the person turns captions on with the phone's own button
    video.fire("webkitendfullscreen");
    expect(state.adopted).toEqual([true]);
    expect(english.mode).toBe("hidden"); // still on, drawn by our overlay now
    // And off again the same way, after pressing nothing of ours.
    video.fire("webkitbeginfullscreen");
    expect(english.mode).toBe("showing");
    english.mode = "disabled";
    video.fire("webkitendfullscreen");
    expect(state.adopted).toEqual([true, false]);
    expect(english.mode).toBe("disabled");
  });

  it("keeps CC on across a swap to a fresh address: the new stream's track comes on by itself", async () => {
    const video = fakeVideo();
    const { loader, press, state } = make(video, true, async () => stream("bbb"));
    await loader.attach(stream("aaa"));
    video.tracksArrive(track("subtitles", "en"));
    press(true);

    await loader.refreshNow();
    expect(video.src).toContain("bbb");
    const fresh = track("subtitles", "en");
    video.tracksArrive(fresh);
    expect(fresh.mode).toBe("hidden");
    expect(state.available.at(-1)).toBe(true);
  });

  it("stops listening when the player closes", async () => {
    const video = fakeVideo();
    const { loader } = make(video, true);
    await loader.attach(stream("aaa"));
    expect((video.textTracks as unknown as ReturnType<typeof events>).count("addtrack")).toBe(1);
    loader.destroy();
    expect((video.textTracks as unknown as ReturnType<typeof events>).count("addtrack")).toBe(0);
    expect((video as unknown as ReturnType<typeof events>).count("webkitbeginfullscreen")).toBe(0);
  });
});

describe("captions through hls.js (Chrome, Edge, Firefox, Android)", () => {
  it("offers CC when the playlist lists a subtitle track, keeps hls.js's track off while CC is off, and picks English when on", async () => {
    const video = fakeVideo();
    const { loader, hls, state, press } = make(video, false);
    await loader.attach(stream("aaa"));
    await settle();
    const [instance] = hls.instances;

    instance.subtitleTracks = [{ lang: "fr", name: "French" }, { lang: "en", name: "English" }];
    instance.fire("hlsManifestParsed", { subtitleTracks: instance.subtitleTracks });
    expect(state.available.at(-1)).toBe(true);
    instance.fire("hlsSubtitleTracksUpdated", { subtitleTracks: instance.subtitleTracks });
    // Off to start, even though hls.js had picked a track marked default by itself.
    expect(instance.subtitleTrack).toBe(-1);

    press(true);
    expect(instance.subtitleTrack).toBe(1);
    // hls.js loads the words onto a hidden track; the overlay draws them.
    expect(instance.subtitleDisplay).toBe(false);
    press(false);
    expect(instance.subtitleTrack).toBe(-1);
  });

  it("says there are none for a playlist with no subtitle tracks", async () => {
    const video = fakeVideo();
    const { loader, hls, state } = make(video, false);
    await loader.attach(stream("aaa"));
    await settle();
    hls.instances[0].fire("hlsManifestParsed", { subtitleTracks: [] });
    expect(state.available.at(-1)).toBe(false);
  });

  it("keeps CC on across a swap to a fresh address: the new hls.js instance loads the English track again", async () => {
    const video = fakeVideo();
    const { loader, hls, press, state } = make(video, false, async () => stream("bbb"));
    await loader.attach(stream("aaa"));
    await settle();
    hls.instances[0].subtitleTracks = [{ lang: "en", name: "English" }];
    hls.instances[0].fire("hlsManifestParsed", { subtitleTracks: hls.instances[0].subtitleTracks });
    press(true);
    expect(hls.instances[0].subtitleTrack).toBe(0);

    await loader.refreshNow();
    await settle();
    expect(hls.instances[0].destroyed).toBe(true);
    const fresh = hls.instances[1];
    fresh.subtitleTrack = -1;
    fresh.subtitleTracks = [{ lang: "en", name: "English" }];
    fresh.fire("hlsManifestParsed", { subtitleTracks: fresh.subtitleTracks });
    fresh.fire("hlsSubtitleTracksUpdated", { subtitleTracks: fresh.subtitleTracks });
    expect(fresh.subtitleTrack).toBe(0);
    expect(state.available.at(-1)).toBe(true);
    // Nothing said "no captions" in between, so the button did not flicker away during the swap.
    expect(state.available.slice(1)).not.toContain(false);
  });

  it("puts the viewer's choice back when hls.js switches the track by itself (seen in Chrome on a swap), and leaves an agreeing choice alone", async () => {
    const video = fakeVideo();
    const { loader, hls, press } = make(video, false);
    await loader.attach(stream("aaa"));
    await settle();
    const [instance] = hls.instances;
    instance.subtitleTracks = [{ lang: "en", name: "English" }];
    press(true);
    expect(instance.subtitleTrack).toBe(0);

    // hls.js, attaching, finds the reused text track off and switches to "none" on its own.
    instance.subtitleTrack = -1;
    instance.fire("hlsSubtitleTrackSwitch", { id: -1 });
    await settle();
    expect(instance.subtitleTrack).toBe(0);

    // CC off: a switch hls.js makes to a track marked default is undone the same way.
    press(false);
    instance.subtitleTrack = 0;
    instance.fire("hlsSubtitleTrackSwitch", { id: 0 });
    await settle();
    expect(instance.subtitleTrack).toBe(-1);
  });

  it("an old instance's late news changes nothing once it has been replaced", async () => {
    const video = fakeVideo();
    const { loader, hls, state } = make(video, false, async () => stream("bbb"));
    await loader.attach(stream("aaa"));
    await settle();
    await loader.refreshNow();
    await settle();
    const before = state.available.length;
    hls.instances[0].fire("hlsManifestParsed", { subtitleTracks: [] });
    expect(state.available.length).toBe(before);
  });
});

describe("a plain file", () => {
  it("never offers captions (a CDN MP4 has no caption track)", async () => {
    const video = fakeVideo();
    const { loader, state } = make(video, false);
    await loader.attach({ kind: "file", src: "https://cdn.example.test/knee.mp4" });
    expect(state.available).toEqual([false]);
  });
});

describe("the CC button and the words on the picture", () => {
  const noop = () => {};
  const controls = {
    playing: true,
    finished: false,
    time: 0,
    duration: 100,
    muted: false,
    fullscreen: false,
    showing: true,
    reveal: noop,
    hide: noop,
    onFocusIn: noop,
    onFocusOut: noop,
    togglePlay: noop,
    seekBy: noop,
    seekTo: noop,
    toggleMute: noop,
    toggleFullscreen: noop,
    onPictureTap: noop,
    onKey: noop,
    onKeyUp: noop,
  } as PlayerControls;

  function render(captions: Partial<PlayerCaptions> | null, overrides: Partial<PlayerControls> = {}) {
    const full = captions === null ? null : { available: true, on: false, toggle: noop, lines: [], ...captions };
    return renderToStaticMarkup(
      <PlayerOverlay controls={{ ...controls, ...overrides }} title="Total Knee Replacement" clinicName="Summit Orthopedics" logoUrl={null} senderName={null} showControls slow={false} captions={full} />,
    );
  }

  it("is there only when the video has a caption track", () => {
    expect(render(null)).not.toContain('aria-label="Captions"');
    expect(render({ available: false })).not.toContain('aria-label="Captions"');
    expect(render({ available: true })).toContain('aria-label="Captions"');
  });

  it("is labelled, 44px, and says whether captions are on, off to start", () => {
    const off = render({ available: true, on: false });
    const button = off.match(/<button[^>]*aria-label="Captions"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain("h-11 w-11");
    expect(button).toContain('title="Captions off"');
    expect(render({ available: true, on: true })).toMatch(/aria-label="Captions" aria-pressed="true"/);
  });

  it("draws the words being said while on, as text, lifted above the controls when they are up and low when they fade", () => {
    const up = render({ on: true, lines: ["Your new knee", "<is made of metal>"] });
    // The cue's lines joined into one band, wrapped to the picture (a phone would otherwise wrap each line again).
    expect(up).toContain("Your new knee &lt;is made of metal&gt;");
    expect(up).toMatch(/data-captions="" aria-hidden="true" class="[^"]*bottom-\[92px\]/);
    // On a phone (touch, small player) they step aside while the controls are up, rather than sit under the middle buttons.
    expect(up).toMatch(/data-captions="" aria-hidden="true" class="[^"]*bottom-\[92px\] hidden computer:flex @3xl:flex/);
    const faded = render({ on: true, lines: ["Your new knee"] }, { showing: false });
    expect(faded).toMatch(/data-captions="" aria-hidden="true" class="[^"]*flex bottom-3 /);
    expect(faded).not.toContain(" hidden ");
  });

  it("draws nothing while off", () => {
    expect(render({ on: false, lines: ["Your new knee"] })).not.toContain("data-captions");
  });
});
