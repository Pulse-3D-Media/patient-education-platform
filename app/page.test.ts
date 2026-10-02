import { describe, expect, it, vi } from "vitest";
import Home from "./page";

/**
 * The root address. It sends everyone to /onboarding, which routes them on
 * (tested in app/onboarding/page.test.tsx), so that a new clinic's owner who
 * signed up from the root comes back to a page that sends them to Billing.
 */

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

describe("the root address", () => {
  it("sends everyone to /onboarding, never straight to the library", () => {
    expect(() => Home()).toThrow("redirect:/onboarding");
  });
});
