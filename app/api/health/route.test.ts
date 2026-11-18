import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pingDatabase } from "@/lib/db/health";
import { forgetHealthAnswer, HEALTH_MEMORY_MS } from "@/lib/health";
import { GET } from "./route";

/**
 * The health check route with the database ping replaced by a stand-in, so
 * each answer can be forced: reached, failed, and never answering. What
 * these prove: the two answers and their status codes, that nothing but
 * {"ok":...} is ever in the body, that the answer is never cached, and that
 * a database that does not answer ends in "not ok" after the limit rather
 * than a request that hangs.
 */

vi.mock("@/lib/db/health", () => ({ pingDatabase: vi.fn() }));

const CONNECTION_STRING = "postgresql://neondb_owner:hunter2@ep-secret-host-123456.example.neon.tech/neondb";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  forgetHealthAnswer();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 {\"ok\":true} when the database can be reached, and is never cached", async () => {
    vi.mocked(pingDatabase).mockResolvedValue(undefined);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("answers 503 {\"ok\":false} when the database fails, with the failure's kind in the log and nothing in the body", async () => {
    const failure = Object.assign(new Error(`Can't reach database server at ${CONNECTION_STRING}`), { name: "PrismaClientInitializationError" });
    vi.mocked(pingDatabase).mockRejectedValue(failure);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls[0].join(" ");
    expect(logged).toContain("PrismaClientInitializationError");
    expect(logged).not.toContain(CONNECTION_STRING);
    expect(logged).not.toContain("hunter2");
  });

  it("answers 503 after five seconds when the database never answers, rather than hanging", async () => {
    vi.useFakeTimers();
    vi.mocked(pingDatabase).mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
    expect(vi.mocked(console.error).mock.calls[0].join(" ")).toContain("TimeoutError");
  });
});

describe("the answer is remembered for a few seconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00.000Z"));
  });

  it("remembers for five seconds, a constant", () => {
    expect(HEALTH_MEMORY_MS).toBe(5_000);
  });

  it("a burst of calls at once is one query, and every caller gets the same answer", async () => {
    let answerNow: () => void = () => {};
    vi.mocked(pingDatabase).mockReturnValue(new Promise<void>((resolve) => (answerNow = resolve)));
    const pending = Array.from({ length: 20 }, () => GET());
    answerNow();
    const responses = await Promise.all(pending);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers from memory until five seconds have passed, then asks the database again", async () => {
    vi.mocked(pingDatabase).mockResolvedValue(undefined);
    await GET();
    await vi.advanceTimersByTimeAsync(4_999);
    expect((await GET()).status).toBe(200);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await GET()).status).toBe(200);
    expect(pingDatabase).toHaveBeenCalledTimes(2);
  });

  it("remembers a failure too, logs it once, and says ok again once the memory runs out and the database is back", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(Object.assign(new Error("down"), { name: "PrismaClientInitializationError" }));
    expect((await GET()).status).toBe(503);
    const second = await GET();
    expect(second.status).toBe(503);
    expect(await second.text()).toBe('{"ok":false}');
    expect(pingDatabase).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);

    vi.mocked(pingDatabase).mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await GET()).status).toBe(200);
    expect(pingDatabase).toHaveBeenCalledTimes(2);
  });

  it("a database that never answers is 'not ok' after the five-second limit, and that is remembered as well", async () => {
    vi.mocked(pingDatabase).mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(503);
    expect((await GET()).status).toBe(503);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
  });
});
