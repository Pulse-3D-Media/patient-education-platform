import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleStripeEvent, retryBillingEvent, type IncomingEvent } from "../billing-events";
import type { SubscriptionSnapshot } from "../billing-state";
import { clinicIsOpen } from "../clinic-status";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import {
  BillingRefusedError,
  NEEDS_LOOK,
  countBillingEventsNeedingAttention,
  listBillingEvents,
  recordAcceptedPlan,
  setStripeCustomer,
  type AcceptedPlanInput,
} from "./billing";
import { prisma } from "./client";
import { setClinicManagedByPulse, setClinicStatusByStaff } from "./clinics";
import { createPricingVersion } from "./pricing";
import { getSettings } from "./settings";
import { ShareRefusedError, createShare } from "./shares";

/**
 * Billing against the real test database, with a stand-in for Stripe.
 *
 * Nothing here talks to Stripe and no real id, key or notification body is
 * used: every customer, subscription and event id is made up per test, and
 * "Stripe" is a small object in memory that answers "where does this
 * subscription stand now?", which is the only question the app ever asks.
 *
 * Everything made here (clinics, their billing rows, plans, notifications,
 * one pricing version that is never made active) is deleted afterwards.
 */

const tag = randomBytes(5).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;

const createdClinicIds: string[] = [];
const createdEventIds: string[] = [];
let pricingVersionId = "";
let videoId = "";
let graceDays = 14;

/** The stand-in for Stripe: what each subscription looks like right now. */
const stripeNow = new Map<string, SubscriptionSnapshot>();
let fetchCalls = 0;
const fetchSubscription = async (id: string) => {
  fetchCalls += 1;
  return stripeNow.get(id) ?? null;
};
const deps = { fetchSubscription };

beforeAll(async () => {
  const version = await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest billing fixtures. Never active.", { userId: "user_vitest", name: "Vitest" });
  pricingVersionId = version.id;
  const video = await prisma.video.create({
    data: { title: `Vitest billing video ${tag}`, category: "KNEE", videoUrl: "https://example.com/v.mp4", isPublished: true },
    select: { id: true },
  });
  videoId = video.id;
  graceDays = (await getSettings()).graceDays;
});

afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { stripeEventId: { in: createdEventIds } } });
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (videoId) await prisma.video.deleteMany({ where: { id: videoId } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

function planInput(overrides: Partial<AcceptedPlanInput> = {}): AcceptedPlanInput {
  return {
    pricingVersionId,
    categories: ["KNEE", "HIP"],
    entitledCategories: ["KNEE", "HIP"],
    surgeonSeats: 3,
    interval: "MONTH",
    perSeatCents: 8900,
    totalCents: 26700,
    acceptedById: "user_vitest_admin",
    acceptedByName: "Vitest Admin",
    ...overrides,
  };
}

/** A clinic that has started a checkout: a Stripe customer and an accepted plan waiting for its first payment. */
async function makeCheckoutClinic(label: string) {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest billing ${label} ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinic.id, customerId);
  const plan = await recordAcceptedPlan(clinic.id, planInput());
  return { clinicId: clinic.id, customerId, subscriptionId, planId: plan.id };
}

type Fixture = Awaited<ReturnType<typeof makeCheckoutClinic>>;

/** Say what Stripe reports for a fixture's subscription from now on. */
function stripeSays(f: Fixture, status: string, more: Partial<SubscriptionSnapshot> = {}) {
  stripeNow.set(f.subscriptionId, {
    subscriptionId: f.subscriptionId,
    customerId: f.customerId,
    status,
    latestInvoicePaid: status === "active",
    currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    cancelAt: null,
    planId: f.planId,
    ...more,
  });
}

/** A notification, reduced to what the app reads from one: its id, its kind, and whom it is about. */
function event(f: { customerId: string; subscriptionId: string }, type: string, id = unique("evt")): IncomingEvent {
  createdEventIds.push(id);
  const object = type.startsWith("invoice.")
    ? { id: unique("in"), customer: f.customerId, parent: { subscription_details: { subscription: f.subscriptionId } } }
    : type.startsWith("checkout.")
      ? { id: unique("cs"), customer: f.customerId, subscription: f.subscriptionId }
      : { id: f.subscriptionId, customer: f.customerId };
  return { id, type, livemode: false, data: { object } };
}

const clinicRow = (id: string) =>
  prisma.clinic.findUniqueOrThrow({
    where: { id },
    select: { status: true, graceEndsAt: true, staffAccess: true, categories: true, surgeonSeats: true, pricingVersionId: true, statusChangedBy: true },
  });
const billingRow = (clinicId: string) => prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId } });
const billingNotes = (clinicId: string) => prisma.clinicNote.findMany({ where: { clinicId, authorName: "billing" }, orderBy: { createdAt: "asc" } });
const eventRow = (stripeEventId: string) => prisma.billingEvent.findUniqueOrThrow({ where: { stripeEventId } });

