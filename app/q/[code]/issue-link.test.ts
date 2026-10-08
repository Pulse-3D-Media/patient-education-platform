import { describe, expect, it, vi } from "vitest";
import { issueLink, newVisitKey } from "./issue-link";
import { isAttemptKey } from "@/lib/qr-code";

/**
 * The browser's side of a printed code's Play tap, with a stand-in for the
 * network and the waiting: what each answer becomes, and that a request that
 * got no answer is sent again WITH THE SAME KEY (so it can never make a
 * second link), at most three times.
 */

const noWait = async () => {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("issueLink", () => {
  it("returns the link the server made, posting only the key to the code's own address", async () => {
    const fetcher = vi.fn(async () => json(200, { code: "k7m2xq4v9p8a7b6c" }));
    expect(await issueLink("abcdefghijklmnopqrstuvwx1", "key-1234567890abcdef", fetcher as never, noWait)).toEqual({ kind: "issued", code: "k7m2xq4v9p8a7b6c" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/q/abcdefghijklmnopqrstuvwx1/issue");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ key: "key-1234567890abcdef" });
  });

  it("says 'unavailable' when the server says there is no link, and does not ask again", async () => {
    const fetcher = vi.fn(async () => json(200, { code: null }));
    expect(await issueLink("abcdefghijklmnopqrstuvwx1", "key-1234567890abcdef", fetcher as never, noWait)).toEqual({ kind: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks again with the same key after a dropped connection or a server failure, then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json(500, { code: null }))
      .mockResolvedValueOnce(json(200, { code: "k7m2xq4v9p8a7b6c" }));
    expect(await issueLink("abcdefghijklmnopqrstuvwx1", "same-key-1234567890", fetcher, noWait)).toEqual({ kind: "issued", code: "k7m2xq4v9p8a7b6c" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const keys = fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).key);
    expect(new Set(keys)).toEqual(new Set(["same-key-1234567890"]));
  });

  it("gives up after three tries with 'failed', so the player can ask again later", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await issueLink("abcdefghijklmnopqrstuvwx1", "key-1234567890abcdef", fetcher as never, noWait)).toEqual({ kind: "failed" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("makes a fresh key each visit, shaped the way the server accepts", () => {
    const a = newVisitKey();
    const b = newVisitKey();
    expect(a).not.toBe(b);
    expect(isAttemptKey(a)).toBe(true);
  });
});
