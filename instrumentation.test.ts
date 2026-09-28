import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailIsConfigured, sendEmail } from "@/lib/email";
import { ALERT_WINDOW_MS } from "@/lib/error-report";
import { forgetSentAlerts, onRequestError } from "./instrumentation";

/**
 * What happens when Next.js reports a server error, with the email service
 * a stand-in and the clock the test's. What these prove: one scrubbed log
 * line always; no email without the setting, or without the email
 * service configured; one email per distinct error per ten-minute window,
 * under the key that makes repeats harmless; and a refused send logged as
 * a reason only, never thrown. Nothing sensitive in any of it.
 */

vi.mock("@/lib/email", () => ({ emailIsConfigured: vi.fn(), sendEmail: vi.fn() }));

const CONNECTION_STRING = "postgresql://neondb_owner:hunter2@ep-secret-host-123456.example.neon.tech/neondb";
const SHARE_CODE = "k7m2xq";
const NOW = new Date("2026-09-28T14:03:11.000Z");

const request = { path: `/watch/${SHARE_CODE}`, method: "GET", headers: { cookie: "__session=secret.token" } };
const context = { routerKind: "App Router" as const, routePath: "/watch/[code]", routeType: "render" as const, revalidateReason: undefined };

function failure(digest = "1234567890") {
  return Object.assign(new Error(`Can't reach database server at ${CONNECTION_STRING}`), { digest });
}

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const name of ["ERROR_ALERT_EMAIL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  forgetSentAlerts();
  vi.mocked(emailIsConfigured).mockReturnValue(true);
  vi.mocked(sendEmail).mockResolvedValue({ sent: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Every line logged so far, joined. */
const logged = () => vi.mocked(console.error).mock.calls.map((call) => call.join(" ")).join("\n");

describe("onRequestError", () => {
  it("always writes one scrubbed line to the server log", async () => {
    await onRequestError(failure(), request, context);
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = logged();
    expect(line).toContain("Request error:");
    expect(line).toContain('"route":"/watch/[code]"');
    expect(line).toContain('"digest":"1234567890"');
    expect(line).toContain('"environment":"local"');
    expect(line).not.toContain(SHARE_CODE);
    expect(line).not.toContain(CONNECTION_STRING);
    expect(line).not.toContain("secret.token");
  });

  it("sends nothing when ERROR_ALERT_EMAIL is not set", async () => {
    await onRequestError(failure(), request, context);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when the address is set but email is not configured", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test";
    vi.mocked(emailIsConfigured).mockReturnValue(false);
    await onRequestError(failure(), request, context);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails once per distinct error per ten minutes, under the key that makes repeats harmless", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test, van@example.test";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";

    await onRequestError(failure(), request, context);
    await onRequestError(failure(), request, context);
    await onRequestError(failure(), request, context);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.to).toEqual(["evan@example.test", "van@example.test"]);
    expect(message.subject).toBe("Pulse 3D app: an error on production (/watch/[code])");
    expect(message.idempotencyKey).toMatch(/^error-alert-1234567890-\d+$/);
    expect(message.text).toContain("commit abcdef1");
    expect(message.text).not.toContain(SHARE_CODE);
    expect(message.text).not.toContain(CONNECTION_STRING);
    expect(message.text).not.toContain("secret.token");

    // A different error is a different message.
    await onRequestError(failure("9876543210"), request, context);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendEmail).mock.calls[1][0].idempotencyKey).toMatch(/^error-alert-9876543210-\d+$/);

    // The first error again once its window has passed: a new message, a new key.
    vi.setSystemTime(new Date(NOW.getTime() + ALERT_WINDOW_MS));
    await onRequestError(failure(), request, context);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendEmail).mock.calls[2][0].idempotencyKey).not.toBe(message.idempotencyKey);
  });

  it("logs a refused send as a reason only, and never throws", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test";
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "refused" });
    await expect(onRequestError(failure(), request, context)).resolves.toBeUndefined();
    expect(logged()).toContain("Error alert: the email was not sent. refused");
    expect(logged()).not.toContain(CONNECTION_STRING);
  });
});
