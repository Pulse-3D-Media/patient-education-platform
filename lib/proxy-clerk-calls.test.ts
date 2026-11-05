import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Public paths make no calls to Clerk that a stranger can start.
 *
 * Clerk's middleware looks at every request it is given before our own code
 * runs, and some made-up credentials (a token in an Authorization header, or
 * a "handshake nonce" in the address) make it ask Clerk's servers about them,
 * once per request. The app never signs anyone in with a header, and the
 * patient pages, printed codes, health check and webhooks never need to know
 * who is signed in at all. So proxy.ts:
 *
 *   - does not hand those paths to Clerk at all, and
 *   - answers a request that carries an Authorization header with 401 before
 *     Clerk sees it, on every other path.
 *
 * These tests run the real proxy.ts with made-up keys and a stand-in fetch,
 * and count what is sent to Clerk's backend (api.clerk.com). No real key, no
 * network. The one call left on purpose, a handshake nonce on a page that
 * does need Clerk (/, sign-in, staff pages), is checked at the end so it is
 * written down: a real browser's sign-in uses that nonce, so it is not cut.
 */

// A made-up live publishable key: "pk_live_" and the base64 of a host with
// Clerk's trailing "$", so the nonce takes the production path. Nothing real.
const FAKE_LIVE_KEY = `pk_live_${Buffer.from("clerk.app.test$").toString("base64")}`;
const FAKE_SECRET = "sk_live_made_up_for_this_test_only";

// An unsigned three-part token that decodes as JSON, with a key id Clerk has
// never handed out. Without our check this makes Clerk's SDK fetch its keys.
function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const MADE_UP_JWT = `${base64url({ alg: "RS256", kid: "made-up-1", typ: "JWT" })}.${base64url({ sub: "nobody" })}.c2ln`;

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_LIVE_KEY);
  vi.stubEnv("CLERK_SECRET_KEY", FAKE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "");
  vi.stubEnv("NEXT_PUBLIC_CLERK_DOMAIN", "");
  vi.stubEnv("CLERK_JWT_KEY", "");
  // Clerk answers "not found" to everything, as it would for a made-up token.
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ errors: [] }), { status: 404, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const proxy = (await import("@/proxy")).default;
  return { proxy, fetchMock };
}

/** How many requests went to Clerk's backend. */
function clerkCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([input]) => (typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
    .filter((url) => new URL(url).hostname === "api.clerk.com").length;
}

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;

type Credential = { name: string; headers?: Record<string, string>; query?: string };

const HEADER_CREDENTIALS: Credential[] = [
  { name: "a made-up machine token", headers: { authorization: "Bearer mt_dummy" } },
  { name: "a made-up OAuth token", headers: { authorization: "Bearer oat_dummy" } },
  { name: "a made-up API key", headers: { authorization: "Bearer ak_dummy" } },
  { name: "a machine token with no scheme", headers: { authorization: "mt_dummy" } },
  { name: "a made-up session token with an unknown key id", headers: { authorization: `Bearer ${MADE_UP_JWT}` } },
];
const NONCE: Credential = { name: "a made-up handshake nonce", query: "?__clerk_handshake_nonce=dummy" };

async function send(path: string, credential: Credential, method = "GET") {
  const { proxy, fetchMock } = await loadProxy();
  const request = new NextRequest(`https://app.test${path}${credential.query ?? ""}`, {
    method,
    headers: credential.headers,
  });
  const response = await proxy(request, event);
  return { response, calls: clerkCalls(fetchMock) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("paths that never need a signed-in user are not handed to Clerk", () => {
  const PATHS: [string, string][] = [
    ["/watch/abcdefghij", "GET"],
    ["/watch/abcdefghij/accept", "POST"],
    ["/q/abcdefghijklmnopqrstuvwxy", "GET"],
    ["/q/abcdefghijklmnopqrstuvwxy/issue", "POST"],
    ["/api/health", "GET"],
    ["/api/webhooks/stripe", "POST"],
    ["/api/webhooks/mux", "POST"],
  ];

  for (const [path, method] of PATHS) {
    for (const credential of [...HEADER_CREDENTIALS, NONCE]) {
      it(`${method} ${path} with ${credential.name}: no call to Clerk, and the request goes on`, async () => {
        const { response, calls } = await send(path, credential, method);
        expect(calls).toBe(0);
        // Passed straight through to the page or route, untouched.
        expect(response?.status ?? 200).toBe(200);
        expect(response?.headers.get("x-middleware-next")).toBe("1");
      });
    }
  }

  it("a path that only starts with the same letters (/question) is not treated as a printed code", async () => {
    const { calls } = await send("/question", NONCE);
    // /question is not a page we have; it still goes through Clerk like any other address.
    expect(calls).toBe(1);
  });
});

describe("other paths refuse an Authorization header before Clerk sees it", () => {
  for (const path of ["/", "/sign-in", "/sign-up", "/library", "/admin/billing", "/pulse", "/api/anything"]) {
    for (const credential of HEADER_CREDENTIALS) {
      it(`${path} with ${credential.name}: 401 and no call to Clerk`, async () => {
        const { response, calls } = await send(path, credential);
        expect(calls).toBe(0);
        expect(response?.status).toBe(401);
        expect(response?.headers.get("cache-control")).toBe("no-store");
      });
    }
  }
});

describe("the code under those paths does not need Clerk's middleware", () => {
  // auth() and currentUser() throw when the middleware did not run. Nothing
  // under these folders imports Clerk directly; the renewal email reaches
  // Clerk through lib/people.ts's listPeople(), which uses only clerkClient()
  // (that reads its keys from the environment and works without it). The one
  // exception is Clerk's webhook signature check (verifyWebhook, from
  // @clerk/nextjs/webhooks, used by app/api/webhooks/clerk), which is plain
  // arithmetic over the request and never asks who is signed in.
  it("no file under app/watch, app/q, app/api/health or app/api/webhooks imports Clerk, but for the webhook signature check", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    for (const dir of ["app/watch", "app/q", "app/api/health", "app/api/webhooks"]) walk(dir);
    expect(files.length).toBeGreaterThan(5);
    const allowed = /^import \{ verifyWebhook \} from "@clerk\/nextjs\/webhooks";$/gm;
    const offenders = files.filter((file) => /@clerk\//.test(readFileSync(file, "utf8").replace(allowed, "")));
    expect(offenders).toEqual([]);
  });
});

describe("what still works as before", () => {
  it("a request with no credentials makes no call to Clerk (the control)", async () => {
    const { response, calls } = await send("/", { name: "nothing" });
    expect(calls).toBe(0);
    expect(response?.status ?? 200).not.toBe(401);
  });

  it("a signed-out visitor of a staff page is still sent to sign-in", async () => {
    const { response, calls } = await send("/library", { name: "nothing" });
    expect(calls).toBe(0);
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toContain("/sign-in");
  });

  it("a handshake nonce on a page that needs Clerk is still resolved with Clerk (a real sign-in uses it)", async () => {
    // Left on purpose and written down here: one call per such request. The
    // firewall is where it would be limited (see the pull request).
    const { calls } = await send("/sign-in", NONCE);
    expect(calls).toBe(1);
  });
});
