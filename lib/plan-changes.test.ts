import type { Category } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as billingDb from "./db/billing";
import { reconcileSubscription } from "./db/billing";
import { listSellableCategories } from "./db/category-config";
import { prisma } from "./db/client";
import { setClinicManagedByPulse, setClinicPracticeType, setClinicStatusByStaff } from "./db/clinics";
import { createPricingVersion, getActivePricing, type CurrentPricing } from "./db/pricing";
import { reserveSeat } from "./db/seats";
import type { ChangeRequest, ChangeSeen } from "./plan-change";
import { cancelWaitingChange, confirmPlanChange, findInvoiceToPay, openBillingPortal, reviewPlanChange, type ConfirmResult, type PlanChangeDeps } from "./plan-changes";
import { DEFAULT_PRICING_CONFIG, quote, type PricingConfig } from "./pricing";
import { clinicIsOpen } from "./clinic-status";
import { fakePlanStripe, type FakePlanStripe } from "./testing/fake-stripe-plans";

/**
 * Changing a plan that is being paid for, end to end on the server side,
 * against the real test database and an in-memory stand-in for Stripe
 * (lib/testing/fake-stripe-plans.ts, which behaves the way real Stripe test
 * mode was seen to behave).
 *
 * Nothing here talks to Stripe, and no real id or key is used. The prices
 * are two pricing versions this file saves and NEVER makes active (only one
 * version can be active in the whole shared table); which one "is active",
 * and which categories are for sale, are handed to the flow by stand-ins.
 *
 * A clinic "that is paying" is written straight into the tables the way a
 * confirmed first checkout leaves them, so each test starts from a known plan.
 */

vi.setConfig({ testTimeout: 40_000 });

vi.mock("./db/pricing", async (original) => ({ ...(await original<typeof import("./db/pricing")>()), getActivePricing: vi.fn() }));
vi.mock("./db/category-config", async (original) => ({ ...(await original<typeof import("./db/category-config")>()), listSellableCategories: vi.fn() }));
// The real lock, wrapped so one test (the control) can take it away and show what it prevents.
vi.mock("./db/billing", async (original) => {
  const actual = await original<typeof import("./db/billing")>();
  return { ...actual, withPlanChangeLock: vi.fn(actual.withPlanChangeLock) };
});

const tag = randomBytes(5).toString("hex");
const ALL: Category[] = ["SPINE", "COMPLEX_SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];
const ORIGIN = "https://billing-test.example";
const owner = { id: "user_vitest_owner", name: "Vitest Owner" };

/** "Now" for every test: ten days into a thirty-day period, so two thirds of the period is left to charge for. */
const NOW = new Date("2026-10-11T12:00:00.000Z");
const PERIOD_START = new Date("2026-10-01T12:00:00.000Z");
const PERIOD_END = new Date("2026-10-31T12:00:00.000Z");

/** Version B costs more than A: $64 for one category instead of $59. */
const CONFIG_B: PricingConfig = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [6400, 9400, 11400, 13000, 14400, 14400] };

const createdClinicIds: string[] = [];
const createdVersionIds: string[] = [];
let versionA = "";
let versionB = "";

