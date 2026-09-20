import { describe, expect, it } from "vitest";
import { knownOrigins, pickTrustedOrigin } from "./trusted-origin";

/**
 * Which address Stripe may send a person back to. Pure: every host and
 * every environment value here is made up.
 *
 * The point of the rule is that the Host header of a request is chosen by
 * whoever sent the request, so it may only ever PICK among addresses the
 * deployment already knows are its own.
 */

const PREVIEW = {
  VERCEL: "1",
  VERCEL_URL: "app-abc123-team.vercel.app",
  VERCEL_BRANCH_URL: "app-git-billing-checkout-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app",
  NODE_ENV: "production",
};

describe("pickTrustedOrigin", () => {
  it("uses the address the request came in on when it is one of the deployment's own", () => {
    expect(pickTrustedOrigin("app-git-billing-checkout-team.vercel.app", PREVIEW)).toBe("https://app-git-billing-checkout-team.vercel.app");
    expect(pickTrustedOrigin("app-abc123-team.vercel.app", PREVIEW)).toBe("https://app-abc123-team.vercel.app");
    expect(pickTrustedOrigin("APP.vercel.app", PREVIEW)).toBe("https://app.vercel.app");
  });

  it("never uses a host it does not know: a forged Host header falls back to one of the deployment's own addresses", () => {
    for (const forged of ["evil.example", "app.vercel.app.evil.example", "evil.example/app.vercel.app", "app.vercel.app@evil.example", "evil.example#app.vercel.app"]) {
      const origin = pickTrustedOrigin(forged, PREVIEW);
      expect(origin).toBe("https://app-git-billing-checkout-team.vercel.app");
      expect(origin).not.toContain("evil");
    }
  });

  it("on a developer's own computer, localhost is trusted, and only there", () => {
    const local = { NODE_ENV: "development" };
    expect(pickTrustedOrigin("localhost:3000", local)).toBe("http://localhost:3000");
    expect(pickTrustedOrigin("127.0.0.1:3100", local)).toBe("http://127.0.0.1:3100");
    // Not localhost, and nothing is known: refuse.
    expect(pickTrustedOrigin("evil.example", local)).toBeNull();
    expect(pickTrustedOrigin("localhost.evil.example", local)).toBeNull();
    // On Vercel, or in a production build, a request claiming to be localhost is not believed.
    expect(pickTrustedOrigin("localhost:3000", PREVIEW)).toBe("https://app-git-billing-checkout-team.vercel.app");
    expect(pickTrustedOrigin("localhost:3000", { NODE_ENV: "production" })).toBeNull();
  });

  it("returns null, so checkout is refused, when the deployment knows no address of its own", () => {
    expect(pickTrustedOrigin("app.vercel.app", { NODE_ENV: "production" })).toBeNull();
    expect(pickTrustedOrigin(null, { NODE_ENV: "production" })).toBeNull();
    expect(pickTrustedOrigin("", {})).toBeNull();
  });

  it("APP_ORIGINS adds a custom domain, https only, and nothing but an origin", () => {
    const env = { ...PREVIEW, APP_ORIGINS: "https://app.example.com, http://plain.example.com, https://path.example.com/somewhere, not a url" };
    expect(knownOrigins(env)).toEqual([
      "https://app.example.com",
      "https://app-git-billing-checkout-team.vercel.app",
      "https://app-abc123-team.vercel.app",
      "https://app.vercel.app",
    ]);
    expect(pickTrustedOrigin("app.example.com", env)).toBe("https://app.example.com");
    expect(pickTrustedOrigin("plain.example.com", env)).toBe("https://app.example.com");
  });
});
