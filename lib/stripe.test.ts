import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StripeConfigError,
  checkoutIsOpen,
  checkoutSessionParams,
  eventRefs,
  getWebhookSecret,
  isHandledEventType,
  isTestSecretKey,
  snapshotFromSubscription,
  stateFromSubscription,
  verifyWebhook,
} from "./stripe";

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

  it("finds the subscription a schedule notification is about, including one the schedule has let go of", () => {
    expect(eventRefs({ type: "subscription_schedule.updated", data: { object: { id: "sub_sched_1", customer: "cus_1", subscription: "sub_1" } } })).toEqual({ customerId: "cus_1", subscriptionId: "sub_1" });
    expect(
      eventRefs({ type: "subscription_schedule.released", data: { object: { id: "sub_sched_1", customer: "cus_1", subscription: null, released_subscription: "sub_1" } } }),
    ).toEqual({ customerId: "cus_1", subscriptionId: "sub_1" });
  });

  it("uses the notifications a plan change sends", () => {
    for (const type of [
      "customer.subscription.pending_update_applied",
      "customer.subscription.pending_update_expired",
      "invoice.voided",
      "subscription_schedule.updated",
      "subscription_schedule.released",
    ]) {
      expect(isHandledEventType(type)).toBe(true);
    }
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
      // A subscription that has never had a plan change names no other plan.
      itemPlanId: null,
      pendingPlanId: null,
      scheduledPlanId: null,
      scheduledAt: null,
    });
  });

  it("reads a plan change off the subscription: the plan its price was made for, one waiting for payment, one scheduled", () => {
    const price = (plan: string) => ({ id: `price_${plan}`, metadata: { billingPlanId: plan } });
    const renewal = 1_793_491_200;
    const changed = snapshotFromSubscription(
      subscription({
        items: { data: [{ id: "si_1", current_period_end: renewal, price: price("plan_2") }] },
        pending_update: { subscription_items: [{ id: "si_1", price: price("plan_3") }] },
        schedule: {
          id: "sub_sched_1",
          status: "active",
          current_phase: { start_date: renewal - 2_592_000, end_date: renewal },
          phases: [
            { start_date: renewal - 2_592_000, end_date: renewal, metadata: {}, items: [] },
            { start_date: renewal, end_date: renewal + 2_592_000, metadata: { billingPlanId: "plan_4" }, items: [] },
          ],
        },
      }),
    );
    expect(changed).toMatchObject({ planId: "plan_1", itemPlanId: "plan_2", pendingPlanId: "plan_3", scheduledPlanId: "plan_4", scheduledAt: new Date(renewal * 1000) });
  });

  it("a schedule with nothing left to change, one that is over, or one that was not expanded schedules nothing", () => {
    const renewal = 1_793_491_200;
    const spent = {
      id: "sub_sched_1",
      status: "active",
      current_phase: { start_date: renewal - 2_592_000, end_date: renewal },
      // The only phases are a finished one and the one running now.
      phases: [
        { start_date: renewal - 5_184_000, end_date: renewal - 2_592_000, metadata: {}, items: [] },
        { start_date: renewal - 2_592_000, end_date: renewal, metadata: { billingPlanId: "plan_2" }, items: [] },
      ],
    };
    for (const schedule of [spent, { ...spent, status: "released" }, { ...spent, status: "canceled" }, "sub_sched_not_expanded", null]) {
      expect(snapshotFromSubscription(subscription({ schedule }))).toMatchObject({ scheduledPlanId: null, scheduledAt: null });
    }
    // A next phase this server did not mark with a plan is not a scheduled plan (and carries no date).
    const unmarked = { ...spent, phases: [spent.phases[1], { start_date: renewal, end_date: renewal + 2_592_000, metadata: {}, items: [] }] };
    expect(snapshotFromSubscription(subscription({ schedule: unmarked }))).toMatchObject({ scheduledPlanId: null, scheduledAt: null });
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

describe("checkoutIsOpen: test-mode checkout is never offered on the production deployment", () => {
  const key = "sk_test_made_up_for_vitest";

  it("is off unless BILLING_CHECKOUT is exactly test", () => {
    expect(checkoutIsOpen({ STRIPE_SECRET_KEY: key })).toBe(false);
    for (const value of ["", "on", "true", "1", "TEST", "live"]) expect(checkoutIsOpen({ BILLING_CHECKOUT: value, STRIPE_SECRET_KEY: key })).toBe(false);
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test", STRIPE_SECRET_KEY: key })).toBe(true);
  });

  it("needs a test key: no key, or a live key, keeps it shut", () => {
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test" })).toBe(false);
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test", STRIPE_SECRET_KEY: "sk_live_made_up_for_vitest" })).toBe(false);
  });

  it("stays shut on Vercel's production deployment even when the switch was set there by mistake", () => {
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test", STRIPE_SECRET_KEY: key, VERCEL_ENV: "production" })).toBe(false);
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test", STRIPE_SECRET_KEY: key, VERCEL_ENV: "preview" })).toBe(true);
    expect(checkoutIsOpen({ BILLING_CHECKOUT: "test", STRIPE_SECRET_KEY: key, VERCEL_ENV: "development" })).toBe(true);
  });
});

describe("checkoutSessionParams: exactly what Stripe is asked to charge", () => {
  const args = {
    customerId: "cus_made_up",
    clinicId: "clinic_made_up",
    planId: "plan_made_up",
    perSeatCents: 8900,
    seats: 4,
    interval: "MONTH" as const,
    description: "Knee, Hip; 4 surgeon seats",
    origin: "https://app.example.com",
    expiresAt: new Date("2026-09-19T13:00:00.000Z"),
  };

  it("monthly: the per-seat amount is the unit price, the seats are the quantity, in US dollars, every month", () => {
    const params = checkoutSessionParams(args);
    expect(params.line_items).toEqual([
      { quantity: 4, price_data: { currency: "usd", product: "p3d_patient_education_library", unit_amount: 8900, recurring: { interval: "month", interval_count: 1 } } },
    ]);
  });

  it("yearly: a yearly price of the whole year's amount, once a year", () => {
    const params = checkoutSessionParams({ ...args, interval: "YEAR", perSeatCents: 89000 });
    expect(params.line_items?.[0].price_data).toMatchObject({ unit_amount: 89000, recurring: { interval: "year", interval_count: 1 } });
  });

  it("is a subscription for the clinic's own customer, asking for the card payment type only, with nothing the customer can change and no trial, discount or tax added", () => {
    const params = checkoutSessionParams(args);
    expect(params).toMatchObject({ mode: "subscription", customer: "cus_made_up", client_reference_id: "clinic_made_up", payment_method_types: ["card"] });
    for (const absent of ["allow_promotion_codes", "discounts", "automatic_tax", "customer_email", "payment_method_collection"] as const) {
      expect(params[absent]).toBeUndefined();
    }
    expect(params.line_items?.[0].adjustable_quantity).toBeUndefined();
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
    expect(params.subscription_data?.trial_end).toBeUndefined();
  });

  it("puts the plan id on the subscription itself, which is the only place the webhook looks", () => {
    const params = checkoutSessionParams(args);
    expect(params.subscription_data?.metadata).toEqual({ billingPlanId: "plan_made_up", clinicId: "clinic_made_up" });
    expect(params.metadata).toEqual({ billingPlanId: "plan_made_up", clinicId: "clinic_made_up" });
  });

  it("comes back to this site's own Billing pages, and expires when it is told to", () => {
    const params = checkoutSessionParams(args);
    expect(params.success_url).toBe("https://app.example.com/admin/billing/return");
    expect(params.cancel_url).toBe("https://app.example.com/admin/billing?checkout=cancelled");
    expect(params.expires_at).toBe(Date.parse("2026-09-19T13:00:00.000Z") / 1000);
  });
});

describe("stateFromSubscription: what a plan change reads", () => {
  const renewal = 1_793_491_200;
  function subscription(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at: null,
      cancel_at_period_end: false,
      latest_invoice: { id: "in_1", status: "paid", amount_due: 5900, hosted_invoice_url: "https://invoice.stripe.com/i/made_up" },
      items: { data: [{ id: "si_1", quantity: 3, current_period_start: renewal - 2_592_000, current_period_end: renewal, price: { id: "price_1", metadata: {} } }] },
      metadata: { billingPlanId: "plan_1" },
      pending_update: null,
      schedule: null,
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  it("a subscription that was never changed is on the plan checkout wrote on it", () => {
    expect(stateFromSubscription(subscription())).toEqual({
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "active",
      itemId: "si_1",
      quantity: 3,
      planId: "plan_1",
      periodStart: new Date((renewal - 2_592_000) * 1000),
      periodEnd: new Date(renewal * 1000),
      cancelAt: null,
      pending: null,
      schedule: null,
      openInvoice: null,
    });
  });

  it("the plan a price was made for wins over the older mark on the subscription", () => {
    const changed = subscription({ items: { data: [{ id: "si_2", quantity: 4, current_period_start: 1, current_period_end: renewal, price: { id: "price_2", metadata: { billingPlanId: "plan_2" } } }] } });
    expect(stateFromSubscription(changed)).toMatchObject({ planId: "plan_2", itemId: "si_2", quantity: 4 });
  });

  it("an unpaid latest invoice is the one to pay, but only with an address that is really Stripe's invoice page", () => {
    const open = (url: string | null) => subscription({ latest_invoice: { id: "in_2", status: "open", amount_due: 7866, hosted_invoice_url: url } });
    expect(stateFromSubscription(open("https://invoice.stripe.com/i/made_up"))?.openInvoice).toEqual({ id: "in_2", payUrl: "https://invoice.stripe.com/i/made_up", dueCents: 7866 });
    expect(stateFromSubscription(open("https://invoice.stripe.com.evil.example/i/x"))?.openInvoice).toEqual({ id: "in_2", payUrl: null, dueCents: 7866 });
    expect(stateFromSubscription(open(null))?.openInvoice?.payUrl).toBeNull();
    // Paid, void or not expanded: nothing to pay.
    for (const latest_invoice of [{ id: "in_3", status: "paid" }, { id: "in_3", status: "void" }, "in_not_expanded", null]) {
      expect(stateFromSubscription(subscription({ latest_invoice }))?.openInvoice).toBeNull();
    }
  });

  it("reads an upgrade waiting for payment, a scheduled change, a spent schedule, and a cancellation", () => {
    const waiting = subscription({ pending_update: { subscription_items: [{ id: "si_1", price: { id: "price_2", metadata: { billingPlanId: "plan_2" } } }] } });
    expect(stateFromSubscription(waiting)?.pending).toEqual({ planId: "plan_2" });

    const schedule = {
      id: "sub_sched_1",
      status: "active",
      current_phase: { start_date: renewal - 2_592_000, end_date: renewal },
      phases: [
        { start_date: renewal - 2_592_000, end_date: renewal, metadata: {}, items: [] },
        { start_date: renewal, end_date: renewal + 2_592_000, metadata: { billingPlanId: "plan_3" }, items: [] },
      ],
    };
    expect(stateFromSubscription(subscription({ schedule }))?.schedule).toEqual({ id: "sub_sched_1", next: { planId: "plan_3", at: new Date(renewal * 1000) } });
    // Spent: still attached (so it still blocks a cancellation at Stripe), with nothing next.
    expect(stateFromSubscription(subscription({ schedule: { ...schedule, phases: [schedule.phases[0]] } }))?.schedule).toEqual({ id: "sub_sched_1", next: null });
    // Not expanded: we know one is attached, and no more.
    expect(stateFromSubscription(subscription({ schedule: "sub_sched_9" }))?.schedule).toEqual({ id: "sub_sched_9", next: null });

    expect(stateFromSubscription(subscription({ cancel_at_period_end: true }))?.cancelAt).toEqual(new Date(renewal * 1000));
  });

  it("gives null, never a guess, for a subscription with no customer or no line", () => {
    expect(stateFromSubscription(subscription({ customer: null }))).toBeNull();
    expect(stateFromSubscription(subscription({ items: { data: [] } }))).toBeNull();
  });
});