function activeIs(versionId: string, config: PricingConfig) {
  const pricing: CurrentPricing = {
    source: { kind: "version", pinned: false, version: { id: versionId, version: 1, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
    config,
  };
  vi.mocked(getActivePricing).mockResolvedValue(pricing);
}

type Fixture = { clinicId: string; customerId: string; subscriptionId: string; planId: string; fake: FakePlanStripe };

/** A clinic with a paid subscription on version A's prices, as a confirmed first checkout leaves it. */
async function makePayingClinic(label: string, plan: { categories: Category[]; seats: number; interval?: "MONTH" | "YEAR" }, fake: FakePlanStripe = fakePlanStripe(tag)): Promise<Fixture> {
  const interval = plan.interval ?? "MONTH";
  const quoted = quote(DEFAULT_PRICING_CONFIG, { seats: plan.seats, categories: plan.categories, interval: interval === "YEAR" ? "year" : "month", founding: false, practiceType: "clinic", sellable: ALL });
  if (!quoted.ok || !quoted.quote.amounts) throw new Error("The fixture plan cannot be quoted.");
  const { perSeatCents, totalCents } = quoted.quote.amounts;
  const entitled = quoted.quote.entitledCategories;

  const clinic = await prisma.clinic.create({
    data: { name: `Vitest plan change ${label} ${tag}`, practiceType: "CLINIC", status: "ACTIVE", categories: entitled, surgeonSeats: plan.seats, pricingVersionId: versionA },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  const row = await prisma.billingPlan.create({
    data: { clinicId: clinic.id, pricingVersionId: versionA, categories: plan.categories, entitledCategories: entitled, surgeonSeats: plan.seats, interval, perSeatCents, totalCents, acceptedById: owner.id, acceptedByName: owner.name },
    select: { id: true },
  });
  const customerId = fake.newCustomerId();
  const subscriptionId = fake.start({ customerId, planId: row.id, perSeatCents, seats: plan.seats, interval, periodStart: PERIOD_START });
  await prisma.clinicBilling.create({
    data: { clinicId: clinic.id, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, status: "ACTIVE", currentPlanId: row.id, currentPeriodEnd: fake.subscriptions.get(subscriptionId)?.periodEnd },
  });
  return { clinicId: clinic.id, customerId, subscriptionId, planId: row.id, fake };
}

const depsFor = (fake: FakePlanStripe, more: Partial<PlanChangeDeps> = {}): PlanChangeDeps => ({ gateway: fake.gateway, fetchSubscription: fake.fetchSubscription, isOpen: true, now: NOW, ...more });

/** What the form would send for these picks: the picks, and the total it was showing. */
function ask(categories: Category[], seats: number, interval: "MONTH" | "YEAR", seenTotalCents: number, more: { move?: boolean; version?: string } = {}): ChangeRequest {
  return { selection: { categories, seats, interval, seenVersionId: more.version ?? versionA, seenTotalCents }, moveToCurrentPricing: more.move ?? false };
}

/** Review a change and confirm exactly what the review showed, as the owner pressing both buttons does. */
async function change(f: Fixture, request: ChangeRequest, deps: PlanChangeDeps = depsFor(f.fake)): Promise<ConfirmResult> {
  const review = await reviewPlanChange({ clinicId: f.clinicId, request, deps });
  if (review.kind !== "review") throw new Error(`The review was not offered: ${review.kind}, ${"message" in review ? review.message : ""}`);
  const seen: ChangeSeen = review.now ? { timing: "now", at: review.now.at, dueNowCents: review.now.dueNowCents } : { timing: "renewal", at: null, dueNowCents: null };
  return confirmPlanChange({ clinicId: f.clinicId, request, seen, actor: owner, deps });
}

/** What Stripe's notification does when it arrives: the same reconcile, from what "Stripe" says now. */
const notify = (f: Fixture) => reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: f.fake.fetchSubscription, now: NOW });

const clinicOf = (clinicId: string) => prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
const billingOf = (clinicId: string) => prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId } });
const plansOf = (clinicId: string) => prisma.billingPlan.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" } });
const logOf = async (clinicId: string) => (await prisma.clinicNote.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" } })).map((note) => note.body);
const sorted = (categories: Category[]) => [...categories].sort();

beforeAll(async () => {
  const staff = { userId: "user_vitest", name: "Vitest" };
  versionA = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest plan change fixtures A. Never active.", staff)).id;
  versionB = (await createPricingVersion(CONFIG_B, "Vitest plan change fixtures B. Never active.", staff)).id;
  createdVersionIds.push(versionA, versionB);
});

beforeEach(() => {
  activeIs(versionA, DEFAULT_PRICING_CONFIG);
  vi.mocked(listSellableCategories).mockResolvedValue(ALL);
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.seatAllocation.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.updateMany({ where: { id: { in: createdClinicIds } }, data: { pricingVersionId: null } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.pricingVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("an upgrade starts now, once it is paid for", () => {
  it("more seats: the review shows what Stripe will charge today, and confirming it changes the plan", async () => {
    const f = await makePayingClinic("more seats", { categories: ["KNEE"], seats: 2 });

    // Two seats at $59 become four: $236 a month. Two thirds of the period is left.
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 4, "MONTH", 23600), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", renewal: null, now: { dueNowCents: 7866, at: NOW, renewsAt: PERIOD_END }, summary: { seats: 4, perSeatCents: 5900, totalCents: 23600, interval: "MONTH" } });
    // Reviewing changed nothing anywhere.
    expect(await plansOf(f.clinicId)).toHaveLength(1);
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ quantity: 2, planId: f.planId });

    const result = await change(f, ask(["KNEE"], 4, "MONTH", 23600));
    expect(result.kind).toBe("changed");

    // Stripe: the same per-seat price, four seats, on a price made for the new plan.
    const plans = await plansOf(f.clinicId);
    expect(plans).toHaveLength(2);
    expect(plans[1]).toMatchObject({ pricingVersionId: versionA, surgeonSeats: 4, perSeatCents: 5900, totalCents: 23600, acceptedById: owner.id, acceptedByName: owner.name });
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 5900, quantity: 4, planId: plans[1].id, pending: false });

    // The clinic: the new plan is the one in force, the old row is untouched history.
    expect(await billingOf(f.clinicId)).toMatchObject({ status: "ACTIVE", currentPlanId: plans[1].id, pendingPlanId: null, scheduledPlanId: null });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 4, categories: ["KNEE"], pricingVersionId: versionA, status: "ACTIVE" });
    expect(plans[0]).toMatchObject({ id: f.planId, surgeonSeats: 2 });
    const log = await logOf(f.clinicId);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("The plan change took effect.");
    expect(log[0]).toContain("The plan is now 1 category, 4 seats.");
  });

  it("one more category: the library opens it as soon as the payment is confirmed, and not before", async () => {
    const f = await makePayingClinic("more categories", { categories: ["KNEE"], seats: 1 });

    // One category is $59, two are $89.
    const result = await change(f, ask(["KNEE", "HIP"], 1, "MONTH", 8900));

    expect(result.kind).toBe("changed");
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["HIP", "KNEE"]);
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 8900, quantity: 1 });
  });

  it("a declined card changes NOTHING: the clinic keeps what it had, and can pay on Stripe's page or cancel", async () => {
    const f = await makePayingClinic("declined", { categories: ["KNEE"], seats: 1 });
    f.fake.setCard(f.customerId, "declined");

    const result = await change(f, ask(["KNEE", "HIP"], 1, "MONTH", 8900));

    expect(result).toMatchObject({ kind: "payment-needed", payUrl: expect.stringMatching(/^https:\/\/invoice\.stripe\.com\//) });
    const [, attempted] = await plansOf(f.clinicId);
    // Nothing granted: the plan in force and the library are as they were.
    expect(await billingOf(f.clinicId)).toMatchObject({ status: "ACTIVE", currentPlanId: f.planId, pendingPlanId: attempted.id });
    expect(await clinicOf(f.clinicId)).toMatchObject({ categories: ["KNEE"], surgeonSeats: 1, status: "ACTIVE" });
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 5900, planId: f.planId, pending: true });
    expect((await logOf(f.clinicId)).at(-1)).toContain("waiting for its payment");

    // A second change is refused while that one waits.
    const second = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 2, "MONTH", 11800), deps: depsFor(f.fake) });
    expect(second).toMatchObject({ kind: "refused", message: expect.stringContaining("waiting for its payment") });

    // The owner cancels it: the unpaid invoice is voided and nothing is left waiting.
    const cancelled = await cancelWaitingChange({ clinicId: f.clinicId, which: "payment", deps: depsFor(f.fake) });
    expect(cancelled).toMatchObject({ ok: true, message: expect.stringContaining("nothing was charged") });
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: f.planId, pendingPlanId: null });
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ pending: false, planId: f.planId });
    expect((await logOf(f.clinicId)).at(-1)).toContain("was not paid, so the plan stays as it was");
    // Pressing cancel again finds nothing waiting, and says so.
    expect(await cancelWaitingChange({ clinicId: f.clinicId, which: "payment", deps: depsFor(f.fake) })).toMatchObject({ ok: true, message: expect.stringContaining("no change waiting") });
  });

  it("a card whose bank wants the charge approved: nothing changes until the owner pays on Stripe's page, and then it does", async () => {
    const f = await makePayingClinic("approval", { categories: ["KNEE"], seats: 1 });
    f.fake.setCard(f.customerId, "needs-approval");

    const result = await change(f, ask(["KNEE", "HIP", "SHOULDER"], 1, "MONTH", 10900));
    expect(result.kind).toBe("payment-needed");
    expect((await clinicOf(f.clinicId)).categories).toEqual(["KNEE"]);

    // Where to pay is found from the clinic's own subscription.
    expect(await findInvoiceToPay({ clinicId: f.clinicId, deps: depsFor(f.fake) })).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/invoice\.stripe\.com\//) });

    // The owner approves and pays at Stripe; Stripe's notification arrives.
    f.fake.payOpenInvoice(f.subscriptionId);
    await notify(f);

    const [, paid] = await plansOf(f.clinicId);
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: paid.id, pendingPlanId: null });
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["HIP", "KNEE", "SHOULDER"]);
    expect((await logOf(f.clinicId)).at(-1)).toContain("The payment for the plan change was confirmed");
    // The notification arriving again changes nothing and logs nothing.
    const before = (await logOf(f.clinicId)).length;
    await notify(f);
    expect(await logOf(f.clinicId)).toHaveLength(before);
  });

  it("an upgrade nobody pays for is dropped by Stripe after about a day, and the clinic is as it was", async () => {
    const f = await makePayingClinic("expired", { categories: ["KNEE"], seats: 1 });
    f.fake.setCard(f.customerId, "declined");
    await change(f, ask(["KNEE"], 3, "MONTH", 17700));

    f.fake.expirePending(f.subscriptionId);
    await notify(f);

    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: f.planId, pendingPlanId: null, status: "ACTIVE" });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 1 });
  });
});

