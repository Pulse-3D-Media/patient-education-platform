import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_LEAD_MS, TOKEN_LIFETIME_MS, type PlaybackSource } from "@/lib/playback-source";
import { RETRY_REFRESH_MS, SourceLoader, type LoaderHooks } from "./video-source-loader";

/**
 * The loader behind both players, with a stand-in <video> element, a
 * stand-in hls.js and the clock under the test's control. No browser. What
 * these prove:
 *
 *   - a plain file already on the element is left alone; a stream goes on
 *     through the browser's own HLS where it has it, and through hls.js,
 *     loaded only then, everywhere else;
 *   - a little before a signed address runs out the server is asked, and
 *     the fresh address replaces the old one where the video was, playing
 *     if it was playing;
 *   - when the server says access has ended, nothing is renewed and the
 *     player is told; a passing failure is tried again later;
 *   - an unavailable source shows the panel at once and never a CDN file;
 *   - Try again fetches a fresh address when the old one has run out;
 *   - closing the player takes hls.js down and stops the timers, so a late
 *     answer changes nothing;
 *   - a stream failure is logged by its kind, never with the address.
 *
 * A real browser, a real Mux token and a real phone are the browser check.
 */

const NOW = 1_800_000_000_000;

/** Enough of a <video> element for the loader. */
function fakeElement(nativeHls = false) {
  const listeners = new Map<string, Set<() => void>>();
  const element = {
    attributes: new Map<string, string>(),
    src: "",
    currentTime: 0,
    duration: 120,
    paused: true,
    ended: false,
    loads: 0,
    plays: 0,
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    load() {
      this.loads++;
    },
    play() {
      this.plays++;
      this.paused = false;
      return Promise.resolve();
    },
    canPlayType() {
      return nativeHls ? "maybe" : "";
    },
    addEventListener(name: string, fn: () => void) {
      (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(fn);
    },
    removeEventListener(name: string, fn: () => void) {
      listeners.get(name)?.delete(fn);
    },
    fire(name: string) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn();
    },
  };
  return element as typeof element & HTMLVideoElement;
}

/** A stand-in for the hls.js module: records what is done to it and can be made to fail. */
function fakeHls(supported = true) {
  const instances: { source: string | null; media: unknown; destroyed: boolean; config: { startPosition: number }; handlers: Map<string, (event: string, data: unknown) => void> }[] = [];
  class Hls {
    static isSupported() {
      return supported;
    }
    static Events = { ERROR: "hlsError" };
    record = { source: null as string | null, media: null as unknown, destroyed: false, config: { startPosition: -1 }, handlers: new Map<string, (event: string, data: unknown) => void>() };
    constructor(config: { startPosition: number }) {
      this.record.config = config;
      instances.push(this.record);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.record.handlers.set(event, handler);
    }
    loadSource(url: string) {
      this.record.source = url;
    }
    attachMedia(media: unknown) {
      this.record.media = media;
    }
    destroy() {
      this.record.destroyed = true;
    }
  }
  const loads = { count: 0 };
  const loadHls = async () => {
    loads.count++;
    return { default: Hls } as unknown as typeof import("hls.js");
  };
  return { instances, loadHls, loads };
}

function stream(id: string, expiresAt = NOW + TOKEN_LIFETIME_MS): PlaybackSource {
  return { kind: "stream", src: `https://stream.mux.com/${id}.m3u8?token=t-${id}`, poster: `https://image.mux.com/${id}/thumbnail.jpg?token=p-${id}`, expiresAt };
}

function make(element: ReturnType<typeof fakeElement>, hooks: Partial<LoaderHooks>, hls = fakeHls(), native = false) {
  const full: LoaderHooks = { onFailure: vi.fn(), ...hooks };
  const loader = new SourceLoader({ getElement: () => element, getHooks: () => full, loadHls: hls.loadHls, now: () => Date.now(), prefersNativeHls: () => native });
  return { loader, hooks: full, hls };
}

