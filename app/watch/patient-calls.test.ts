import { describe, expect, it, vi } from "vitest";
import { recordPlay, refreshPlayback, requestReactivation } from "./patient-calls";

/**
 * The browser's side of the three patient routes, with a stand-in fetch:
 * where each call goes (always a POST under /watch, never cached), how each
 * answer is read, and that anything but a well-formed answer becomes the calm
 * "no" the caller already handles, never a thrown error.
 */

const FILE = { kind: "file", src: "https://example.com/v.mp4" } as const;

/** A stand-in fetch that answers every request with this status and body, and remembers what it was asked. */
function answering(status: number, body: unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
}

describe("where each call goes", () => {
  it("posts to /watch/<code>/play, /refresh and /ask with no body and no caching", async () => {
    const fetcher = answering(200, {});
    await recordPlay("k7m2xq", fetcher as typeof fetch);
    await refreshPlayback("k7m2xq", fetcher as typeof fetch);
    await requestReactivation("k7m2xq", fetcher as typeof fetch);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/watch/k7m2xq/play", "/watch/k7m2xq/refresh", "/watch/k7m2xq/ask"]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: "POST", cache: "no-store" });
      expect(init?.body).toBeUndefined();
    }
  });

  it("makes exactly one try, as the Server Actions did", async () => {
    const fetcher = answering(500, {});
    await recordPlay("k7m2xq", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("recordPlay", () => {
  it("reads a counted play, with and without a fresh grant", async () => {
    expect(await recordPlay("c", answering(200, { recorded: true }) as typeof fetch)).toEqual({ recorded: true });
    expect(await recordPlay("c", answering(200, { recorded: true, playback: FILE }) as typeof fetch)).toEqual({ recorded: true, playback: FILE });
    // Something that is not a source is never handed to the player.
    expect(await recordPlay("c", answering(200, { recorded: true, playback: { kind: "nonsense" } }) as typeof fetch)).toEqual({ recorded: true });
  });

  it("is recorded: false for a refusal, a failure, the firewall's limit, junk, or no answer at all", async () => {
    for (const fetcher of [answering(200, { recorded: false }), answering(400, { recorded: false }), answering(500, { recorded: true }), answering(429, "Too Many Requests"), answering(200, "not json")]) {
      expect(await recordPlay("c", fetcher as typeof fetch)).toEqual({ recorded: false });
    }
    const dropped = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await recordPlay("c", dropped as typeof fetch)).toEqual({ recorded: false });
  });
});

describe("refreshPlayback", () => {
  it("hands back a fresh source, or ended when the server says the link is over", async () => {
    expect(await refreshPlayback("c", answering(200, { ok: true, source: FILE }) as typeof fetch)).toEqual({ ok: true, source: FILE });
    expect(await refreshPlayback("c", answering(200, { ok: false, reason: "ended" }) as typeof fetch)).toEqual({ ok: false, reason: "ended" });
    expect(await refreshPlayback("c", answering(400, { ok: false, reason: "ended" }) as typeof fetch)).toEqual({ ok: false, reason: "ended" });
  });

  it("is unavailable (tried again shortly by the player) for a failure, the firewall's limit, junk or no answer, never ended", async () => {
    for (const fetcher of [answering(200, { ok: false, reason: "unavailable" }), answering(500, { ok: false, reason: "ended" }), answering(429, ""), answering(200, { ok: true, source: { kind: "x" } })]) {
      expect(await refreshPlayback("c", fetcher as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
    }
    const dropped = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await refreshPlayback("c", dropped as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("requestReactivation", () => {
  it("is asked: true only when the server says so", async () => {
    expect(await requestReactivation("c", answering(200, { asked: true }) as typeof fetch)).toEqual({ asked: true });
    for (const fetcher of [answering(200, { asked: false }), answering(400, { asked: false }), answering(500, { asked: true }), answering(429, "")]) {
      expect(await requestReactivation("c", fetcher as typeof fetch)).toEqual({ asked: false });
    }
    const dropped = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await requestReactivation("c", dropped as typeof fetch)).toEqual({ asked: false });
  });
});