describe("everything else starts at the next renewal", () => {
  it("fewer seats: scheduled, nothing charged, nothing changed until the renewal, then applied", async () => {
    const f = await makePayingClinic("fewer seats", { categories: ["KNEE", "HIP"], seats: 4 });

    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE", "HIP"], 2, "MONTH", 17800), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", now: null, renewal: { at: PERIOD_END, why: "reduction", replaces: false } });

    const result = await change(f, ask(["KNEE", "HIP"], 2, "MONTH", 17800));
    expect(result).toMatchObject({ kind: "scheduled", at: PERIOD_END });

    const [, later] = await plansOf(f.clinicId);
    // Scheduled, and nothing else: the plan in force, the seats and what Stripe charges are untouched.
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: f.planId, scheduledPlanId: later.id, scheduledChangeAt: PERIOD_END });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 4 });
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ quantity: 4, planId: f.planId, scheduled: { quantity: 2, planId: later.id } });
    expect(f.fake.calls.applyUpgrade).toBe(0);
    expect((await logOf(f.clinicId)).at(-1)).toContain("A plan change is scheduled for 2026-10-31 12:00 UTC");

    // Notifications before the renewal, however many, grant nothing early.
    await notify(f);
    await notify(f);
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 4 });
    expect(await logOf(f.clinicId)).toHaveLength(1);

    // The renewal: Stripe moves the subscription, and tells us.
    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: later.id, scheduledPlanId: null, scheduledChangeAt: null, status: "ACTIVE" });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 2, status: "ACTIVE" });
    expect((await logOf(f.clinicId)).at(-1)).toContain("The scheduled plan change took effect.");
  });

  it("a mixed change (one category added, another removed) is scheduled whole: the added category is NOT granted early", async () => {
    const f = await makePayingClinic("mixed", { categories: ["KNEE", "HIP"], seats: 2 });

    // Swap HIP for SHOULDER and add a seat: adds and takes away, so it all waits.
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE", "SHOULDER"], 3, "MONTH", 26700), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", now: null, renewal: { why: "mixed" } });
    expect((await change(f, ask(["KNEE", "SHOULDER"], 3, "MONTH", 26700))).kind).toBe("scheduled");

    await notify(f);
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["HIP", "KNEE"]);
    expect((await clinicOf(f.clinicId)).surgeonSeats).toBe(2);

    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["KNEE", "SHOULDER"]);
    expect((await clinicOf(f.clinicId)).surgeonSeats).toBe(3);
  });

  it("monthly to yearly waits for the renewal, and Stripe is then charging the whole year's price on a yearly interval", async () => {
    const f = await makePayingClinic("to yearly", { categories: ["KNEE"], seats: 3 });

    // $59 a month; a year is charged as 10 months: $590 a seat, $1,770 for three.
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "YEAR", 177000), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", renewal: { why: "interval" }, summary: { interval: "YEAR", perSeatCents: 59000, totalCents: 177000 } });
    expect((await change(f, ask(["KNEE"], 3, "YEAR", 177000))).kind).toBe("scheduled");
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 5900, interval: "MONTH" });

    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 59000, interval: "YEAR", quantity: 3 });
    const [, yearly] = await plansOf(f.clinicId);
    expect(yearly).toMatchObject({ interval: "YEAR", perSeatCents: 59000, totalCents: 177000 });
    expect((await billingOf(f.clinicId)).currentPlanId).toBe(yearly.id);
  });

  it("a yearly plan can be upgraded now too, charged for the rest of the year", async () => {
    const f = await makePayingClinic("yearly upgrade", { categories: ["KNEE"], seats: 1, interval: "YEAR" });

    // $590 a seat a year; two seats is $1,180. 355 of 365 days are left.
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 2, "YEAR", 118000), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", now: { dueNowCents: Math.round((118000 * 355) / 365) - Math.round((59000 * 355) / 365) } });
    expect((await change(f, ask(["KNEE"], 2, "YEAR", 118000))).kind).toBe("changed");
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 59000, interval: "YEAR", quantity: 2 });
  });

  it("a scheduled change can be cancelled, and replaced, with never more than one schedule", async () => {
    const f = await makePayingClinic("replace", { categories: ["KNEE", "HIP"], seats: 4 });

    await change(f, ask(["KNEE", "HIP"], 3, "MONTH", 26700));
    const first = (await billingOf(f.clinicId)).scheduledPlanId;

    // A different change takes its place, in the same schedule; the review says so.
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 4, "MONTH", 23600), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", renewal: { why: "reduction", replaces: true } });
    await change(f, ask(["KNEE"], 4, "MONTH", 23600));
    const second = (await billingOf(f.clinicId)).scheduledPlanId;
    expect(second).not.toBe(first);
    expect(f.fake.onStripe(f.subscriptionId).scheduled).toMatchObject({ planId: second, quantity: 4 });
    expect(f.fake.calls.scheduleChange).toBe(2);

    // An upgrade is refused while a change is scheduled: one change at a time.
    const upgrade = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE", "HIP"], 5, "MONTH", 44500), deps: depsFor(f.fake) });
    expect(upgrade).toMatchObject({ kind: "refused", message: expect.stringContaining("already scheduled") });

    // Cancelled: nothing is scheduled, and the renewal changes nothing.
    expect(await cancelWaitingChange({ clinicId: f.clinicId, which: "scheduled", deps: depsFor(f.fake) })).toMatchObject({ ok: true, message: expect.stringContaining("Your plan stays as it is") });
    expect(await billingOf(f.clinicId)).toMatchObject({ scheduledPlanId: null, scheduledChangeAt: null, currentPlanId: f.planId });
    expect((await logOf(f.clinicId)).at(-1)).toContain("The scheduled plan change was cancelled.");
    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 4 });
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["HIP", "KNEE"]);
  });

  it("the same scheduled change asked for twice is one change", async () => {
    const f = await makePayingClinic("twice", { categories: ["KNEE"], seats: 3 });
    const request = ask(["KNEE"], 2, "MONTH", 11800);
    const seen: ChangeSeen = { timing: "renewal", at: null, dueNowCents: null };

    const [a, b] = await Promise.all([
      confirmPlanChange({ clinicId: f.clinicId, request, seen, actor: owner, deps: depsFor(f.fake) }),
      confirmPlanChange({ clinicId: f.clinicId, request, seen, actor: owner, deps: depsFor(f.fake) }),
    ]);

    expect([a.kind, b.kind].sort()).toEqual(["changed", "scheduled"]); // one scheduled it, the other was told it is already done
    expect(f.fake.calls.scheduleChange).toBe(1);
    expect(f.fake.onStripe(f.subscriptionId).scheduled).toMatchObject({ quantity: 2 });
  });

  it("after a scheduled change has happened, the spent schedule is let go before the next change or a visit to Stripe's billing page", async () => {
    const f = await makePayingClinic("spent", { categories: ["KNEE"], seats: 3 });
    await change(f, ask(["KNEE"], 2, "MONTH", 11800));
    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ hasSchedule: true, scheduled: null });
    // With the schedule still attached, Stripe would refuse a cancellation.
    expect(() => f.fake.cancelAtPeriodEnd(f.subscriptionId)).toThrow();

    const visit = await openBillingPortal({ clinicId: f.clinicId, origin: ORIGIN, deps: depsFor(f.fake) });
    expect(visit.ok).toBe(true);
    expect(f.fake.onStripe(f.subscriptionId).hasSchedule).toBe(false);
    expect(() => f.fake.cancelAtPeriodEnd(f.subscriptionId)).not.toThrow();
  });
});

