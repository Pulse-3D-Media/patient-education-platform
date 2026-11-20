import { describe, expect, it } from "vitest";
import {
  CARD_FORM_PATH,
  checkClerkKeyForBuild,
  clerkFrontendOrigin,
  contentSecurityPolicy,
  COOP_ENFORCED,
  CSP_ENFORCED,
  headerRules,
  MISSING_CLERK_KEY_MESSAGE,
  securityHeaders,
  type HeaderRule,
} from "./security-headers";

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

describe("checkClerkKeyForBuild", () => {
  const damaged = [undefined, "", "pk_test_", "pk_test_!!!", madeUpKey("localhost")];

  it("stops a production build on Vercel when the key is missing or cannot be read, naming the setting and never the value", () => {
    for (const key of damaged) {
      expect(() => checkClerkKeyForBuild({ clerkPublishableKey: key, vercelEnv: "production" })).toThrow(MISSING_CLERK_KEY_MESSAGE);
      expect(() => securityHeaders({ clerkPublishableKey: key, vercelEnv: "production" })).toThrow(MISSING_CLERK_KEY_MESSAGE);
    }
    expect(MISSING_CLERK_KEY_MESSAGE).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(MISSING_CLERK_KEY_MESSAGE).not.toContain("pk_");
  });

  it("lets a production build with a readable key through, development or live", () => {
    expect(() => checkClerkKeyForBuild({ clerkPublishableKey: KEY, vercelEnv: "production" })).not.toThrow();
    expect(() => checkClerkKeyForBuild({ clerkPublishableKey: madeUpKey("clerk.example.com", "live"), vercelEnv: "production" })).not.toThrow();
  });

  it("leaves a preview, a developer's computer and the GitHub check (no settings at all) building with the fallback", () => {
    for (const key of damaged) {
      expect(() => checkClerkKeyForBuild({ clerkPublishableKey: key, vercelEnv: "preview" })).not.toThrow();
      expect(() => checkClerkKeyForBuild({ clerkPublishableKey: key, vercelEnv: "development" })).not.toThrow();
      expect(() => checkClerkKeyForBuild({ clerkPublishableKey: key })).not.toThrow();
      expect(() => securityHeaders({ clerkPublishableKey: key, dev: true })).not.toThrow();
    }
    expect(directive(byName(securityHeaders({}))["Content-Security-Policy"], "script-src")).toContain("https://*.clerk.accounts.dev");
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

  it("enforces Cross-Origin-Opener-Policy: same-origin, turned on with the content policy", () => {
    expect(COOP_ENFORCED).toBe(true);
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Opener-Policy-Report-Only"]).toBeUndefined();
  });

  it("never sends a Referrer-Policy that would stop the browser saying where a request came from", () => {
    // no-referrer would make the browser send "Origin: null" on our own
    // Server Actions, and Next.js refuses those, so a patient's play would
    // stop being counted.
    expect(headers["Referrer-Policy"]).not.toMatch(/no-referrer|unsafe-url/);
  });

  it("enforces the full list, which still forbids framing, plug-ins and the <base> trick, and reports nothing separately", () => {
    expect(CSP_ENFORCED).toBe(true);
    const full = contentSecurityPolicy({ clerkPublishableKey: KEY, vercelEnv: "production" });
    expect(headers["Content-Security-Policy"]).toBe(full);
    expect(full).toContain("frame-ancestors 'none'");
    expect(full).toContain("object-src 'none'");
    expect(full).toContain("base-uri 'self'");
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
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

  it("allows the Webflow video CDN, pictures only from the list, and our own fonts", () => {
    expect(directive(production, "media-src")).toEqual(expect.arrayContaining(["'self'", "https://cdn.prod.website-files.com"]));
    expect(directive(production, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://cdn.prod.website-files.com",
      "https://*.website-files.com",
      "https://uploads-ssl.webflow.com",
      "https://img.clerk.com",
      "https://image.mux.com",
      "https://made-up-otter-12.clerk.accounts.dev",
    ]);
    // Never "any https address" again.
    expect(directive(production, "img-src")).not.toContain("https:");
    // Vercel's toolbar pictures on previews only.
    expect(directive(contentSecurityPolicy({ clerkPublishableKey: KEY, vercelEnv: "preview" }), "img-src")).toEqual(expect.arrayContaining(["https://vercel.live", "https://vercel.com"]));
    expect(directive(production, "font-src")).toEqual(["'self'", "data:"]);
  });

  it("allows Mux streams, both as media and as the connections hls.js makes for them; stills are on the picture list", () => {
    expect(directive(production, "media-src")).toContain("https://stream.mux.com");
    expect(directive(production, "connect-src")).toContain("https://stream.mux.com");
    // stream.mux.com hands the player on to manifest-...mux.com and chunk-...mux.com.
    expect(directive(production, "media-src")).toContain("https://*.mux.com");
    expect(directive(production, "connect-src")).toContain("https://*.mux.com");
    // Captions need no host of their own: the subtitle playlists and WebVTT files hls.js fetches, and Safari loads,
    // come from those same Mux hosts (stream.mux.com/<id>/text/... and the manifest hosts). The staff review link is a
    // page opened in a new tab, not something our page loads.
    expect(directive(production, "connect-src").filter((host) => host.includes("mux.com"))).toEqual(["https://stream.mux.com", "https://*.mux.com"]);
    // Nothing of Mux's runs as script here: hls.js is served from our own address.
    expect(directive(production, "script-src")).not.toContain("https://stream.mux.com");
  });

  it("lets a staff member's browser send an upload to Mux's one-time addresses (a connection), and plays nothing from there", () => {
    expect(directive(production, "connect-src")).toContain("https://storage.googleapis.com");
    expect(directive(production, "media-src")).not.toContain("https://storage.googleapis.com");
    expect(directive(production, "script-src")).not.toContain("https://storage.googleapis.com");
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

/**
 * What one address ends up with, worked out the way Next.js does it: every rule whose pattern matches
 * applies, in order, and a later rule that sets the same header replaces the earlier one. The patterns
 * used here are the three kinds headerRules writes: everything, a folder and what is under it, one page.
 */
function headersFor(rules: HeaderRule[], pathname: string) {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    const folder = rule.source.endsWith("/:path*") ? rule.source.slice(0, -"/:path*".length) : null;
    const matches = folder === null ? pathname === rule.source : folder === "" || pathname === folder || pathname.startsWith(`${folder}/`);
    if (matches) for (const header of rule.headers) out[header.key] = header.value;
  }
  return out;
}

describe("Stripe's card form: only the sign-up payment step's policy lets Stripe in (Evan, 2026-11-20)", () => {
  const preview = { clerkPublishableKey: KEY, vercelEnv: "preview" };
  const STRIPE_HOSTS = ["js.stripe.com", "checkout.stripe.com", "hooks.stripe.com", "api.stripe.com", "stripe.com", "link.com"];
  const mentionsStripe = (policy: string) => STRIPE_HOSTS.some((host) => policy.includes(host));

  it("the payment step gets exactly Stripe's documented hosts for script, frame, connect and pictures", () => {
    const policy = headersFor(headerRules(preview), CARD_FORM_PATH)["Content-Security-Policy"];
    expect(CARD_FORM_PATH).toBe("/onboarding/payment");
    expect(directive(policy, "script-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com"]));
    expect(directive(policy, "frame-src")).toEqual(
      expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com", "https://hooks.stripe.com", "https://link.com", "https://*.link.com"]),
    );
    expect(directive(policy, "connect-src")).toEqual(expect.arrayContaining(["https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"]));
    expect(directive(policy, "img-src")).toEqual(expect.arrayContaining(["https://*.stripe.com", "https://*.link.com"]));
    // Nothing wider: no style or font host, no Google Maps, no "any https", still no framing of our page by anyone.
    expect(directive(policy, "style-src").some((source) => source.includes("stripe"))).toBe(false);
    expect(directive(policy, "font-src").some((source) => source.includes("stripe"))).toBe(false);
    expect(policy).not.toContain("maps.googleapis.com");
    expect(policy).not.toMatch(/(^|\s)https:(\s|;|$)/);
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("the wider policy is the usual one plus Stripe's hosts, nothing removed", () => {
    const usual = contentSecurityPolicy(preview);
    const card = contentSecurityPolicy(preview, { stripeCardForm: true });
    for (const name of ["default-src", "script-src", "style-src", "img-src", "media-src", "font-src", "connect-src", "frame-src", "worker-src", "form-action", "frame-ancestors", "object-src", "base-uri"]) {
      expect(directive(card, name)).toEqual(expect.arrayContaining(directive(usual, name)));
    }
  });

  it("the patient's pages, the plan step, Billing, the library and the bare address keep the usual policy, with no Stripe host at all", () => {
    const rules = headerRules(preview);
    const usual = contentSecurityPolicy(preview);
    for (const path of ["/watch/made-up-code", "/watch", "/q/made-up-code", "/q", "/onboarding/plan", "/onboarding/done", "/admin/billing", "/library", "/"]) {
      const policy = headersFor(rules, path)["Content-Security-Policy"];
      expect(policy, path).toBe(usual);
      expect(mentionsStripe(policy), path).toBe(false);
    }
    // And the patient's pages still say "not in search engines".
    expect(headersFor(rules, "/watch/made-up-code")["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headersFor(rules, "/q/made-up-code")["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("the payment step keeps every other security header unchanged", () => {
    const rules = headerRules(preview);
    const pay = headersFor(rules, CARD_FORM_PATH);
    const plan = headersFor(rules, "/onboarding/plan");
    for (const key of ["X-Frame-Options", "Referrer-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy"]) {
      expect(pay[key], key).toBe(plan[key]);
    }
  });

  it("on the production deployment, where the payment step is never offered, no page's policy mentions Stripe", () => {
    const rules = headerRules({ clerkPublishableKey: KEY, vercelEnv: "production" });
    for (const path of [CARD_FORM_PATH, "/watch/made-up-code", "/q/made-up-code", "/admin/billing", "/"]) {
      expect(mentionsStripe(headersFor(rules, path)["Content-Security-Policy"]), path).toBe(false);
    }
    expect(rules.some((rule) => rule.source === CARD_FORM_PATH)).toBe(false);
  });
});
