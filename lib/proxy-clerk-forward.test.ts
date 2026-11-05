import { NextRequest, type NextFetchEvent } from "next/server";
import { getAutoProxyUrlFromEnvironment } from "@clerk/shared/proxy";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Clerk forward is an explicit choice: OFF.
 *
 * Clerk's middleware can pass requests under /__clerk on to Clerk's own
 * servers (its "frontend API proxy"). Left to itself, the SDK turns that on
 * for a live key on a *.vercel.app address. We decided (CLAUDE.md, "Auth")
 * that it stays off: the browser talks to Clerk directly, as it does today.
 * proxy.ts says so with `frontendApiProxy: { enabled: false }`.
 *
 * These tests run the real proxy.ts with a made-up live key and a made-up
 * secret, and a stand-in fetch, and check that nothing is ever sent to
 * Clerk's frontend API host. No real key, no network.
 */

// A made-up live publishable key: "pk_live_" and the base64 of a frontend API
// host with Clerk's trailing "$". Nothing real.
const FAKE_FAPI_HOST = "clerk.example.test";
const FAKE_LIVE_KEY = `pk_live_${Buffer.from(`${FAKE_FAPI_HOST}$`).toString("base64")}`;
const FAKE_SECRET = "sk_live_made_up_for_this_test_only";

/** Load proxy.ts fresh, with the Clerk settings stubbed. Clerk reads them when its module loads. */
async function loadProxy(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_LIVE_KEY);
  vi.stubEnv("CLERK_SECRET_KEY", FAKE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "");
  vi.stubEnv("NEXT_PUBLIC_CLERK_DOMAIN", "");
  vi.stubEnv("CLERK_FAPI_URL", "");
  vi.stubEnv("CLERK_DISABLE_AUTO_PROXY", "");
  for (const [name, value] of Object.entries(extraEnv)) vi.stubEnv(name, value);

  const fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const proxy = (await import("@/proxy")).default;
  return { proxy, fetchMock };
}

/** Every address the stand-in fetch was asked for. */
function fetchedUrls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([input]) =>
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url,
  );
}

/** Was anything sent on to Clerk's frontend API (the forward's target)? */
function forwardedToClerk(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchedUrls(fetchMock).some((url) => {
    const host = new URL(url).hostname;
    return host === FAKE_FAPI_HOST || host === "frontend-api.clerk.dev" || host.endsWith(".clerk.accounts.dev");
  });
}

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;

async function send(proxy: Awaited<ReturnType<typeof loadProxy>>["proxy"], url: string) {
  const request = new NextRequest(url, { method: "POST", body: "x" });
  // Whatever Clerk does with it otherwise (it may answer, or fail to reach a
  // made-up Clerk), the only question here is where it sent it.
  try {
    await proxy(request, event);
  } catch {
    // ignored on purpose
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the Clerk forward under /__clerk", () => {
  it("is not used on a vercel.app address with a live key (where Clerk would turn it on by itself)", async () => {
    const { proxy, fetchMock } = await loadProxy();
    await send(proxy, "https://example.vercel.app/__clerk/v1/client");
    expect(forwardedToClerk(fetchMock)).toBe(false);
  });

  it("is not used on our own domain", async () => {
    const { proxy, fetchMock } = await loadProxy();
    await send(proxy, "https://learn.example.test/__clerk/v1/client");
    expect(forwardedToClerk(fetchMock)).toBe(false);
  });

  it("is not used with CLERK_DISABLE_AUTO_PROXY set either", async () => {
    const { proxy, fetchMock } = await loadProxy({ CLERK_DISABLE_AUTO_PROXY: "true" });
    await send(proxy, "https://example.vercel.app/__clerk/v1/client");
    expect(forwardedToClerk(fetchMock)).toBe(false);
  });
});

describe("the browser side's own automatic choice", () => {
  // StaffClerkProvider cannot be told "no forward" in a prop: Clerk picks
  // /__clerk for the browser only when Vercel's production address is itself
  // a vercel.app one. Ours is learn.pulse3dmedia.com, so it picks nothing,
  // and the browser talks to Clerk directly. If that ever changed, sign-in
  // would fail loudly (the middleware no longer forwards), never quietly.
  it("picks no forward when the production address is our own domain", () => {
    expect(
      getAutoProxyUrlFromEnvironment({
        publishableKey: FAKE_LIVE_KEY,
        environment: { NODE_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "learn.pulse3dmedia.com" },
      }),
    ).toBe("");
  });

  it("would pick one only for a vercel.app production address (why our domain matters)", () => {
    expect(
      getAutoProxyUrlFromEnvironment({
        publishableKey: FAKE_LIVE_KEY,
        environment: { NODE_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "example.vercel.app" },
      }),
    ).toBe("/__clerk");
  });
});