describe("prices: a clinic keeps the prices it signed up at unless its owner chooses to move", () => {
  it("with newer, dearer prices active, a change is still quoted at the clinic's own prices", async () => {
    const f = await makePayingClinic("pinned", { categories: ["KNEE"], seats: 1 });
    activeIs(versionB, CONFIG_B);

    // The clinic's own version: $59 a seat. Not the active $64.
    expect((await change(f, ask(["KNEE"], 2, "MONTH", 11800))).kind).toBe("changed");
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 5900, quantity: 2 });
    expect((await clinicOf(f.clinicId)).pricingVersionId).toBe(versionA);

    // A form claiming the active version without asking to move is out of date, and nothing is made.
    const forged = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "MONTH", 19200, { version: versionB }), deps: depsFor(f.fake) });
    expect(forged.kind).toBe("stale");
    // No notification and no page load ever moves the clinic to the active prices.
    await notify(f);
    expect((await clinicOf(f.clinicId)).pricingVersionId).toBe(versionA);
    expect(f.fake.onStripe(f.subscriptionId).unitAmount).toBe(5900);
  });

  it("'move to current pricing' is a renewal change with its new total shown first, and it re-pins the clinic only when it takes effect", async () => {
    const f = await makePayingClinic("move", { categories: ["KNEE"], seats: 2 });
    activeIs(versionB, CONFIG_B);

    // The same plan at version B: $64 a seat, $128 for two.
    const request = ask(["KNEE"], 2, "MONTH", 12800, { move: true, version: versionB });
    const review = await reviewPlanChange({ clinicId: f.clinicId, request, deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", now: null, renewal: { why: "pricing" }, summary: { perSeatCents: 6400, totalCents: 12800, versionId: versionB } });

    // Adding a seat at the same time is still one renewal change, never part now and part later.
    const both = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "MONTH", 19200, { move: true, version: versionB }), deps: depsFor(f.fake) });
    expect(both).toMatchObject({ kind: "review", now: null, renewal: { why: "pricing" } });

    expect((await change(f, request)).kind).toBe("scheduled");
    expect((await clinicOf(f.clinicId)).pricingVersionId).toBe(versionA);
    expect(f.fake.onStripe(f.subscriptionId).unitAmount).toBe(5900);

    f.fake.renew(f.subscriptionId);
    await notify(f);
    expect((await clinicOf(f.clinicId)).pricingVersionId).toBe(versionB);
    expect(f.fake.onStripe(f.subscriptionId)).toMatchObject({ unitAmount: 6400, quantity: 2 });
  });

  it("no founding discount is ever applied to a change, whatever the prices say", async () => {
    const f = await makePayingClinic("founding", { categories: ["KNEE"], seats: 1 });
    const withOffer = { ...CONFIG_B, foundingDiscountBp: 2000 };
    activeIs(versionB, withOffer);

    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 1, "MONTH", 6400, { move: true, version: versionB }), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "review", summary: { perSeatCents: 6400 } });
  });
});

