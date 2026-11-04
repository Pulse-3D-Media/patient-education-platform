import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailIsConfigured, sendEmail } from "@/lib/email";
import { after } from "next/server";
import { ALERT_CEILING, ALERT_WINDOW_MS } from "@/lib/error-report";
import { forgetSentAlerts, onRequestError } from "./instrumentation";

/**
 * What happens when Next.js reports a server error, with the email service
 * a stand-in and the clock the test's. What these prove: one scrubbed log
 * line always; no email without the setting, or without the email
 * service configured; one email per distinct error per ten-minute window,
 * under the key that makes repeats harmless; a ceiling per route, kind and
 * error name, with one note past it, that holds across servers and while
 * sends are still on their way; the send handed to the platform to finish;
 * and a refused send logged as a reason only, never thrown. Nothing sensitive
 * in any of it.
 */

vi.mock("@/lib/email", () => ({ emailIsConfigured: vi.fn(), sendEmail: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

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
    expect(message.idempotencyKey).toMatch(/^error-alert-production-_watch__code_-page-Error-1-\d+$/);
    expect(message.text).toContain("commit abcdef1");
    expect(message.text).not.toContain(SHARE_CODE);
    expect(message.text).not.toContain(CONNECTION_STRING);
    expect(message.text).not.toContain("secret.token");

    // A different error is a different message.
    await onRequestError(failure("9876543210"), request, context);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendEmail).mock.calls[1][0].idempotencyKey).toMatch(/^error-alert-production-_watch__code_-page-Error-2-\d+$/);

    // The first error again once its window has passed: a new message, a new key.
    vi.setSystemTime(new Date(NOW.getTime() + ALERT_WINDOW_MS));
    await onRequestError(failure(), request, context);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendEmail).mock.calls[2][0].idempotencyKey).not.toBe(message.idempotencyKey);
  });

  describe("the ceiling per route, kind and error name", () => {
    const actionRequest = { method: "POST", path: "/sign-in", headers: {} };
    const actionContext = { routerKind: "App Router" as const, routePath: "/sign-in/[[...sign-in]]/page", routeType: "action" as const, revalidateReason: undefined };
    const parseFailure = (n: number) => Object.assign(new SyntaxError(`Unexpected token 'a', "a${n}" is not valid JSON`), { digest: String(1000 + n) });
    const report = (n: number) => onRequestError(parseFailure(n), actionRequest, actionContext);
    const sent = () => vi.mocked(sendEmail).mock.calls.map((call) => call[0]);
    const logLines = () => vi.mocked(console.error).mock.calls.filter((call) => call[0] === "Request error:");

    beforeEach(() => {
      process.env.ERROR_ALERT_EMAIL = "alerts@example.test";
    });

    it("sends the ceiling's worth of alerts and one note however many different errors arrive, and logs every one", async () => {
      for (let n = 0; n < 50; n++) await report(n);

      expect(logLines()).toHaveLength(50);
      expect(sent()).toHaveLength(ALERT_CEILING + 1);
      const note = sent()[ALERT_CEILING];
      expect(note.subject).toContain("error alerts held back");
      expect(note.idempotencyKey).toMatch(/^error-alert-held-back-/);
      for (const message of sent().slice(0, ALERT_CEILING)) expect(message.subject).toContain("an error on");
    });

    it("sends no note until an alert has really been held back", async () => {
      for (let n = 0; n < ALERT_CEILING; n++) await report(n);
      // Repeats of errors already alerted are not held back alerts.
      await report(0);
      await report(1);
      expect(sent()).toHaveLength(ALERT_CEILING);
      await report(99);
      expect(sent()).toHaveLength(ALERT_CEILING + 1);
    });

    it("counts while emails are still on their way: nothing is waited for before the claim", async () => {
      // The email service never answers, and nobody awaits, which is how Next.js calls this on a Server Action.
      vi.mocked(sendEmail).mockReturnValue(new Promise(() => {}));
      for (let n = 0; n < 20; n++) void report(n);
      expect(sent()).toHaveLength(ALERT_CEILING + 1);
    });

    it("holds across servers: a second server has the same few keys to send under", async () => {
      for (let n = 0; n < 10; n++) await report(n);
      forgetSentAlerts();
      for (let n = 10; n < 20; n++) await report(n);

      // Each server tried, and Resend sends only the first message under a key.
      const keys = new Set(sent().map((message) => message.idempotencyKey));
      expect(sent()).toHaveLength(2 * (ALERT_CEILING + 1));
      expect(keys.size).toBe(ALERT_CEILING + 1);
    });

    it("is one key on every server for an outage with one error", async () => {
      await report(1);
      forgetSentAlerts();
      await report(1);
      expect(new Set(sent().map((message) => message.idempotencyKey)).size).toBe(1);
    });

    it("gives another route, another kind and another error name their own ceiling", async () => {
      for (let n = 0; n < 10; n++) await report(n);
      vi.mocked(sendEmail).mockClear();

      await onRequestError(parseFailure(1), actionRequest, { ...actionContext, routePath: "/sign-up/[[...sign-up]]/page" });
      await onRequestError(parseFailure(2), actionRequest, { ...actionContext, routeType: "render" });
      await onRequestError(Object.assign(new TypeError("other"), { digest: "3" }), actionRequest, actionContext);
      expect(sent()).toHaveLength(3);
      for (const message of sent()) expect(message.subject).toContain("an error on");
    });

    it("starts again in the next window, note included", async () => {
      for (let n = 0; n < 10; n++) await report(n);
      const firstKeys = sent().map((message) => message.idempotencyKey);
      vi.mocked(sendEmail).mockClear();

      vi.setSystemTime(new Date(NOW.getTime() + ALERT_WINDOW_MS));
      for (let n = 0; n < 10; n++) await report(n);
      expect(sent()).toHaveLength(ALERT_CEILING + 1);
      for (const message of sent()) expect(firstKeys).not.toContain(message.idempotencyKey);
    });

    it("does not give a claim back when a send fails, so an email outage is not one attempt per error", async () => {
      vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "unreachable" });
      for (let n = 0; n < 20; n++) await report(n);
      expect(sent()).toHaveLength(ALERT_CEILING + 1);
    });

    it("keeps everything sensitive out of the note", async () => {
      for (let n = 0; n < ALERT_CEILING + 1; n++) await onRequestError(failure(String(n)), request, context);
      const note = sent()[ALERT_CEILING];
      expect(note.subject).toContain("error alerts held back");
      for (const text of [note.subject, note.text, note.html, note.idempotencyKey ?? ""]) {
        expect(text).not.toContain(SHARE_CODE);
        expect(text).not.toContain(CONNECTION_STRING);
        expect(text).not.toContain("secret.token");
      }
    });
  });

  it("asks the platform to wait for the send, because Next.js may not", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test";
    let finish: (outcome: { sent: true }) => void = () => {};
    vi.mocked(sendEmail).mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const reporting = onRequestError(failure(), request, context);
    expect(after).toHaveBeenCalledTimes(1);
    const handedOver = vi.mocked(after).mock.calls[0][0] as Promise<void>;
    expect(handedOver).toBeInstanceOf(Promise);

    let done = false;
    void handedOver.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);

    finish({ sent: true });
    await reporting;
    expect(done).toBe(true);
  });

  it("still sends when there is no request for the platform to wait on", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test";
    vi.mocked(after).mockImplementation(() => {
      throw new Error("after was called outside a request scope.");
    });
    await expect(onRequestError(failure(), request, context)).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not ask the platform to wait when there is nothing to send", async () => {
    await onRequestError(failure(), request, context);
    expect(after).not.toHaveBeenCalled();
  });

  it("logs a refused send as a reason only, and never throws", async () => {
    process.env.ERROR_ALERT_EMAIL = "evan@example.test";
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "refused" });
    await expect(onRequestError(failure(), request, context)).resolves.toBeUndefined();
    expect(logged()).toContain("Error alert: the email was not sent. refused");
    expect(logged()).not.toContain(CONNECTION_STRING);
  });
});
