import { describe, expect, it, vi } from "vitest";
import { acceptDisclaimer } from "./accept-disclaimer";

/**
 * The browser's side of the "for education only" box, with a stand-in for the
 * network and the waiting: where it posts, what each answer becomes, and that
 * a request that got no answer is tried again, at most three times, before
 * the player is told to offer Try again.
 */

const V = "2026-10-08";
const noWait = async () => {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const FILE = { kind: "file", src: "https://example.com/v.mp4" };

describe("acceptDisclaimer", () => {
  it("posts only the version to the link's own accept address, and hands back the video", async () => {
    const fetcher = vi.fn(async () => json(200, { source: FILE }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher as never, noWait)).toEqual({ kind: "ready", source: FILE });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/watch/k7m2xq4v9p/accept");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({ version: V });
  });

  it("posts to the printed code's accept address on a printed code's page", async () => {
    const fetcher = vi.fn(async () => json(200, { source: FILE }));
    await acceptDisclaimer({ kind: "printed", code: "abcdefghijklmnopqrstuvwx1" }, V, fetcher as never, noWait);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("/q/abcdefghijklmnopqrstuvwx1/accept");
  });

  it("says 'not-working' when the server has nothing to play, and does not ask again", async () => {
    const fetcher = vi.fn(async () => json(200, { source: null }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher as never, noWait)).toEqual({ kind: "not-working" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("says 'stale' on a 409, so the player reloads the page", async () => {
    const fetcher = vi.fn(async () => json(409, { source: null }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher as never, noWait)).toEqual({ kind: "stale" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("tries again after a dropped connection, a server failure or the firewall's limit, then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { source: FILE }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher, noWait)).toEqual({ kind: "ready", source: FILE });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("gives up after three tries with 'failed', so the player offers Try again", async () => {
    const fetcher = vi.fn(async () => json(500, { source: null }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher as never, noWait)).toEqual({ kind: "failed" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not ask again after a 400, and never hands the player something that is not a source", async () => {
    const refused = vi.fn(async () => json(400, { source: null }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, refused as never, noWait)).toEqual({ kind: "failed" });
    expect(refused).toHaveBeenCalledTimes(1);

    const odd = vi.fn(async () => json(200, { source: { kind: "script", src: "javascript:alert(1)" } }));
    expect(await acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, odd as never, noWait)).toEqual({ kind: "not-working" });
  });

  it("abandons a try that never answers, so a stuck connection ends in Try again rather than a frozen page", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const answer = acceptDisclaimer({ kind: "link", code: "k7m2xq4v9p" }, V, fetcher as never, noWait);
      await vi.advanceTimersByTimeAsync(3 * 10_000 + 100);
      expect(await answer).toEqual({ kind: "failed" });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
