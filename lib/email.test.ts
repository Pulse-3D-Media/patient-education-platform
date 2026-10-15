import { afterEach, describe, expect, it, vi } from "vitest";
import { emailIsConfigured, sendEmail } from "./email";

/**
 * The one file that talks to the email service, with the service replaced
 * by a stand-in for fetch and made-up settings. What these prove: nothing
 * is sent without both settings; the message goes to Resend's address as a
 * POST with the key as a bearer token and the idempotency key; sent
 * separately, each recipient gets a copy of their own in one batch; a refusal
 * and an unreachable service are answered with a reason, never thrown; and
 * the key never reaches a log line.
 */

const env = { RESEND_API_KEY: "re_made_up_key_for_tests_only", EMAIL_FROM: "Pulse 3D <links@example.test>" };
const message = { to: ["admin@example.test", "second@example.test"], subject: "A test", text: "Plain words", html: "<p>Plain words</p>", idempotencyKey: "key-1" };

/** A stand-in for fetch that remembers what it was asked and answers with one status code. */
function service(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { send, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emailIsConfigured", () => {
  it("is true only when both the key and the sender are set", () => {
    expect(emailIsConfigured(env)).toBe(true);
    expect(emailIsConfigured({ RESEND_API_KEY: env.RESEND_API_KEY })).toBe(false);
    expect(emailIsConfigured({ EMAIL_FROM: env.EMAIL_FROM })).toBe(false);
    expect(emailIsConfigured({ RESEND_API_KEY: "  ", EMAIL_FROM: env.EMAIL_FROM })).toBe(false);
    expect(emailIsConfigured({})).toBe(false);
  });
});

describe("sendEmail", () => {
  it("answers not-configured, and never calls the service, when either setting is missing", async () => {
    const { send, calls } = service();
    expect(await sendEmail(message, { env: {}, fetch: send })).toEqual({ sent: false, reason: "not-configured" });
    expect(await sendEmail(message, { env: { RESEND_API_KEY: env.RESEND_API_KEY }, fetch: send })).toEqual({ sent: false, reason: "not-configured" });
    expect(calls).toHaveLength(0);
  });

  it("answers no-recipients for an empty list, without calling the service", async () => {
    const { send, calls } = service();
    expect(await sendEmail({ ...message, to: [] }, { env, fetch: send })).toEqual({ sent: false, reason: "no-recipients" });
    expect(await sendEmail({ ...message, to: ["  "] }, { env, fetch: send })).toEqual({ sent: false, reason: "no-recipients" });
    expect(calls).toHaveLength(0);
  });

  it("posts the message to Resend with the key as a bearer token, the sender from the settings, and the idempotency key", async () => {
    const { send, calls } = service(200);
    expect(await sendEmail(message, { env, fetch: send })).toEqual({ sent: true });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${env.RESEND_API_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(String(init.body))).toEqual({
      from: env.EMAIL_FROM,
      to: ["admin@example.test", "second@example.test"],
      subject: "A test",
      text: "Plain words",
      html: "<p>Plain words</p>",
    });
    // A message is never left waiting forever.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no idempotency header when no key is given", async () => {
    const { send, calls } = service(200);
    const { idempotencyKey: _dropped, ...plain } = message;
    void _dropped;
    await sendEmail(plain, { env, fetch: send });
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });

  it("sent separately, gives each recipient a copy addressed to them alone, in one batch request under the one key", async () => {
    const { send, calls } = service(200);
    expect(await sendEmail({ ...message, to: [" admin@example.test", "", "second@example.test"], separately: true }, { env, fetch: send })).toEqual({ sent: true });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${env.RESEND_API_KEY}`);
    expect(headers["Idempotency-Key"]).toBe("key-1");
    const copy = { from: env.EMAIL_FROM, subject: "A test", text: "Plain words", html: "<p>Plain words</p>" };
    expect(JSON.parse(String(init.body))).toEqual([
      { ...copy, to: ["admin@example.test"] },
      { ...copy, to: ["second@example.test"] },
    ]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sent separately to more than a batch holds, sends batches of 100, each under a key of its own", async () => {
    const { send, calls } = service(200);
    const many = Array.from({ length: 150 }, (_, index) => `person${index}@example.test`);
    expect(await sendEmail({ ...message, to: many, separately: true }, { env, fetch: send })).toEqual({ sent: true });

    expect(calls).toHaveLength(2);
    const bodies = calls.map((call) => JSON.parse(String(call.init.body)) as { to: string[] }[]);
    expect(bodies.map((body) => body.length)).toEqual([100, 50]);
    expect(bodies.flat().map((copy) => copy.to)).toEqual(many.map((address) => [address]));
    expect(calls.map((call) => (call.init.headers as Record<string, string>)["Idempotency-Key"])).toEqual(["key-1", "key-1-1"]);
  });

  it("sent separately, answers refused on an error status and no-recipients for an empty list, like a single send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ ...message, separately: true }, { env, fetch: service(429).send })).toEqual({ sent: false, reason: "refused" });
    const { send, calls } = service();
    expect(await sendEmail({ ...message, to: [" "], separately: true }, { env, fetch: send })).toEqual({ sent: false, reason: "no-recipients" });
    expect(calls).toHaveLength(0);
  });

  it("answers refused on an error status, logging the status code and never the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = service(403);
    expect(await sendEmail(message, { env, fetch: send })).toEqual({ sent: false, reason: "refused" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]).toContain(403);
    expect(JSON.stringify(log.mock.calls)).not.toContain(env.RESEND_API_KEY);
  });

  it("answers unreachable when the service throws, without throwing itself, and logs only the kind of error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw Object.assign(new Error(`secret-bearing detail ${env.RESEND_API_KEY}`), { name: "TypeError" });
    }) as unknown as typeof fetch;
    expect(await sendEmail(message, { env, fetch: send })).toEqual({ sent: false, reason: "unreachable" });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain("TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain(env.RESEND_API_KEY);
  });
});