/** Take a fixture to "paid and active". */
async function activate(f: Fixture) {
  stripeSays(f, "active");
  await handleStripeEvent(event(f, "invoice.paid"), deps);
}

describe("the first payment", () => {
  it("checkout finishing is not payment: an incomplete subscription opens nothing", async () => {
    const f = await makeCheckoutClinic("incomplete");
    stripeSays(f, "incomplete");

    const result = await handleStripeEvent(event(f, "checkout.session.completed"), deps);

    expect(result.status).toBe("processed");
    expect((await billingRow(f.clinicId)).status).toBe("INCOMPLETE");
    const clinic = await clinicRow(f.clinicId);
    expect(clinic.status).toBe("PENDING");
    expect(clinic.categories).toEqual([]);
    expect(clinicIsOpen(clinic)).toBe(false);
  });

  it("a failed first payment gives no grace and no access", async () => {
    const f = await makeCheckoutClinic("first-fail");
    stripeSays(f, "incomplete");

    await handleStripeEvent(event(f, "customer.subscription.created"), deps);
    await handleStripeEvent(event(f, "invoice.payment_failed"), deps);

    const billing = await billingRow(f.clinicId);
    expect(billing.status).toBe("INCOMPLETE");
    expect(billing.paymentFailedAt).toBeNull();
    expect(billing.graceEndsAt).toBeNull();
    expect((await clinicRow(f.clinicId)).status).toBe("PENDING");
  });

  it("a confirmed payment opens the clinic, applies the accepted plan, pins its prices, and logs it once", async () => {
    const f = await makeCheckoutClinic("activate");
    await activate(f);

    const billing = await billingRow(f.clinicId);
    expect(billing).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: f.subscriptionId, currentPlanId: f.planId, pendingPlanId: null });
    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "ACTIVE", surgeonSeats: 3, pricingVersionId, statusChangedBy: "billing" });
    expect(clinic.categories.sort()).toEqual(["HIP", "KNEE"]);

    const notes = await billingNotes(f.clinicId);
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("STATUS");
    expect(notes[0].body).toContain("First payment confirmed");
    expect(notes[0].body).toContain("Status is now Active.");

    // And the clinic can now make a link for a video on its plan.
    const share = await createShare(f.clinicId, videoId);
    expect(share.code).toBeTruthy();
  });
});