describe("nobody pays an amount they did not see", () => {
  it("a total that is not the server's, a different amount due, an old review, or the wrong kind of change: nothing is done", async () => {
    const f = await makePayingClinic("stale", { categories: ["KNEE"], seats: 2 });
    const request = ask(["KNEE"], 4, "MONTH", 23600);
    const confirm = (seen: ChangeSeen, r = request, now = NOW) => confirmPlanChange({ clinicId: f.clinicId, request: r, seen, actor: owner, deps: depsFor(f.fake, { now }) });

    // A forged total on the form.
    expect((await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 4, "MONTH", 100), deps: depsFor(f.fake) })).kind).toBe("stale");
    expect((await confirm({ timing: "now", at: NOW, dueNowCents: 7866 }, ask(["KNEE"], 4, "MONTH", 100))).kind).toBe("stale");
    // A forged amount due today.
    expect((await confirm({ timing: "now", at: NOW, dueNowCents: 1 })).kind).toBe("stale");
    // A review from yesterday, and one from the future.
    expect((await confirm({ timing: "now", at: new Date(NOW.getTime() - 24 * 3600_000), dueNowCents: 7866 })).kind).toBe("stale");
    expect((await confirm({ timing: "now", at: new Date(NOW.getTime() + 3600_000), dueNowCents: 7866 })).kind).toBe("stale");
    // An upgrade confirmed as if it had been reviewed as a renewal change.
    expect((await confirm({ timing: "renewal", at: null, dueNowCents: null })).kind).toBe("stale");

    expect(await plansOf(f.clinicId)).toHaveLength(1);
    expect(f.fake.calls).toMatchObject({ applyUpgrade: 0, scheduleChange: 0, ensurePrice: 0 });
    expect(await logOf(f.clinicId)).toHaveLength(0);

    // The amount for the moment that was reviewed is the amount charged, even confirmed a few minutes later.
    const later = new Date(NOW.getTime() + 5 * 60_000);
    expect((await confirm({ timing: "now", at: NOW, dueNowCents: 7866 }, request, later)).kind).toBe("changed");
  });

  it("picking the plan the clinic already has is not a change", async () => {
    const f = await makePayingClinic("same", { categories: ["KNEE", "HIP"], seats: 2 });
    const review = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["HIP", "KNEE"], 2, "MONTH", 17800), deps: depsFor(f.fake) });
    expect(review).toMatchObject({ kind: "same" });
    expect(await plansOf(f.clinicId)).toHaveLength(1);
  });
});

describe("the seat floor", () => {
  const seat = (clinicId: string, n: number) => prisma.seatAllocation.create({ data: { clinicId, clerkUserId: `user_vitest${tag}x${n}`, syncState: "SYNCED" } });

  it("seats cannot be scheduled below the number taken; the refusal says what to do and nothing is made", async () => {
    const f = await makePayingClinic("floor", { categories: ["KNEE"], seats: 3 });
    for (const n of [1, 2, 3]) await seat(f.clinicId, n);

    const result = await confirmPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 2, "MONTH", 11800), seen: { timing: "renewal", at: null, dueNowCents: null }, actor: owner, deps: depsFor(f.fake) });

    expect(result).toMatchObject({ kind: "refused", message: expect.stringContaining("3 seats are taken") });
    expect(await plansOf(f.clinicId)).toHaveLength(1);
    expect(f.fake.calls.scheduleChange).toBe(0);
    expect((await billingOf(f.clinicId)).scheduledPlanId).toBeNull();
  });

  it("while a reduction is scheduled, nobody can be seated past the lower number; cancelling the change lifts that", async () => {
    const f = await makePayingClinic("floor held", { categories: ["KNEE"], seats: 4 });
    for (const n of [1, 2]) await seat(f.clinicId, n);
    expect((await change(f, ask(["KNEE"], 2, "MONTH", 11800))).kind).toBe("scheduled");

    // Two of four seats are taken, so the plan has room; the scheduled drop to two is what stops a third.
    const refused = await reserveSeat(f.clinicId, `user_vitest${tag}x3`);
    expect(refused).toMatchObject({ held: false, scheduledSeats: 2 });
    expect(await prisma.seatAllocation.count({ where: { clinicId: f.clinicId } })).toBe(2);

    await cancelWaitingChange({ clinicId: f.clinicId, which: "scheduled", deps: depsFor(f.fake) });
    expect(await reserveSeat(f.clinicId, `user_vitest${tag}x3`)).toMatchObject({ held: true, fresh: true });
  });

  it("asked again when the change takes effect: a plan that lands short of the seats taken is applied, and the log says so", async () => {
    const f = await makePayingClinic("floor effect", { categories: ["KNEE"], seats: 4 });
    for (const n of [1, 2]) await seat(f.clinicId, n);
    await change(f, ask(["KNEE"], 2, "MONTH", 11800));
    // A third seat appears anyway (written straight to the table, as nothing in the app can now do).
    await seat(f.clinicId, 3);

    f.fake.renew(f.subscriptionId);
    await notify(f);

    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 2 });
    expect(await prisma.seatAllocation.count({ where: { clinicId: f.clinicId } })).toBe(3); // nobody was removed
    expect((await logOf(f.clinicId)).at(-1)).toContain("1 more than the 2 the plan now pays for");
  });
});

