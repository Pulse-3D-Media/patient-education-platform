import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pingDatabase } from "@/lib/db/health";
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