describe("repeats, order and overlap", () => {
  it("the same notification delivered again does nothing and logs nothing", async () => {
    const f = await makeCheckoutClinic("duplicate");
    stripeSays(f, "active");
    const paid = event(f, "invoice.paid");

    expect((await handleStripeEvent(paid, deps)).status).toBe("processed");
    const callsAfterFirst = fetchCalls;
    expect((await handleStripeEvent(paid, deps)).status).toBe("duplicate");
    expect((await handleStripeEvent(paid, deps)).status).toBe("duplicate");

    expect(fetchCalls).toBe(callsAfterFirst); // a repeat does not even ask Stripe
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
    expect(await prisma.billingEvent.count({ where: { stripeEventId: paid.id } })).toBe(1);
    expect((await eventRow(paid.id)).attempts).toBe(1);
  });

  it("different notifications about the same change log it once", async () => {
    const f = await makeCheckoutClinic("same-change");
    stripeSays(f, "active");

    await handleStripeEvent(event(f, "checkout.session.completed"), deps);
    await handleStripeEvent(event(f, "customer.subscription.updated"), deps);
    await handleStripeEvent(event(f, "invoice.paid"), deps);

    expect(await billingNotes(f.clinicId)).toHaveLength(1);
  });

  it("notifications delivered in reverse order end in the state Stripe is in now", async () => {
    const f = await makeCheckoutClinic("reversed");
    await activate(f);

    // In Stripe: the renewal failed, then the customer fixed the card and it
    // was paid. Stripe now says active. The "paid" news arrives FIRST and
    // the older "failed" news arrives after it.
    stripeSays(f, "active");
    await handleStripeEvent(event(f, "invoice.paid"), deps);
    await handleStripeEvent(event(f, "invoice.payment_failed"), deps);

    expect((await billingRow(f.clinicId)).status).toBe("ACTIVE");
    const clinic = await clinicRow(f.clinicId);
    expect(clinic.status).toBe("ACTIVE");
    expect(clinic.graceEndsAt).toBeNull();
    // Only the activation was ever logged: the late "failed" news changed nothing.
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
  });

  it("several notifications handled at the same moment apply the change once", async () => {
    const f = await makeCheckoutClinic("concurrent");
    stripeSays(f, "active");

    const results = await Promise.all([
      handleStripeEvent(event(f, "checkout.session.completed"), deps),
      handleStripeEvent(event(f, "customer.subscription.created"), deps),
      handleStripeEvent(event(f, "customer.subscription.updated"), deps),
      handleStripeEvent(event(f, "invoice.paid"), deps),
    ]);

    expect(results.every((result) => result.status === "processed")).toBe(true);
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
    expect((await clinicRow(f.clinicId)).status).toBe("ACTIVE");
  });

  it("the SAME notification arriving three times at once is stored once and applied once", async () => {
    const f = await makeCheckoutClinic("same-at-once");
    stripeSays(f, "active");
    const paid = event(f, "invoice.paid");

    await Promise.all([handleStripeEvent(paid, deps), handleStripeEvent(paid, deps), handleStripeEvent(paid, deps)]);

    expect(await prisma.billingEvent.count({ where: { stripeEventId: paid.id } })).toBe(1);
    expect((await eventRow(paid.id)).status).toBe("PROCESSED");
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
  });
});

