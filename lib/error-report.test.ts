import { describe, expect, it } from "vitest";
import { SIGN_IN_UNAVAILABLE_DIGEST, SignInUnavailableError } from "./clerk-timeout";
import { ALERT_WINDOW_MS, alertEmail, alertKey, alertRecipients, describeRequestError } from "./error-report";

/**
 * What an error report may carry, with plain values and everything
 * sensitive placed where it would really be: the share code in the
 * address, the session in a cookie, a connection string in the message.
 * Pure, no database.
 */

const CONNECTION_STRING = "postgresql://neondb_owner:hunter2@ep-secret-host-123456.example.neon.tech/neondb";
const SHARE_CODE = "k7m2xq";
const NOW = new Date("2026-09-28T14:03:11.000Z");

/** A database failure the way Prisma throws it, with a digest the way Next.js adds one. */
function databaseFailure() {
  const error = new Error(`Can't reach database server at ${CONNECTION_STRING}`);
  error.name = "PrismaClientInitializationError";
  error.stack = `${error.name}: ${error.message}\n    at getShareByCode (lib/db/shares.ts:316:10)`;
  return Object.assign(error, { digest: "1234567890" });
}

/** The request as Next.js hands it over: the real address, the cookies, all of it. */
const request = {
  path: `/watch/${SHARE_CODE}?from=sms`,
  method: "GET",
  headers: { cookie: "__session=eyJhbGciOi.secret.token", host: "app.example.test", "user-agent": "Mozilla/5.0" },
};
const context = { routePath: "/watch/[code]", routeType: "render" };
const vercel = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" };

