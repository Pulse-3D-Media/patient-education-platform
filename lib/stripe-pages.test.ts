import { describe, expect, it } from "vitest";
import { checkoutDestination, STRIPE_CHECKOUT_PREFIX, STRIPE_INVOICE_PREFIX, STRIPE_PORTAL_PREFIX, stripeInvoicePage } from "./stripe-pages";

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

  it("refuses a tab or a line break after the leading slash, which a browser would delete to make //", () => {
    expect(checkoutDestination("/\t/evil.example/admin")).toBeNull();
    expect(checkoutDestination("/\n/evil.example/admin")).toBeNull();
    expect(checkoutDestination("/\r\n/evil.example/admin")).toBeNull();
    expect(checkoutDestination("/\t\\evil.example/admin")).toBeNull();
    // Anywhere else in the address too: none of our addresses or Stripe's holds one.
    expect(checkoutDestination("/admin/billing\t/return")).toBeNull();
    expect(checkoutDestination(`${STRIPE_CHECKOUT_PREFIX}c/pay\n/cs_test_made_up`)).toBeNull();
  });
});

describe("stripeInvoicePage", () => {
  it("lets through Stripe's invoice page only", () => {
    const page = `${STRIPE_INVOICE_PREFIX}i/acct_made_up/test_made_up`;
    expect(stripeInvoicePage(page)).toBe(page);
    expect(stripeInvoicePage(null)).toBeNull();
    expect(stripeInvoicePage(undefined)).toBeNull();
    expect(stripeInvoicePage("")).toBeNull();
    expect(stripeInvoicePage("https://evil.example/")).toBeNull();
    expect(stripeInvoicePage("https://invoice.stripe.com.evil.example/")).toBeNull();
    expect(stripeInvoicePage(`${STRIPE_PORTAL_PREFIX}p/session/made_up`)).toBeNull();
    expect(stripeInvoicePage("javascript:alert(1)")).toBeNull();
    expect(stripeInvoicePage(`${STRIPE_INVOICE_PREFIX}i/acct\t_made_up`)).toBeNull();
  });
});