describe("failure and retry", () => {
  it("when Stripe cannot be reached nothing changes, the notification is marked failed by kind only, and the next delivery does the work", async () => {
    const f = await makeCheckoutClinic("retry");
    stripeSays(f, "active");
    const paid = event(f, "invoice.paid");

    const secretLooking = "sk_test_THIS_MUST_NEVER_BE_STORED";
    const broken = {
      fetchSubscription: async () => {
        const error = new Error(`connection failed for key ${secretLooking}`);
        (error as Error & { type: string }).type = "StripeConnectionError";
        throw error;
      },
    };
    await expect(handleStripeEvent(paid, broken)).rejects.toThrow();

    let row = await eventRow(paid.id);
    expect(row).toMatchObject({ status: "FAILED", lastErrorCode: "StripeConnectionError", attempts: 1, processedAt: null });
    expect(JSON.stringify(row)).not.toContain(secretLooking);
    expect((await billingRow(f.clinicId)).status).toBe("NONE");
    expect((await clinicRow(f.clinicId)).status).toBe("PENDING");
    expect(await billingNotes(f.clinicId)).toHaveLength(0);
    expect((await listBillingEvents({ attention: true })).some((listed) => listed.id === row.id)).toBe(true);
    expect(await countBillingEventsNeedingAttention()).toBeGreaterThanOrEqual(1);

    // Stripe sends it again.
    expect((await handleStripeEvent(paid, deps)).status).toBe("processed");
    row = await eventRow(paid.id);
    expect(row).toMatchObject({ status: "PROCESSED", lastErrorCode: null, attempts: 2 });
    expect((await clinicRow(f.clinicId)).status).toBe("ACTIVE");
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
  });

  it("a failure partway through rolls back everything, including the part already written", async () => {
    const f = await makeCheckoutClinic("rollback");
    // Damage the fixture the way no code path can: point this clinic's
    // waiting plan at ANOTHER clinic's plan. The financial record is written
    // first, then the plan is checked and refused, which must undo the write.
    const other = await makeCheckoutClinic("rollback-other");
    await prisma.clinicBilling.update({ where: { clinicId: other.clinicId }, data: { pendingPlanId: null } });
    await prisma.clinicBilling.update({ where: { clinicId: f.clinicId }, data: { pendingPlanId: other.planId } });
    stripeSays(f, "active", { planId: other.planId });
    const paid = event(f, "invoice.paid");

    await expect(handleStripeEvent(paid, deps)).rejects.toThrow(/does not belong/);

    expect(await billingRow(f.clinicId)).toMatchObject({ status: "NONE", stripeSubscriptionId: null, currentPlanId: null });
    expect((await clinicRow(f.clinicId)).status).toBe("PENDING");
    expect(await billingNotes(f.clinicId)).toHaveLength(0);
    expect((await eventRow(paid.id)).status).toBe("FAILED");
  });

  it("staff can try a failed notification again from its stored row, and a finished one is left alone", async () => {
    const f = await makeCheckoutClinic("staff-retry");
    stripeSays(f, "active");
    const paid = event(f, "invoice.paid");
    await expect(handleStripeEvent(paid, { fetchSubscription: async () => Promise.reject(new Error("down")) })).rejects.toThrow();

    const row = await eventRow(paid.id);
    expect((await retryBillingEvent(row.id, deps))?.status).toBe("processed");
    expect((await clinicRow(f.clinicId)).status).toBe("ACTIVE");

    expect((await retryBillingEvent(row.id, deps))?.status).toBe("duplicate");
    expect(await billingNotes(f.clinicId)).toHaveLength(1);
    expect(await retryBillingEvent("no_such_row", deps)).toBeNull();
  });
});

