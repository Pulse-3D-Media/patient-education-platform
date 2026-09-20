import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeConfigError, eventRefs, getWebhookSecret, isHandledEventType, isTestSecretKey, snapshotFromSubscription, verifyWebhook } from "./stripe";

/**
 * The Stripe wrapper, without Stripe: no network, no real key, no real
 * notification. Signatures are made with Stripe's own test helper and a
 * made-up secret, which is real arithmetic over the body, so the check here
 * is the same check production runs. Objects are cut down to the fields the
 * app reads, with made-up ids.
 */

const SECRET = "whsec_madeup_for_vitest_only";

function signed(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  return new Stripe("sk_test_madeup").webhooks.generateTestHeaderString({ payload: body, secret, timestamp });
}

const BODY = JSON.stringify({ id: "evt_madeup_1", object: "event", type: "invoice.paid", livemode: false, data: { object: { id: "in_madeup", customer: "cus_madeup" } } });

describe("verifyWebhook", () => {
  it("accepts a body signed with the endpoint's secret and returns the event", () => {
    const event = verifyWebhook(BODY, signed(BODY), SECRET);
    expect(event.id).toBe("evt_madeup_1");
    expect(event.type).toBe("invoice.paid");
  });

  it("refuses a missing header, a wrong secret, and a header that is not a signature", () => {
    expect(() => verifyWebhook(BODY, null, SECRET)).toThrow();
    expect(() => verifyWebhook(BODY, signed(BODY, "whsec_a_different_secret"), SECRET)).toThrow();
    expect(() => verifyWebhook(BODY, "t=1,v1=deadbeef", SECRET)).toThrow();
    expect(() => verifyWebhook(BODY, "nonsense", SECRET)).toThrow();
  });

  it("refuses a body that was changed after it was signed, even by one character", () => {
    const header = signed(BODY);
    expect(() => verifyWebhook(BODY.replace("cus_madeup", "cus_madeuq"), header, SECRET)).toThrow();
    // Re-serialising the same JSON is a change too: the signature is over the exact bytes.
    expect(() => verifyWebhook(JSON.stringify(JSON.parse(BODY), null, 2), header, SECRET)).toThrow();
  });

  it("refuses a correctly signed body that is older than the tolerance (a replay)", () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    expect(() => verifyWebhook(BODY, signed(BODY, SECRET, tenMinutesAgo), SECRET)).toThrow();
  });
});

describe("keys and secrets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("only test keys are keys", () => {
    expect(isTestSecretKey("sk_test_madeup")).toBe(true);
    expect(isTestSecretKey("rk_test_madeup")).toBe(true);
    expect(isTestSecretKey("sk_live_madeup")).toBe(false);
    expect(isTestSecretKey("rk_live_madeup")).toBe(false);
    expect(isTestSecretKey("pk_test_madeup")).toBe(false);
    expect(isTestSecretKey("")).toBe(false);
    expect(isTestSecretKey(undefined)).toBe(false);
  });

  it("a missing or malformed signing secret is a configuration error whose message holds no value", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => getWebhookSecret()).toThrow(StripeConfigError);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "not_a_signing_secret_value");
    try {
      getWebhookSecret();
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StripeConfigError);
      expect((error as Error).message).not.toContain("not_a_signing_secret_value");
    }
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    expect(getWebhookSecret()).toBe(SECRET);
  });
});

describe("eventRefs: the only two facts taken from a notification", () => {
  it("reads a subscription notification", () => {
    expect(eventRefs({ type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", metadata: { clinicId: "ignored" } } } })).toEqual({
      customerId: "cus_1",
      subscriptionId: "sub_1",
    });
  });

  it("reads an invoice in the current shape and in the shape before 2025", () => {
    const current = { type: "invoice.paid", data: { object: { id: "in_1", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } } } };
    const older = { type: "invoice.payment_failed", data: { object: { id: "in_1", customer: "cus_1", subscription: "sub_1" } } };
    expect(eventRefs(current)).toEqual({ customerId: "cus_1", subscriptionId: "sub_1" });
    expect(eventRefs(older)).toEqual({ customerId: "cus_1", subscriptionId: "sub_1" });
  });

  it("reads a checkout session, and ids given as expanded objects", () => {
    expect(eventRefs({ type: "checkout.session.completed", data: { object: { id: "cs_1", customer: { id: "cus_1" }, subscription: { id: "sub_1" } } } })).toEqual({
      customerId: "cus_1",
      subscriptionId: "sub_1",
    });
  });

  it("gives nulls, never a guess, for a one-off invoice, a payment-mode checkout, or junk", () => {
    expect(eventRefs({ type: "invoice.paid", data: { object: { id: "in_1", customer: "cus_1", parent: null } } })).toEqual({ customerId: "cus_1", subscriptionId: null });
    expect(eventRefs({ type: "checkout.session.completed", data: { object: { id: "cs_1", customer: null, subscription: null } } })).toEqual({ customerId: null, subscriptionId: null });
    expect(eventRefs({ type: "invoice.paid", data: { object: null } })).toEqual({ customerId: null, subscriptionId: null });
    expect(eventRefs({ type: "invoice.paid", data: { object: { customer: 42, subscription: {} } } })).toEqual({ customerId: null, subscriptionId: null });
  });

  it("knows which kinds of notification the app uses", () => {
    expect(isHandledEventType("invoice.paid")).toBe(true);
    expect(isHandledEventType("customer.subscription.deleted")).toBe(true);
    expect(isHandledEventType("customer.updated")).toBe(false);
    expect(isHandledEventType("charge.succeeded")).toBe(false);
  });
});

describe("snapshotFromSubscription", () => {
  function subscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at: null,
      cancel_at_period_end: false,
      latest_invoice: { id: "in_1", status: "paid" },
      items: { data: [{ current_period_end: 1_793_491_200 }] },
      metadata: { billingPlanId: "plan_1" },
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  it("reduces a subscription to the facts the rules read", () => {
    expect(snapshotFromSubscription(subscription())).toEqual({
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "active",
      latestInvoicePaid: true,
      currentPeriodEnd: new Date(1_793_491_200 * 1000),
      cancelAt: null,
      planId: "plan_1",
    });
  });

  it("an invoice that is open, written off, void, missing or not expanded is not 'paid'", () => {
    for (const latest_invoice of [{ status: "open" }, { status: "uncollectible" }, { status: "void" }, { status: "draft" }, null, "in_not_expanded"]) {
      expect(snapshotFromSubscription(subscription({ latest_invoice }))?.latestInvoicePaid).toBe(false);
    }
  });

  it("reads a scheduled cancellation from either way Stripe expresses it", () => {
    expect(snapshotFromSubscription(subscription({ cancel_at: 1_800_000_000 }))?.cancelAt).toEqual(new Date(1_800_000_000 * 1000));
    expect(snapshotFromSubscription(subscription({ cancel_at_period_end: true }))?.cancelAt).toEqual(new Date(1_793_491_200 * 1000));
  });

  it("metadata from the checkout SESSION is not assumed: no plan id on the subscription means none", () => {
    expect(snapshotFromSubscription(subscription({ metadata: {} }))?.planId).toBeNull();
    expect(snapshotFromSubscription(subscription({ metadata: undefined }))?.planId).toBeNull();
  });

  it("a subscription with no customer cannot be used", () => {
    expect(snapshotFromSubscription(subscription({ customer: null }))).toBeNull();
  });
});