describe("one change at a time", () => {
  it("two different upgrades at once: one happens, the other is told the plan has moved", async () => {
    const f = await makePayingClinic("two tabs", { categories: ["KNEE"], seats: 1 });
    const a = ask(["KNEE"], 2, "MONTH", 11800);
    const b = ask(["KNEE"], 3, "MONTH", 17700);
    const dueFor = (seats: number) => Math.round((5900 * seats * 2) / 3) - Math.round((5900 * 2) / 3);

    const results = await Promise.all([
      confirmPlanChange({ clinicId: f.clinicId, request: a, seen: { timing: "now", at: NOW, dueNowCents: dueFor(2) }, actor: owner, deps: depsFor(f.fake) }),
      confirmPlanChange({ clinicId: f.clinicId, request: b, seen: { timing: "now", at: NOW, dueNowCents: dueFor(3) }, actor: owner, deps: depsFor(f.fake) }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["changed", "refused"]);
    expect(f.fake.calls.applyUpgrade).toBe(1);
    const stripe = f.fake.onStripe(f.subscriptionId);
    expect([2, 3]).toContain(stripe.quantity);
    // What the clinic has is what Stripe charges for.
    expect((await clinicOf(f.clinicId)).surgeonSeats).toBe(stripe.quantity);
    expect((await billingOf(f.clinicId)).currentPlanId).toBe(stripe.planId);
  });

  /** Start `second` while `first` is in the middle of its Stripe call, and report whether `second` got to Stripe before `first` finished. */
  async function overlap(f: Fixture) {
    const dueFor = (seats: number) => Math.round((5900 * seats * 2) / 3) - Math.round((5900 * 2) / 3);
    let second: Promise<ConfirmResult> | null = null;
    let secondReachedStripeFirst = false;
    f.fake.beforeNextChange(async () => {
      second = confirmPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "MONTH", 17700), seen: { timing: "now", at: NOW, dueNowCents: dueFor(3) }, actor: owner, deps: depsFor(f.fake) });
      // Long enough for an unblocked request to finish several times over.
      await Promise.race([second.then(() => undefined), new Promise((resolve) => setTimeout(resolve, 4000))]);
      secondReachedStripeFirst = f.fake.calls.applyUpgrade > 1;
    });
    const first = await confirmPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 2, "MONTH", 11800), seen: { timing: "now", at: NOW, dueNowCents: dueFor(2) }, actor: owner, deps: depsFor(f.fake) });
    const secondResult = await (second as unknown as Promise<ConfirmResult>);
    return { first, second: secondResult, secondReachedStripeFirst };
  }

  it("forced overlap: a second change started while the first is at Stripe waits for it, and is then refused", async () => {
    const f = await makePayingClinic("overlap", { categories: ["KNEE"], seats: 1 });

    const { first, second, secondReachedStripeFirst } = await overlap(f);

    expect(secondReachedStripeFirst).toBe(false);
    expect(first.kind).toBe("changed");
    expect(second.kind).toBe("refused");
    expect(f.fake.calls.applyUpgrade).toBe(1);
    expect(f.fake.onStripe(f.subscriptionId).quantity).toBe(2);
    expect((await clinicOf(f.clinicId)).surgeonSeats).toBe(2);
  });

  it("control: without the clinic's lock around the Stripe call, both changes reach Stripe", async () => {
    const f = await makePayingClinic("overlap control", { categories: ["KNEE"], seats: 1 });
    // Take the lock away for this test only, and let the plan row be written without it too.
    const noLock = async <T,>(_clinicId: string, work: () => Promise<T>) => work();
    vi.mocked(billingDb.withPlanChangeLock).mockImplementation(noLock as typeof billingDb.withPlanChangeLock);
    try {
      const { secondReachedStripeFirst } = await overlap(f);
      // This is what the lock prevents: the second change got in while the first was still at Stripe.
      expect(secondReachedStripeFirst).toBe(true);
      expect(f.fake.calls.applyUpgrade).toBe(2);
    } finally {
      const actual = await vi.importActual<typeof import("./db/billing")>("./db/billing");
      vi.mocked(billingDb.withPlanChangeLock).mockImplementation(actual.withPlanChangeLock);
    }
  });
});