describe("whose subscription it is", () => {
  it("news about a customer no clinic has is closed as ignored", async () => {
    const stranger = { customerId: unique("cus"), subscriptionId: unique("sub") };
    const result = await handleStripeEvent(event(stranger, "invoice.paid"), deps);
    expect(result.status).toBe("ignored");
  });

  it("a kind of notification the app does not use is not even stored", async () => {
    const f = await makeCheckoutClinic("unused-kind");
    const unused = event(f, "customer.updated");
    expect((await handleStripeEvent(unused, deps)).status).toBe("skipped");
    expect(await prisma.billingEvent.count({ where: { stripeEventId: unused.id } })).toBe(0);
  });

  it("a live-mode notification is refused", async () => {
    const f = await makeCheckoutClinic("livemode");
    stripeSays(f, "active");
    const live = { ...event(f, "invoice.paid"), livemode: true };
    expect((await handleStripeEvent(live, deps)).status).toBe("ignored");
    expect((await clinicRow(f.clinicId)).status).toBe("PENDING");
  });

  it("an unrelated subscription on the clinic's customer changes nothing", async () => {
    const f = await makeCheckoutClinic("unrelated");
    await activate(f);
    const unrelated = { customerId: f.customerId, subscriptionId: unique("sub") };
    stripeNow.set(unrelated.subscriptionId, {
      subscriptionId: unrelated.subscriptionId,
      customerId: f.customerId,
      status: "canceled",
      latestInvoicePaid: false,
      currentPeriodEnd: null,
      cancelAt: null,
      planId: null,
    });

    const result = await handleStripeEvent(event(unrelated, "customer.subscription.deleted"), deps);

    expect(result.status).toBe("ignored");
    expect(await billingRow(f.clinicId)).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: f.subscriptionId });
    expect((await clinicRow(f.clinicId)).status).toBe("ACTIVE");
  });

  it("late news of the OLD cancelled subscription cannot undo the plan that replaced it", async () => {
    const f = await makeCheckoutClinic("replaced");
    await activate(f);
    stripeSays(f, "canceled");
    await handleStripeEvent(event(f, "customer.subscription.deleted"), deps);
    expect((await clinicRow(f.clinicId)).status).toBe("CANCELED");

    // The clinic checks out again: a new accepted plan and a new subscription.
    const newPlan = await recordAcceptedPlan(f.clinicId, planInput({ categories: ["KNEE"], entitledCategories: ["KNEE"], surgeonSeats: 1, perSeatCents: 5900, totalCents: 5900 }));
    const replacement: Fixture = { ...f, subscriptionId: unique("sub"), planId: newPlan.id };
    stripeSays(replacement, "active");
    await handleStripeEvent(event(replacement, "invoice.paid"), deps);
    expect(await billingRow(f.clinicId)).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: replacement.subscriptionId, currentPlanId: newPlan.id });

    // Stripe re-sends the old subscription's cancellation, days late.
    const late = await handleStripeEvent(event(f, "customer.subscription.deleted"), deps);

    expect(late.status).toBe("ignored");
    expect(await billingRow(f.clinicId)).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: replacement.subscriptionId });
    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "ACTIVE", surgeonSeats: 1 });
    expect(clinic.categories).toEqual(["KNEE"]);
  });

  it("a second live subscription is flagged for a person to look at, and changes nothing", async () => {
    const f = await makeCheckoutClinic("second-sub");
    await activate(f);
    // Force the odd state: a plan waiting while a subscription is already paid for.
    const extra = await prisma.billingPlan.create({ data: { clinicId: f.clinicId, ...planInput() }, select: { id: true } });
    await prisma.clinicBilling.update({ where: { clinicId: f.clinicId }, data: { pendingPlanId: extra.id } });
    const second: Fixture = { ...f, subscriptionId: unique("sub"), planId: extra.id };
    stripeSays(second, "active");
    const news = event(second, "customer.subscription.created");

    await handleStripeEvent(news, deps);

    const row = await eventRow(news.id);
    expect(row.status).toBe("IGNORED");
    expect(row.outcome?.startsWith(NEEDS_LOOK)).toBe(true);
    expect((await billingRow(f.clinicId)).stripeSubscriptionId).toBe(f.subscriptionId);
    expect((await listBillingEvents({ attention: true })).some((listed) => listed.id === row.id)).toBe(true);
  });

  it("one clinic's news never touches another clinic", async () => {
    const a = await makeCheckoutClinic("iso-a");
    const b = await makeCheckoutClinic("iso-b");
    await activate(a);

    expect((await clinicRow(b.clinicId)).status).toBe("PENDING");
    expect((await billingRow(b.clinicId)).status).toBe("NONE");
    expect(await billingNotes(b.clinicId)).toHaveLength(0);

    // A notification that names A's customer but B's subscription: B's
    // subscription belongs to another customer, so nothing happens to either.
    stripeSays(b, "active");
    const crossed = await handleStripeEvent(event({ customerId: a.customerId, subscriptionId: b.subscriptionId }, "invoice.paid"), deps);
    expect(crossed.status).toBe("ignored");
    expect((await clinicRow(b.clinicId)).status).toBe("PENDING");
    expect((await billingRow(a.clinicId)).stripeSubscriptionId).toBe(a.subscriptionId);
  });
});

