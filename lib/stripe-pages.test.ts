import { describe, expect, it } from "vitest";
import { checkoutDestination, STRIPE_CHECKOUT_PREFIX } from "./stripe-pages";

describe("checkoutDestination", () => {
  it("lets the plan picker go to one of our own pages or to Stripe's payment page", () => {
    expect(checkoutDestination("/admin/billing/return")).toEqual({ kind: "here", path: "/admin/billing/return" });
    expect(checkoutDestination(`${STRIPE_CHECKOUT_PREFIX}c/pay/cs_test_made_up`)).toEqual({ kind: "stripe", url: `${STRIPE_CHECKOUT_PREFIX}c/pay/cs_test_made_up` });
  });

  it("refuses an address that only looks like ours, and any other site", () => {
    expect(checkoutDestination("//evil.example/admin")).toBeNull();
    expect(checkoutDestination("/\\evil.example/admin")).toBeNull();
    expect(checkoutDestination("https://evil.example/")).toBeNull();
    expect(checkoutDestination("https://checkout.stripe.com.evil.example/")).toBeNull();
    expect(checkoutDestination("https://billing.stripe.com/p/session/made_up")).toBeNull();
    expect(checkoutDestination("javascript:alert(1)")).toBeNull();
    expect(checkoutDestination("")).toBeNull();
  });
});