describe("who may change a plan here", () => {
  it("refuses a managed clinic, a hospital, a clinic paused by hand, and a deployment where card payment is shut, with nothing made", async () => {
    const request = ask(["KNEE"], 2, "MONTH", 11800);
    const staff = "Vitest Staff";

    const managed = await makePayingClinic("managed", { categories: ["KNEE"], seats: 1 });
    await setClinicManagedByPulse(managed.clinicId, true, staff);
    const hospital = await makePayingClinic("hospital", { categories: ["KNEE"], seats: 1 });
    await setClinicPracticeType(hospital.clinicId, "HOSPITAL", staff);
    const paused = await makePayingClinic("paused", { categories: ["KNEE"], seats: 1 });
    await setClinicStatusByStaff(paused.clinicId, "PAUSED", "Vitest", staff);
    const shut = await makePayingClinic("shut", { categories: ["KNEE"], seats: 1 });

    for (const [f, deps, words] of [
      [managed, depsFor(managed.fake), "managed by Pulse 3D"],
      [hospital, depsFor(hospital.fake), "Hospitals"],
      [paused, depsFor(paused.fake), "paused this clinic by hand"],
      [shut, depsFor(shut.fake, { isOpen: false }), "not open yet"],
    ] as const) {
      expect(await reviewPlanChange({ clinicId: f.clinicId, request, deps })).toMatchObject({ kind: "refused", message: expect.stringContaining(words) });
      const confirmed = await confirmPlanChange({ clinicId: f.clinicId, request, seen: { timing: "now", at: NOW, dueNowCents: 3933 }, actor: owner, deps });
      expect(confirmed).toMatchObject({ kind: "refused", message: expect.stringContaining(words) });
      expect(await plansOf(f.clinicId)).toHaveLength(1);
      expect(f.fake.calls).toMatchObject({ applyUpgrade: 0, scheduleChange: 0, ensurePrice: 0 });
    }

    // A managed clinic gets no billing page and no cancel button either.
    expect(await openBillingPortal({ clinicId: managed.clinicId, origin: ORIGIN, deps: depsFor(managed.fake) })).toMatchObject({ ok: false });
    expect(await cancelWaitingChange({ clinicId: managed.clinicId, which: "scheduled", deps: depsFor(managed.fake) })).toMatchObject({ ok: false });
    expect(managed.fake.calls.createPortalSession).toBe(0);
  });

  it("a clinic Pulse staff never marked (UNKNOWN) changes its plan like any clinic", async () => {
    const f = await makePayingClinic("unknown", { categories: ["KNEE"], seats: 1 });
    await prisma.clinic.update({ where: { id: f.clinicId }, data: { practiceType: "UNKNOWN" } });

    expect((await change(f, ask(["KNEE"], 2, "MONTH", 11800))).kind).toBe("changed");
    expect((await clinicOf(f.clinicId)).practiceType).toBe("UNKNOWN");
  });

  it("refuses more seats than the Clinic maximum, a category that is not for sale, and a subscription that is set to end", async () => {
    const f = await makePayingClinic("limits", { categories: ["KNEE"], seats: 2 });

    const big = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 11, "MONTH", 64900), deps: depsFor(f.fake) });
    expect(big).toMatchObject({ kind: "refused", message: expect.stringContaining("More than 10 surgeon seats") });

    vi.mocked(listSellableCategories).mockResolvedValue(ALL.filter((category) => category !== "HIP"));
    const offSale = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE", "HIP"], 2, "MONTH", 17800), deps: depsFor(f.fake) });
    expect(offSale).toMatchObject({ kind: "refused", message: expect.stringContaining("Not for sale") });

    await prisma.clinicBilling.update({ where: { clinicId: f.clinicId }, data: { cancelAt: PERIOD_END } });
    const ending = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "MONTH", 17700), deps: depsFor(f.fake) });
    expect(ending).toMatchObject({ kind: "refused", message: expect.stringContaining("set to end") });
    expect(await plansOf(f.clinicId)).toHaveLength(1);
  });

  it("a category the clinic already has can be kept through a change after it comes off sale", async () => {
    const f = await makePayingClinic("off sale kept", { categories: ["KNEE", "HIP"], seats: 1 });
    vi.mocked(listSellableCategories).mockResolvedValue(ALL.filter((category) => category !== "HIP"));

    expect((await change(f, ask(["KNEE", "HIP"], 2, "MONTH", 17800))).kind).toBe("changed");
    expect(sorted((await clinicOf(f.clinicId)).categories)).toEqual(["HIP", "KNEE"]);
  });

  it("one clinic's change never touches another clinic", async () => {
    const fake = fakePlanStripe(tag);
    const mine = await makePayingClinic("mine", { categories: ["KNEE"], seats: 1 }, fake);
    const theirs = await makePayingClinic("theirs", { categories: ["KNEE"], seats: 1 }, fake);

    await change(mine, ask(["KNEE", "HIP"], 3, "MONTH", 26700));

    expect(await clinicOf(theirs.clinicId)).toMatchObject({ surgeonSeats: 1, categories: ["KNEE"] });
    expect(await billingOf(theirs.clinicId)).toMatchObject({ currentPlanId: theirs.planId, pendingPlanId: null, scheduledPlanId: null });
    expect(fake.onStripe(theirs.subscriptionId)).toMatchObject({ quantity: 1, planId: theirs.planId });
    expect(await logOf(theirs.clinicId)).toHaveLength(0);
  });
});

describe("when Stripe or the server fails partway", () => {
  it("Stripe not answering for the change: nothing is changed, and trying again works", async () => {
    const f = await makePayingClinic("outage", { categories: ["KNEE"], seats: 1 });
    f.fake.failNext.applyUpgrade = true;

    await expect(change(f, ask(["KNEE"], 2, "MONTH", 11800))).rejects.toThrow();
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: f.planId, pendingPlanId: null });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 1 });
    expect(f.fake.onStripe(f.subscriptionId).quantity).toBe(1);

    expect((await change(f, ask(["KNEE"], 2, "MONTH", 11800))).kind).toBe("changed");
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 2 });
  });

  it("the server stopping after Stripe made the change loses nothing: Stripe's notification applies it", async () => {
    const f = await makePayingClinic("lost", { categories: ["KNEE"], seats: 1 });
    // The reconcile straight after the change cannot ask Stripe; the change itself went through.
    let asked = 0;
    const flaky = async (id: string) => {
      asked += 1;
      if (asked === 1) throw new Error("made-up outage");
      return f.fake.fetchSubscription(id);
    };

    await expect(change(f, ask(["KNEE"], 2, "MONTH", 11800), depsFor(f.fake, { fetchSubscription: flaky }))).rejects.toThrow();
    expect(f.fake.onStripe(f.subscriptionId).quantity).toBe(2); // Stripe charged and changed it
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 1 }); // we have not caught up yet

    await notify(f);
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 2 });
    expect((await billingOf(f.clinicId)).currentPlanId).toBe(f.fake.onStripe(f.subscriptionId).planId);
  });

  it("a price in Stripe marked with a plan that is not this clinic's is not acted on, and is flagged for a person", async () => {
    const fake = fakePlanStripe(tag);
    const f = await makePayingClinic("strange", { categories: ["KNEE"], seats: 1 }, fake);
    const other = await makePayingClinic("strange other", { categories: ["KNEE", "HIP"], seats: 5 }, fake);
    // By hand in "Stripe": this clinic's subscription is moved to a price made for the OTHER clinic's plan.
    const sub = fake.subscriptions.get(f.subscriptionId);
    if (!sub) throw new Error("fixture");
    sub.priceId = await fake.gateway.ensurePrice({ planId: other.planId, perSeatCents: 8900, interval: "MONTH" });
    sub.quantity = 5;

    const result = await notify(f);

    expect(result.outcome).toContain("Needs a look");
    expect(await billingOf(f.clinicId)).toMatchObject({ currentPlanId: f.planId });
    expect(await clinicOf(f.clinicId)).toMatchObject({ surgeonSeats: 1, categories: ["KNEE"] });
  });
});