describe("describeRequestError", () => {
  it("keeps the time, the deployment, the route pattern, the method, the kind, the error's name and its digest, and nothing else", () => {
    expect(describeRequestError(databaseFailure(), request, context, vercel, NOW)).toEqual({
      when: "2026-09-28T14:03:11.000Z",
      environment: "production",
      commit: "abcdef1",
      route: "/watch/[code]",
      method: "GET",
      kind: "page",
      errorName: "PrismaClientInitializationError",
      digest: "1234567890",
    });
  });

  it("never carries the address opened, the share code, a header, the message or the stack", () => {
    const written = JSON.stringify(describeRequestError(databaseFailure(), request, context, vercel, NOW));
    expect(written).not.toContain(SHARE_CODE);
    expect(written).not.toContain("from=sms");
    expect(written).not.toContain("__session");
    expect(written).not.toContain("secret.token");
    expect(written).not.toContain("app.example.test");
    expect(written).not.toContain("Mozilla");
    expect(written).not.toContain(CONNECTION_STRING);
    expect(written).not.toContain("hunter2");
    expect(written).not.toContain("database server");
    expect(written).not.toContain("shares.ts");
  });

  it("names where it happened in plain words", () => {
    const kind = (routeType: string) => describeRequestError(databaseFailure(), request, { routePath: "/api/health", routeType }, vercel, NOW).kind;
    expect(kind("render")).toBe("page");
    expect(kind("route")).toBe("route handler");
    expect(kind("action")).toBe("action");
    expect(kind("proxy")).toBe("proxy");
    expect(kind("something-new")).toBe("something-new");
    expect(kind("not a kind at all")).toBe("unknown");
  });

  it("says local, with no commit, on a developer's computer", () => {
    expect(describeRequestError(databaseFailure(), request, context, {}, NOW)).toMatchObject({ environment: "local", commit: null });
  });

  it("recognises the sign-in error by its name and digest", () => {
    const error = new SignInUnavailableError("the clinic membership", new Error("timed out"));
    expect(describeRequestError(error, request, context, vercel, NOW)).toMatchObject({ errorName: "SignInUnavailableError", digest: SIGN_IN_UNAVAILABLE_DIGEST });
  });

  it("lets only short identifiers through as a digest, a name or a route: never a sentence", () => {
    const sentence = Object.assign(new Error("x"), { digest: `Can't reach ${CONNECTION_STRING}` });
    sentence.name = `Error: ${CONNECTION_STRING}`;
    const report = describeRequestError(sentence, { method: "GET" }, { routePath: `/watch/${SHARE_CODE}?x=${CONNECTION_STRING}`, routeType: "render" }, {}, NOW);
    expect(report).toMatchObject({ digest: null, errorName: "Error", route: "unknown" });
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("copes with something thrown that is not an Error at all", () => {
    expect(describeRequestError("boom", request, context, vercel, NOW)).toMatchObject({ errorName: "string", digest: null });
    expect(describeRequestError(null, { method: "" }, { routePath: "", routeType: "" }, {}, NOW)).toMatchObject({ errorName: "object", digest: null, method: "unknown", route: "unknown", kind: "unknown" });
  });
});

describe("alertKey", () => {
  const report = describeRequestError(databaseFailure(), request, context, vercel, NOW);

  it("is the same for the same error within one ten-minute window, and different in the next", () => {
    const later = new Date(NOW.getTime() + 60_000);
    const nextWindow = new Date(NOW.getTime() + ALERT_WINDOW_MS);
    expect(alertKey(report, later)).toBe(alertKey(report, NOW));
    expect(alertKey(report, nextWindow)).not.toBe(alertKey(report, NOW));
  });

  it("differs between two different errors", () => {
    const other = describeRequestError(new SignInUnavailableError("x", null), request, context, vercel, NOW);
    expect(alertKey(other, NOW)).not.toBe(alertKey(report, NOW));
  });

  it("falls back to the error's name when there is no digest, and holds only safe characters", () => {
    const named = describeRequestError("boom", request, context, vercel, NOW);
    expect(alertKey(named, NOW)).toMatch(/^error-alert-string-\d+$/);
    expect(alertKey(report, NOW)).toMatch(/^[\w-]+$/);
  });
});

describe("alertRecipients", () => {
  it("reads one or several addresses, and nobody when the setting is empty or junk", () => {
    expect(alertRecipients({})).toEqual([]);
    expect(alertRecipients({ ERROR_ALERT_EMAIL: "" })).toEqual([]);
    expect(alertRecipients({ ERROR_ALERT_EMAIL: "not an address" })).toEqual([]);
    expect(alertRecipients({ ERROR_ALERT_EMAIL: "evan@example.test" })).toEqual(["evan@example.test"]);
    expect(alertRecipients({ ERROR_ALERT_EMAIL: " evan@example.test , van@example.test ,, junk" })).toEqual(["evan@example.test", "van@example.test"]);
  });
});

describe("alertEmail", () => {
  const report = describeRequestError(databaseFailure(), request, context, vercel, NOW);
  const message = alertEmail(report, ["evan@example.test"], "error-alert-1234567890-99");

  it("says where, what and when, in plain words, and carries the key that makes repeats harmless", () => {
    expect(message.to).toEqual(["evan@example.test"]);
    expect(message.subject).toBe("Pulse 3D app: an error on production (/watch/[code])");
    expect(message.text).toContain("When: 2026-09-28T14:03:11.000Z");
    expect(message.text).toContain("Deployment: production, commit abcdef1");
    expect(message.text).toContain("Where: /watch/[code] (GET, page)");
    expect(message.text).toContain("What: PrismaClientInitializationError");
    expect(message.text).toContain("Digest: 1234567890");
    expect(message.text).toContain("one message per distinct error every ten minutes");
    expect(message.idempotencyKey).toBe("error-alert-1234567890-99");
    expect(message.html).toContain("/watch/[code] (GET, page)");
  });

  it("holds nothing from the request or the error beyond the record", () => {
    for (const part of [message.subject, message.text, message.html]) {
      expect(part).not.toContain(SHARE_CODE);
      expect(part).not.toContain(CONNECTION_STRING);
      expect(part).not.toContain("hunter2");
      expect(part).not.toContain("__session");
      expect(part).not.toContain("shares.ts");
    }
  });

  it("says none when there is no digest", () => {
    const noDigest = describeRequestError("boom", request, context, {}, NOW);
    expect(alertEmail(noDigest, ["evan@example.test"], "k").text).toContain("Digest: none");
    expect(alertEmail(noDigest, ["evan@example.test"], "k").text).toContain("Deployment: local\n");
  });
});