describe("a failed renewal and grace", () => {
  it("starts grace once, keeps the clinic open inside it, and duplicates do not extend it", async () => {
    const f = await makeCheckoutClinic("grace");
    await activate(f);
    stripeSays(f, "past_due");

    const failedAt = new Date();
    await handleStripeEvent(event(f, "invoice.payment_failed"), { ...deps, now: failedAt });

    const billing = await billingRow(f.clinicId);
    const deadline = new Date(failedAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
    expect(billing).toMatchObject({ status: "PAST_DUE", paymentFailedAt: failedAt, graceEndsAt: deadline });
    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "PAST_DUE", graceEndsAt: deadline });
    expect(clinicIsOpen(clinic, new Date(deadline.getTime() - 1))).toBe(true);
    expect(clinicIsOpen(clinic, deadline)).toBe(false);
    // In grace, right now, links can still be made.
    await expect(createShare(f.clinicId, videoId)).resolves.toBeTruthy();

    // Stripe retries the card and fails again, twice, over the next days.
    const later = new Date(failedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    await handleStripeEvent(event(f, "invoice.payment_failed"), { ...deps, now: later });
    await handleStripeEvent(event(f, "customer.subscription.updated"), { ...deps, now: later });

    expect((await billingRow(f.clinicId)).graceEndsAt).toEqual(deadline);
    expect((await clinicRow(f.clinicId)).graceEndsAt).toEqual(deadline);
    expect(await billingNotes(f.clinicId)).toHaveLength(2); // the activation, and the ONE failure
  });

  it("once the deadline has passed the clinic is closed everywhere at once, with no job having to run", async () => {
    const f = await makeCheckoutClinic("grace-over");
    await activate(f);
    stripeSays(f, "past_due");

    // The failure was first recorded long enough ago that grace is over.
    const longAgo = new Date(Date.now() - (graceDays + 1) * 24 * 60 * 60 * 1000);
    await handleStripeEvent(event(f, "invoice.payment_failed"), { ...deps, now: longAgo });

    const clinic = await clinicRow(f.clinicId);
    expect(clinic.status).toBe("PAST_DUE");
    expect(clinicIsOpen(clinic)).toBe(false);
    await expect(createShare(f.clinicId, videoId)).rejects.toBeInstanceOf(ShareRefusedError);
  });

  it("recovery clears grace and reopens, and a link made in grace outlives the closure in between", async () => {
    const f = await makeCheckoutClinic("recover");
    await activate(f);
    const share = await createShare(f.clinicId, videoId);

    stripeSays(f, "past_due");
    const longAgo = new Date(Date.now() - (graceDays + 1) * 24 * 60 * 60 * 1000);
    await handleStripeEvent(event(f, "invoice.payment_failed"), { ...deps, now: longAgo });
    expect(clinicIsOpen(await clinicRow(f.clinicId))).toBe(false);
    // The patient's link is untouched by the clinic closing (prompt 7's rule).
    expect(await prisma.share.findUnique({ where: { code: share.code }, select: { expiresAt: true } })).toEqual({ expiresAt: share.expiresAt });

    stripeSays(f, "active");
    await handleStripeEvent(event(f, "invoice.paid"), deps);

    expect(await billingRow(f.clinicId)).toMatchObject({ status: "ACTIVE", paymentFailedAt: null, graceEndsAt: null });
    expect(await clinicRow(f.clinicId)).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
  });

  it("a scheduled cancellation keeps the clinic open until Stripe actually ends the subscription", async () => {
    const f = await makeCheckoutClinic("cancel-later");
    await activate(f);
    const cancelAt = new Date("2026-11-01T00:00:00.000Z");
    stripeSays(f, "active", { cancelAt });
    await handleStripeEvent(event(f, "customer.subscription.updated"), deps);

    expect(await billingRow(f.clinicId)).toMatchObject({ status: "ACTIVE", cancelAt });
    expect((await clinicRow(f.clinicId)).status).toBe("ACTIVE");

    stripeSays(f, "canceled");
    await handleStripeEvent(event(f, "customer.subscription.deleted"), deps);
    expect((await clinicRow(f.clinicId)).status).toBe("CANCELED");
    await expect(createShare(f.clinicId, videoId)).rejects.toBeInstanceOf(ShareRefusedError);
  });
});