describe("Stripe's billing page, and recovering from a failed payment", () => {
  it("opens for the clinic's own Stripe customer and nobody else's, and comes back to a trusted address", async () => {
    const fake = fakePlanStripe(tag);
    const mine = await makePayingClinic("portal mine", { categories: ["KNEE"], seats: 1 }, fake);
    const theirs = await makePayingClinic("portal theirs", { categories: ["KNEE"], seats: 1 }, fake);

    const visit = await openBillingPortal({ clinicId: mine.clinicId, origin: ORIGIN, deps: depsFor(fake) });

    expect(visit).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/billing\.stripe\.com\//) });
    // The flow takes a clinic id from the server and nothing else: there is no customer id to forge.
    expect(fake.portalVisits).toEqual([{ customerId: mine.customerId, returnUrl: `${ORIGIN}/admin/billing?from=stripe` }]);
    expect(fake.portalVisits[0].customerId).not.toBe(theirs.customerId);
  });

  it("is refused for a clinic that never paid by card, and where card payment is shut", async () => {
    const fake = fakePlanStripe(tag);
    const clinic = await prisma.clinic.create({ data: { name: `Vitest plan change never paid ${tag}`, status: "PENDING" }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    expect(await openBillingPortal({ clinicId: clinic.id, origin: ORIGIN, deps: depsFor(fake) })).toMatchObject({ ok: false, message: expect.stringContaining("not paid by card") });

    const f = await makePayingClinic("portal shut", { categories: ["KNEE"], seats: 1 }, fake);
    expect(await openBillingPortal({ clinicId: f.clinicId, origin: ORIGIN, deps: depsFor(fake, { isOpen: false }) })).toMatchObject({ ok: false });
    expect(fake.calls.createPortalSession).toBe(0);
  });

  it("a failed renewal: the clinic is in grace, can find the invoice to pay, is refused a plan change, and recovers once Stripe says it is paid", async () => {
    const f = await makePayingClinic("recover", { categories: ["KNEE"], seats: 2 });
    f.fake.setCard(f.customerId, "declined");
    f.fake.renew(f.subscriptionId);
    await notify(f);

    const pastDue = await clinicOf(f.clinicId);
    expect(pastDue.status).toBe("PAST_DUE");
    expect(clinicIsOpen({ status: pastDue.status, graceEndsAt: pastDue.graceEndsAt }, NOW)).toBe(true);

    // A plan change has to wait until the missed payment is settled.
    const blocked = await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 3, "MONTH", 17700), deps: depsFor(f.fake) });
    expect(blocked).toMatchObject({ kind: "refused", message: expect.stringContaining("did not go through") });

    // The way out: Stripe's page for that invoice, and Stripe's billing page to change the card. Both reachable.
    expect(await findInvoiceToPay({ clinicId: f.clinicId, deps: depsFor(f.fake) })).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/invoice\.stripe\.com\//) });
    expect((await openBillingPortal({ clinicId: f.clinicId, origin: ORIGIN, deps: depsFor(f.fake) })).ok).toBe(true);

    // Coming back from Stripe proves nothing; only Stripe saying "paid" recovers the clinic.
    expect((await clinicOf(f.clinicId)).status).toBe("PAST_DUE");
    f.fake.payOpenInvoice(f.subscriptionId);
    await notify(f);
    expect(await clinicOf(f.clinicId)).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    expect(await findInvoiceToPay({ clinicId: f.clinicId, deps: depsFor(f.fake) })).toMatchObject({ ok: false, message: expect.stringContaining("Nothing is waiting") });
  });

  it("a clinic whose subscription has ended can still reach Stripe's billing page for its invoices", async () => {
    const f = await makePayingClinic("ended", { categories: ["KNEE"], seats: 1 });
    const sub = f.fake.subscriptions.get(f.subscriptionId);
    if (!sub) throw new Error("fixture");
    sub.status = "canceled";
    await notify(f);
    expect((await clinicOf(f.clinicId)).status).toBe("CANCELED");

    expect((await openBillingPortal({ clinicId: f.clinicId, origin: ORIGIN, deps: depsFor(f.fake) })).ok).toBe(true);
    // Its plan cannot be changed; starting again is a new checkout.
    expect(await reviewPlanChange({ clinicId: f.clinicId, request: ask(["KNEE"], 2, "MONTH", 11800), deps: depsFor(f.fake) })).toMatchObject({ kind: "refused" });
  });

  it("a subscription ending drops a change that was scheduled, and says so", async () => {
    const f = await makePayingClinic("ended scheduled", { categories: ["KNEE"], seats: 3 });
    await change(f, ask(["KNEE"], 2, "MONTH", 11800));
    const sub = f.fake.subscriptions.get(f.subscriptionId);
    if (!sub) throw new Error("fixture");
    sub.status = "canceled";
    sub.schedule = null;

    await notify(f);

    expect(await billingOf(f.clinicId)).toMatchObject({ status: "CANCELED", scheduledPlanId: null, scheduledChangeAt: null });
    expect((await logOf(f.clinicId)).at(-1)).toContain("The plan change that was scheduled will not happen.");
  });
});
