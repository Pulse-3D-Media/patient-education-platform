import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduled route's door and its answer: no secret set and a wrong secret
 * are refused before anything runs; the right one runs the job and answers
 * with counts only. The job itself is a stand-in here (it has its own tests
 * against the database in lib/setup-reminder-run.test.ts).
 */

vi.mock("@/lib/setup-reminder-run", () => ({ runSetupReminders: vi.fn() }));
const { runSetupReminders } = await import("@/lib/setup-reminder-run");
const { GET } = await import("./route");

const SECRET = "madeUpCronSecretForRouteTests42";
const call = (authorization?: string) =>
  GET(new Request("https://app.example.test/api/cron/setup-reminders", { headers: authorization ? { authorization } : {} }));

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.mocked(runSetupReminders).mockReset();
  const keep = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "log").mockImplementation(keep);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/setup-reminders", () => {
  it("with no CRON_SECRET set, refuses every call and runs nothing (fails closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const header of [undefined, "Bearer ", `Bearer ${SECRET}`]) {
      const response = await call(header);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("not configured");
    }
    expect(runSetupReminders).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret and runs nothing", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const header of [undefined, "Bearer wrong-but-long-enough-secret", SECRET, `Bearer ${SECRET}x`, `Basic ${SECRET}`]) {
      const response = await call(header);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(runSetupReminders).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("with the right secret, runs the job once and answers with counts only", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.mocked(runSetupReminders).mockResolvedValue({ configured: true, checked: 2, sent: 1, skipped: 1, failed: 0, more: false });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, configured: true, checked: 2, sent: 1, skipped: 1, failed: 0, more: false });
    expect(runSetupReminders).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("a run that fails answers 500 with nothing in it, and logs only the kind", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.mocked(runSetupReminders).mockRejectedValue(Object.assign(new Error("postgres://user:pw@host/db is down"), { name: "PrismaClientInitializationError" }));
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    const all = logs.join("\n");
    expect(all).toContain("PrismaClientInitializationError");
    expect(all).not.toContain("postgres://");
  });
});