describe("what staff set by hand wins over billing", () => {
  it("a payment arriving, however late, never reopens a clinic staff paused; removing the pause hands it back to billing", async () => {
    const f = await makeCheckoutClinic("staff-pause");
    await activate(f);

    const paused = await setClinicStatusByStaff(f.clinicId, "PAUSED", "Misuse reported.", "Vitest Staff");
    expect(paused.clinic.status).toBe("PAUSED");
    expect(paused.stillCharging).toBe(true); // the screen must say Stripe is still charging

    // Old and new news alike: a renewal is paid, a subscription is updated.
    stripeSays(f, "active");
    await handleStripeEvent(event(f, "invoice.paid"), deps);
    await handleStripeEvent(event(f, "customer.subscription.updated"), deps);

    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "PAUSED", staffAccess: "PAUSED", statusChangedBy: "Vitest Staff" });
    expect((await billingRow(f.clinicId)).status).toBe("ACTIVE"); // the financial record is still true
    await expect(createShare(f.clinicId, videoId)).rejects.toBeInstanceOf(ShareRefusedError);

    const followed = await setClinicStatusByStaff(f.clinicId, null, "Resolved.", "Vitest Staff");
    expect(followed.clinic.status).toBe("ACTIVE");
  });

  it("a staff pause also survives the subscription failing and recovering underneath it, and the log says why nothing moved", async () => {
    const f = await makeCheckoutClinic("pause-under");
    await activate(f);
    await setClinicStatusByStaff(f.clinicId, "PAUSED", "On hold.", "Vitest Staff");

    stripeSays(f, "past_due");
    await handleStripeEvent(event(f, "invoice.payment_failed"), deps);

    expect((await clinicRow(f.clinicId)).status).toBe("PAUSED");
    expect((await billingRow(f.clinicId)).status).toBe("PAST_DUE");
    const notes = await billingNotes(f.clinicId);
    expect(notes.at(-1)?.body).toContain("set by hand, and that wins over billing");
  });

  it("a clinic opened by hand follows billing from its first card payment on", async () => {
    const f = await makeCheckoutClinic("opened-by-hand");
    await setClinicStatusByStaff(f.clinicId, "OPEN", "Pilot clinic.", "Vitest Staff");
    await activate(f);

    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "ACTIVE", staffAccess: null });
    expect((await billingNotes(f.clinicId))[0].body).toContain("opened by hand");
  });

  it("a Pulse-managed clinic keeps the plan and access staff gave it; billing news is still recorded and logged", async () => {
    const f = await makeCheckoutClinic("managed");
    await prisma.clinic.update({ where: { id: f.clinicId }, data: { categories: ["SPINE"], surgeonSeats: 12 } });
    await setClinicStatusByStaff(f.clinicId, "OPEN", "Enterprise, invoiced.", "Vitest Staff");
    await setClinicManagedByPulse(f.clinicId, true, "Vitest Staff");

    await activate(f);
    stripeSays(f, "past_due");
    const longAgo = new Date(Date.now() - (graceDays + 5) * 24 * 60 * 60 * 1000);
    await handleStripeEvent(event(f, "invoice.payment_failed"), { ...deps, now: longAgo });

    const clinic = await clinicRow(f.clinicId);
    expect(clinic).toMatchObject({ status: "ACTIVE", staffAccess: "OPEN", surgeonSeats: 12, pricingVersionId: null });
    expect(clinic.categories).toEqual(["SPINE"]);
    expect(clinicIsOpen(clinic)).toBe(true);
    expect((await billingRow(f.clinicId)).status).toBe("PAST_DUE");
    const notes = await billingNotes(f.clinicId);
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.body.includes("managed by Pulse"))).toBe(true);
  });

  it("turning managed ON for a clinic that is open because it pays keeps it open, and warns that Stripe is still charging", async () => {
    const f = await makeCheckoutClinic("to-managed");
    await activate(f);

    const change = await setClinicManagedByPulse(f.clinicId, true, "Vitest Staff");

    expect(change.clinic).toMatchObject({ status: "ACTIVE", staffAccess: "OPEN", managedByPulse: true });
    expect(change.stillCharging).toBe(true);
    expect(change.logged).toContain("set to Open by hand to keep it open");
    expect((await billingRow(f.clinicId)).status).toBe("ACTIVE"); // nothing was cancelled
  });
});