/** Let the queued promises settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a plain file", () => {
  it("is left alone when the page already put it on the element, and hls.js is never loaded", async () => {
    const element = fakeElement();
    element.attributes.set("src", "https://cdn.example.com/a.mp4");
    const { loader, hls } = make(element, {});
    await loader.attach({ kind: "file", src: "https://cdn.example.com/a.mp4" });
    expect(element.loads).toBe(0);
    expect(hls.loads.count).toBe(0);
  });

  it("is reloaded and played by Try again", async () => {
    const element = fakeElement();
    element.attributes.set("src", "https://cdn.example.com/a.mp4");
    const { loader } = make(element, {});
    await loader.attach({ kind: "file", src: "https://cdn.example.com/a.mp4" });
    await loader.reload(42);
    expect(element.loads).toBe(1);
    expect(element.plays).toBe(1);
  });
});

describe("a stream", () => {
  it("goes straight on the element where the browser plays HLS itself, with hls.js never loaded", async () => {
    const element = fakeElement(true);
    const { loader, hls } = make(element, {}, fakeHls(), true);
    await loader.attach(stream("a"));
    expect(element.src).toBe("https://stream.mux.com/a.m3u8?token=t-a");
    expect(element.loads).toBe(1);
    expect(hls.loads.count).toBe(0);
  });

  it("goes through hls.js, loaded only then, everywhere else", async () => {
    const element = fakeElement();
    const { loader, hls } = make(element, {});
    await loader.attach(stream("a"));
    expect(hls.loads.count).toBe(1);
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0].source).toBe("https://stream.mux.com/a.m3u8?token=t-a");
    expect(hls.instances[0].media).toBe(element);
    expect(element.src).toBe("");
  });

  it("tells the player when hls.js is not supported and the browser has no HLS of its own, or when hls.js did not arrive", async () => {
    const { loader, hooks } = make(fakeElement(), {}, fakeHls(false));
    await loader.attach(stream("a"));
    expect(hooks.onFailure).toHaveBeenCalledOnce();

    // No MediaSource after all, but the browser claims HLS of its own (an old iPhone, say): that is the last resort.
    const claims = fakeElement(true);
    const last = make(claims, {}, fakeHls(false));
    await last.loader.attach(stream("a"));
    expect(last.hooks.onFailure).not.toHaveBeenCalled();
    expect(claims.src).toBe("https://stream.mux.com/a.m3u8?token=t-a");

    const failing = { loadHls: async () => Promise.reject(new Error("offline")), instances: [], loads: { count: 0 } };
    const other = make(fakeElement(), {}, failing as never);
    await other.loader.attach(stream("a"));
    expect(other.hooks.onFailure).toHaveBeenCalledOnce();
  });

  it("reports a fatal stream failure to the player, logging its kind and never the address", async () => {
    const element = fakeElement();
    const { loader, hooks, hls } = make(element, {});
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loader.attach(stream("a"));
    const onError = hls.instances[0].handlers.get("hlsError")!;
    onError("hlsError", { fatal: false, type: "networkError", details: "fragLoadError", url: "https://stream.mux.com/a.m3u8?token=t-a" });
    expect(hooks.onFailure).not.toHaveBeenCalled();
    onError("hlsError", { fatal: true, type: "networkError", details: "levelLoadError", url: "https://stream.mux.com/a.m3u8?token=t-a" });
    expect(hooks.onFailure).toHaveBeenCalledOnce();
    expect(log.mock.calls[0].join(" ")).not.toContain("token");
    expect(log.mock.calls[0].join(" ")).toContain("levelLoadError");
  });
});

describe("refreshing before the token runs out", () => {
  it("asks the server a little before expiry and swaps to the fresh address where the video was, still playing", async () => {
    const element = fakeElement();
    element.currentTime = 37;
    element.paused = false;
    const refresh = vi.fn(async () => stream("b", NOW + 2 * TOKEN_LIFETIME_MS));
    const { loader, hls } = make(element, { refresh });
    await loader.attach(stream("a"));

    await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS - REFRESH_LEAD_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    expect(hls.instances).toHaveLength(2);
    expect(hls.instances[0].destroyed).toBe(true);
    expect(hls.instances[1].source).toBe("https://stream.mux.com/b.m3u8?token=t-b");
    expect(hls.instances[1].config.startPosition).toBe(37);
    expect(element.plays).toBe(1);
    expect(loader.source).toEqual(stream("b", NOW + 2 * TOKEN_LIFETIME_MS));
  });

  it("does not play a video that was paused when the swap came", async () => {
    const element = fakeElement();
    element.currentTime = 10;
    const { loader } = make(element, { refresh: async () => stream("b") });
    await loader.attach(stream("a"));
    await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS);
    await settle();
    expect(element.plays).toBe(0);
  });

  it("renews nothing and tells the player when the server says access has ended", async () => {
    const element = fakeElement();
    const onEnded = vi.fn();
    const refresh = vi.fn(async () => null);
    const { loader, hls } = make(element, { refresh, onEnded });
    await loader.attach(stream("a"));
    await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS);
    await settle();
    expect(onEnded).toHaveBeenCalledOnce();
    expect(hls.instances[0].destroyed).toBe(true);
    // No more asking.
    await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("tries again shortly after a passing failure, and after the server threw", async () => {
    const element = fakeElement();
    const answers: (PlaybackSource | Error)[] = [new Error("lost"), { kind: "unavailable" }, stream("b", NOW + 3 * TOKEN_LIFETIME_MS)];
    const refresh = vi.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const { loader, hls } = make(element, { refresh });
    await loader.attach(stream("a", NOW + 10 * 60_000));
    await vi.advanceTimersByTimeAsync(10 * 60_000 - REFRESH_LEAD_MS);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_REFRESH_MS);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_REFRESH_MS);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(hls.instances.at(-1)?.source).toBe("https://stream.mux.com/b.m3u8?token=t-b");
  });

  it("never asks when the player has no way to ask", async () => {
    const { loader, hls } = make(fakeElement(), {});
    await loader.attach(stream("a"));
    await vi.advanceTimersByTimeAsync(2 * TOKEN_LIFETIME_MS);
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0].destroyed).toBe(false);
  });
});

describe("unavailable, Try again and closing", () => {
  it("shows the panel at once for an unavailable source, and Try again asks the server", async () => {
    const refresh = vi.fn(async () => stream("b"));
    const { loader, hooks, hls } = make(fakeElement(), { refresh });
    await loader.attach({ kind: "unavailable" });
    expect(hooks.onFailure).toHaveBeenCalledOnce();
    expect(hls.loads.count).toBe(0);
    await loader.reload(0);
    expect(refresh).toHaveBeenCalledOnce();
    expect(hls.instances[0].source).toBe("https://stream.mux.com/b.m3u8?token=t-b");
  });

  it("Try again fetches a fresh address once the old token has run out, and the same one before", async () => {
    const element = fakeElement();
    const refresh = vi.fn(async () => stream("b", NOW + 5 * TOKEN_LIFETIME_MS));
    const { loader, hls } = make(element, { refresh });
    await loader.attach(stream("a", NOW + 10_000));
    await loader.reload(5);
    expect(refresh).not.toHaveBeenCalled();
    expect(hls.instances[1].source).toBe("https://stream.mux.com/a.m3u8?token=t-a");
    expect(hls.instances[1].config.startPosition).toBe(5);
    expect(element.plays).toBe(1);

    vi.setSystemTime(NOW + 20_000);
    await loader.reload(5);
    expect(refresh).toHaveBeenCalledOnce();
    expect(hls.instances[2].source).toBe("https://stream.mux.com/b.m3u8?token=t-b");
  });

  it("closing takes hls.js down, stops the timers, and ignores a late answer", async () => {
    const element = fakeElement();
    let answer: (value: PlaybackSource) => void = () => {};
    const refresh = vi.fn(() => new Promise<PlaybackSource>((resolve) => (answer = resolve)));
    const { loader, hls, hooks } = make(element, { refresh, onEnded: vi.fn() });
    await loader.attach(stream("a"));
    await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS);
    expect(refresh).toHaveBeenCalledOnce();
    loader.destroy();
    expect(hls.instances[0].destroyed).toBe(true);
    answer(stream("b"));
    await settle();
    expect(hls.instances).toHaveLength(1);
    expect(hooks.onFailure).not.toHaveBeenCalled();
  });
});
