import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/**
 * Which requests proxy.ts (Clerk's middleware) runs for, asked of Next.js's
 * own matcher code, so the answer is the one a deployment gives.
 *
 * What these prove: a real static file (a picture, a stylesheet, a font, the
 * favicon) is skipped, as Clerk recommends; Next.js's own files under /_next
 * are skipped; and a page whose path merely CONTAINS a file ending somewhere
 * in the middle (/admin/x.png/anything) is matched, so the sign-in redirect
 * runs for it (audit run 2, November 2026: before the "$" in the matcher, it
 * was skipped). Pages, API routes and JSON are matched as before.
 */

function matches(path: string) {
  return unstable_doesMiddlewareMatch({ config, url: `https://example.test${path}` });
}

describe("the proxy's matcher", () => {
  it("skips static files and Next.js's own files, as Clerk recommends", () => {
    for (const path of [
      "/favicon.ico",
      "/apple-icon.png",
      "/logo.svg",
      "/fonts/inter.woff2",
      "/styles/site.css",
      "/script.js",
      "/report.csv",
      "/site.webmanifest",
      "/admin/logo.png",
      "/_next/static/chunks/main.js",
      "/_next/image",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("runs for a path that only contains a file ending in the middle", () => {
    for (const path of ["/admin/x.png/settings", "/library/a.css/knee", "/pulse/.ico/clinics", "/admin.png/people", "/onboarding/x.js/y"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("runs for pages, API routes and JSON, as before", () => {
    for (const path of ["/", "/admin", "/admin/people", "/library/knee", "/pulse", "/sign-in", "/api/health", "/data.json", "/__clerk/v1/client"]) {
      expect(matches(path), path).toBe(true);
    }
  });
});