describe("setStripeCustomer and recordAcceptedPlan", () => {
  it("a clinic's Stripe customer is set once: the same id again is fine, a different one is refused", async () => {
    const f = await makeCheckoutClinic("customer-once");
    await expect(setStripeCustomer(f.clinicId, f.customerId)).resolves.toBeTruthy();
    await expect(setStripeCustomer(f.clinicId, unique("cus"))).rejects.toBeInstanceOf(BillingRefusedError);
    await expect(setStripeCustomer(f.clinicId, "not an id")).rejects.toBeInstanceOf(BillingRefusedError);
    await expect(setStripeCustomer("no_such_clinic", unique("cus"))).rejects.toBeInstanceOf(BillingRefusedError);
  });

  it("one Stripe customer cannot be attached to two clinics", async () => {
    const a = await makeCheckoutClinic("cust-a");
    const b = await prisma.clinic.create({ data: { name: `Vitest billing cust-b ${tag}` }, select: { id: true } });
    createdClinicIds.push(b.id);
    await expect(setStripeCustomer(b.id, a.customerId)).rejects.toThrow();
  });

  it("refuses a plan whose numbers do not add up, and writes nothing", async () => {
    const f = await makeCheckoutClinic("bad-plan");
    const before = await prisma.billingPlan.count({ where: { clinicId: f.clinicId } });
    const bad: Partial<AcceptedPlanInput>[] = [
      { surgeonSeats: 0, totalCents: 0 },
      { surgeonSeats: 1.5 },
      { totalCents: 26701 },
      { perSeatCents: Number.NaN },
      { perSeatCents: -1, totalCents: -3 },
      { categories: [] },
      { categories: ["KNEE", "KNEE"] },
      { entitledCategories: ["KNEE"] }, // charges for Hip but does not include it
      { acceptedByName: "" },
    ];
    for (const overrides of bad) {
      await expect(recordAcceptedPlan(f.clinicId, planInput(overrides))).rejects.toBeInstanceOf(BillingRefusedError);
    }
    expect(await prisma.billingPlan.count({ where: { clinicId: f.clinicId } })).toBe(before);
  });

  it("an accepted plan is kept as history when another replaces it, and none can be accepted over a live subscription", async () => {
    const f = await makeCheckoutClinic("plan-history");
    const second = await recordAcceptedPlan(f.clinicId, planInput({ surgeonSeats: 4, totalCents: 35600 }));
    expect((await billingRow(f.clinicId)).pendingPlanId).toBe(second.id);
    expect(await prisma.billingPlan.count({ where: { clinicId: f.clinicId } })).toBe(2);

    const live: Fixture = { ...f, planId: second.id };
    await activate(live);
    await expect(recordAcceptedPlan(f.clinicId, planInput())).rejects.toBeInstanceOf(BillingRefusedError);
  });
});
