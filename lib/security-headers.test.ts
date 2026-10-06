import { describe, expect, it } from "vitest";
import { clerkFrontendOrigin, contentSecurityPolicy, CSP_ENFORCED, securityHeaders } from "./security-headers";

/**
 * The headers every response carries. Made-up Clerk keys only: a key is
 * built here from a made-up host name the way Clerk builds one.
 */

const madeUpKey = (host: string, kind: "test" | "live" = "test") => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;
const KEY = madeUpKey("made-up-otter-12.clerk.accounts.dev");

function byName(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map((header) => [header.key, header.value]));
}

/** One directive of a policy, as its list of sources. */
function directive(policy: string, name: string): string[] {
  const part = policy.split("; ").find((p) => p.startsWith(`${name} `));
  return part ? part.split(" ").slice(1) : [];
}

describe("clerkFrontendOrigin", () => {
  it("reads the address out of a development or a production key", () => {
    expect(clerkFrontendOrigin(KEY)).toBe("https://made-up-otter-12.clerk.accounts.dev");
    expect(clerkFrontendOrigin(madeUpKey("clerk.example.com", "live"))).toBe("https://clerk.example.com");
  });

  it("falls back to Clerk's development name, never a guess, for a missing or damaged key", () => {
    for (const key of [undefined, "", "sk_test_abc", "pk_test_", "pk_test_!!!", `pk_test_${Buffer.from("no-dollar.example.com").toString("base64")}`,madeUpKey("evil.com; script-src *"), madeUpKey("localhost")]) {
      expect(clerkFrontendOrigin(key)).toBe("https://*.clerk.accounts.dev");
    }
  });
});

describe("securityHeaders", () => {
  const headers = byName(securityHeaders({ clerkPublishableKey: KEY, vercelEnv: "production" }));

  it("sends every header the prompt asked for", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("never sends a Referrer-Policy that would stop the browser saying where a request came from", () => {
    // no-referrer would make the browser send "Origin: null" on our own
    // Server Actions, and Next.js refuses those, so a patient's play would
    // stop being counted.
    expect(headers["Referrer-Policy"]).not.toMatch(/no-referrer|unsafe-url/);
  });

  it("enforces no framing, no plug-ins and no <base> trick today, and only reports the full list", () => {
    expect(CSP_ENFORCED).toBe(false);
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(contentSecurityPolicy({ clerkPublishableKey: KEY, vercelEnv: "production" }));
  });
});

describe("contentSecurityPolicy", () => {
  const production = contentSecurityPolicy({ clerkPublishableKey: KEY, vercelEnv: "production" });

  it("allows Clerk's script, its sign-in calls and its bot check", () => {
    const clerk = "https://made-up-otter-12.clerk.accounts.dev";
    expect(directive(production, "script-src")).toEqual(expect.arrayContaining([clerk, "https://challenges.cloudflare.com"]));
    expect(directive(production, "connect-src")).toEqual(expect.arrayContaining([clerk]));
    expect(directive(production, "frame-src")).toEqual(expect.arrayContaining(["https://challenges.cloudflare.com"]));
    expect(directive(production, "worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("allows the Webflow video CDN, clinic logos from any https address, and our own fonts", () => {
    expect(directive(production, "media-src")).toEqual(expect.arrayContaining(["'self'", "https://cdn.prod.website-files.com"]));
    expect(directive(production, "img-src")).toEqual(expect.arrayContaining(["'self'", "https:", "data:"]));
    expect(directive(production, "font-src")).toEqual(["'self'", "data:"]);
  });

  it("allows Mux streams, both as media and as the connections hls.js makes for them; stills ride on the https picture rule", () => {
    expect(directive(production, "media-src")).toContain("https://stream.mux.com");
    expect(directive(production, "connect-src")).toContain("https://stream.mux.com");
    // Nothing of Mux's runs as script here: hls.js is served from our own address.
    expect(directive(production, "script-src")).not.toContain("https://stream.mux.com");
  });

  it("keeps forms on our own address and refuses framing, plug-ins and <base>", () => {
    expect(directive(production, "form-action")).toEqual(["'self'"]);
    expect(directive(production, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(production, "object-src")).toEqual(["'none'"]);
    expect(directive(production, "base-uri")).toEqual(["'self'"]);
  });

  it("never allows scripts from anywhere, and allows eval only under next dev", () => {
    expect(directive(production, "script-src")).not.toContain("https:");
    expect(directive(production, "script-src")).not.toContain("*");
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy({ clerkPublishableKey: KEY, dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("lets Vercel's comment toolbar in on previews only", () => {
    expect(production).not.toContain("vercel.live");
    const preview = contentSecurityPolicy({ clerkPublishableKey: KEY, vercelEnv: "preview" });
    for (const name of ["script-src", "connect-src", "frame-src", "style-src", "font-src"]) {
      expect(directive(preview, name)).toContain("https://vercel.live");
    }
  });
});
