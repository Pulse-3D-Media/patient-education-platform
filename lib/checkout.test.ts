import type { Category } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionSnapshot } from "./billing-state";
import { checkPayment, startCheckout, type CheckoutDeps } from "./checkout";
import type { PlanSelection } from "./checkout-rules";
import { clinicIsOpen } from "./clinic-status";
import { handleStripeEvent } from "./billing-events";
import { prisma } from "./db/client";
import { setClinicManagedByPulse, setClinicStatusByStaff } from "./db/clinics";
import { listSellableCategories } from "./db/category-config";
import { createPricingVersion, getActivePricing, type CurrentPricing } from "./db/pricing";
import { DEFAULT_PRICING_CONFIG, type PricingConfig } from "./pricing";
import { checkoutSessionParams, type CheckoutGateway, type CheckoutSessionArgs, type CheckoutSessionInfo } from "./stripe";

/**
 * Self-serve checkout, end to end on the server side, against the real test
 * database and an in-memory stand-in for Stripe.
 *
 * Nothing here talks to Stripe, and no real id or key is used. "Stripe" is a
 * small object that behaves the way the real one is documented to where it
 * matters to these rules: asking for a customer twice for one clinic gives
 * one customer, asking for a payment page twice for one plan gives one page
 * (and gives back the FIRST answer, even if the page has since closed),
 * closed pages stay closed, and a paid page becomes a subscription that
 * carries the plan id on its own metadata.
 *
 * The prices are a pricing version this file saves and NEVER makes active
 * (only one version can be active in the whole shared table). What "the
 * active version" is, and which categories are for sale, are handed to the
 * flow by stand-ins, so every number below is known.
 */

vi.mock("./db/pricing", async (original) => ({ ...(await original<typeof import("./db/pricing")>()), getActivePricing: vi.fn() }));
vi.mock("./db/category-config", async (original) => ({ ...(await original<typeof import("./db/category-config")>()), listSellableCategories: vi.fn() }));

const tag = randomBytes(5).toString("hex");
const ALL: Category[] = ["SPINE", "COMPLEX_SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];
const ORIGIN = "https://checkout-test.example";
const actor = { id: "user_vitest_admin", name: "Vitest Admin" };

const createdClinicIds: string[] = [];
const createdVersionIds: string[] = [];
const createdEventIds: string[] = [];
let versionA = "";
let versionB = "";

/** Version B costs more than A: $64 for one category instead of $59. */
const CONFIG_B: PricingConfig = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [6400, 9400, 11400, 13000, 14400, 14400] };

function activeIs(versionId: string, config: PricingConfig) {
  const pricing: CurrentPricing = {
    source: { kind: "version", pinned: false, version: { id: versionId, version: 1, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
    config,
  };
  vi.mocked(getActivePricing).mockResolvedValue(pricing);
}

// ---------------------------------------------------------------------------
// The stand-in for Stripe
// ---------------------------------------------------------------------------

/** One counter for the whole file, so no two made-up ids are ever the same (customer ids are unique in the database). */
let serial = 0;

function fakeStripe() {
  const customers = new Map<string, string>();
  const sessions: (CheckoutSessionInfo & { customerId: string; args: CheckoutSessionArgs })[] = [];
  const firstAnswers = new Map<string, CheckoutSessionInfo>();
  const subscriptions = new Map<string, SubscriptionSnapshot>();
  const calls = { createCustomer: 0, createSession: 0, expireSession: 0 };

  const gateway: CheckoutGateway = {
    async createCustomer({ clinicId }) {
      calls.createCustomer += 1;
      if (!customers.has(clinicId)) customers.set(clinicId, `cus_vitest${tag}${(serial += 1)}`);
      return customers.get(clinicId) as string;
    },
    async listOpenSessions(customerId) {
      return sessions.filter((session) => session.customerId === customerId && session.status === "open").map(({ id, url, status, planId }) => ({ id, url, status, planId }));
    },
    async expireSession(sessionId) {
      calls.expireSession += 1;
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (session && session.status === "open") {
        session.status = "expired";
        session.url = null;
      }
    },
    async createSession(args) {
      calls.createSession += 1;
      // The same key (one per plan) gets the first answer again, as Stripe does.
      const before = firstAnswers.get(args.planId);
      if (before) return { ...before };
      const id = `cs_test_vitest${tag}${(serial += 1)}`;
      const info: CheckoutSessionInfo = { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open", planId: args.planId };
      sessions.push({ ...info, customerId: args.customerId, args });
      firstAnswers.set(args.planId, { ...info });
      return { ...info };
    },
    async getSession(sessionId) {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      return session ? { id: session.id, url: session.url, status: session.status, planId: session.planId } : null;
    },
    async listSubscriptions(customerId) {
      return [...subscriptions.values()].filter((sub) => sub.customerId === customerId).map((sub) => ({ id: sub.subscriptionId, planId: sub.planId, status: sub.status }));
    },
  };

  /** What happens at Stripe when the admin pays on a page: the page completes and a subscription exists, carrying the plan id. */
  function pay(sessionId: string, how: "paid" | "unconfirmed" = "paid") {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session || session.status !== "open") throw new Error("That page cannot be paid.");
    session.status = "complete";
    session.url = null;
    const subscriptionId = `sub_vitest${tag}${(serial += 1)}`;
    subscriptions.set(subscriptionId, {
      subscriptionId,
      customerId: session.customerId,
      status: how === "paid" ? "active" : "incomplete",
      latestInvoicePaid: how === "paid",
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      cancelAt: null,
      planId: session.planId,
    });
    return subscriptionId;
  }

  const fetchSubscription = async (id: string) => subscriptions.get(id) ?? null;
  return { gateway, sessions, subscriptions, calls, pay, fetchSubscription };
}

type Fake = ReturnType<typeof fakeStripe>;

function depsFor(fake: Fake, more: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return { gateway: fake.gateway, isOpen: true, ...more };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeClinic(label: string, data: { practiceType?: "UNKNOWN" | "CLINIC" | "HOSPITAL"; status?: "PENDING" | "CANCELED" | "PAUSED" | "ACTIVE" } = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest checkout ${label} ${tag}`, practiceType: data.practiceType ?? "CLINIC", status: data.status ?? "PENDING" },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

/** What the picker would send for these picks at version A's prices. */
function pick(categories: Category[], seats: number, interval: "MONTH" | "YEAR", seenTotalCents: number, seenVersionId = versionA): PlanSelection {
  return { categories, seats, interval, seenVersionId, seenTotalCents };
}

const plansOf = (clinicId: string) => prisma.billingPlan.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" } });
const billingOf = (clinicId: string) => prisma.clinicBilling.findUnique({ where: { clinicId } });
const clinicOf = (clinicId: string) => prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });

beforeAll(async () => {
  const staff = { userId: "user_vitest", name: "Vitest" };
  versionA = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest checkout fixtures A. Never active.", staff)).id;
  versionB = (await createPricingVersion(CONFIG_B, "Vitest checkout fixtures B. Never active.", staff)).id;
  createdVersionIds.push(versionA, versionB);
});

beforeEach(() => {
  activeIs(versionA, DEFAULT_PRICING_CONFIG);
  vi.mocked(listSellableCategories).mockResolvedValue(ALL);
});

afterAll(async () => {
  await prisma.billingEvent.deleteMany({ where: { stripeEventId: { in: createdEventIds } } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.pricingVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("startCheckout: the amounts", () => {
  it("monthly: Stripe is given the engine's per-seat price as the unit amount and the seats as the quantity", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("monthly");

    // Two categories is $89 a seat a month; four seats is $356.
    const result = await startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 4, "MONTH", 35600), actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(result.kind).toBe("redirect");
    expect(fake.sessions).toHaveLength(1);
    const params = checkoutSessionParams(fake.sessions[0].args);
    expect(params.line_items).toEqual([
      { quantity: 4, price_data: { currency: "usd", product: "p3d_patient_education_library", unit_amount: 8900, recurring: { interval: "month", interval_count: 1 } } },
    ]);

    const [plan] = await plansOf(clinicId);
    expect(plan).toMatchObject({ pricingVersionId: versionA, categories: ["KNEE", "HIP"], entitledCategories: ["KNEE", "HIP"], surgeonSeats: 4, interval: "MONTH", perSeatCents: 8900, totalCents: 35600, acceptedById: actor.id, acceptedByName: actor.name });
    expect((await billingOf(clinicId))?.pendingPlanId).toBe(plan.id);
  });

  it("yearly: the unit amount is the WHOLE YEAR's per-seat price on a yearly interval, never the monthly price relabelled", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("yearly");

    // One category: $59 a month, a year charged as 10 months = $590 a seat; three seats = $1,770.
    const result = await startCheckout({ clinicId, selection: pick(["KNEE"], 3, "YEAR", 177000), actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(result.kind).toBe("redirect");
    const params = checkoutSessionParams(fake.sessions[0].args);
    expect(params.line_items?.[0]).toMatchObject({ quantity: 3, price_data: { unit_amount: 59000, recurring: { interval: "year" } } });
    expect(params.line_items?.[0].price_data?.unit_amount).not.toBe(5900);
    expect((await plansOf(clinicId))[0]).toMatchObject({ interval: "YEAR", perSeatCents: 59000, totalCents: 177000 });
  });

  it("the full library: five picks are charged at the five-category price and every category is included", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("full library");
    const five: Category[] = ["SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];

    const result = await startCheckout({ clinicId, selection: pick(five, 2, "MONTH", 27800), actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(result.kind).toBe("redirect");
    const [plan] = await plansOf(clinicId);
    expect(plan.perSeatCents).toBe(13900);
    expect(plan.categories).toHaveLength(5);
    expect([...plan.entitledCategories].sort()).toEqual([...ALL].sort());
  });

  it("no founding discount is ever applied, even when the active version carries one: nobody has approved who gets it", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("founding");
    activeIs(versionA, { ...DEFAULT_PRICING_CONFIG, foundingDiscountBp: 3000 });

    const result = await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(result.kind).toBe("redirect");
    expect(fake.sessions[0].args.perSeatCents).toBe(5900);
  });

  it("the plan id and the clinic id go on the SUBSCRIPTION's metadata, cards only, a fixed quantity, and the return addresses are on the trusted origin", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("params");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    const [plan] = await plansOf(clinicId);
    const params = checkoutSessionParams(fake.sessions[0].args);
    expect(params.mode).toBe("subscription");
    expect(params.subscription_data?.metadata).toEqual({ billingPlanId: plan.id, clinicId });
    expect(params.client_reference_id).toBe(clinicId);
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.line_items?.[0].adjustable_quantity).toBeUndefined();
    expect(params.allow_promotion_codes).toBeUndefined();
    expect(params.subscription_data?.trial_period_days).toBeUndefined();
    expect(params.success_url).toBe(`${ORIGIN}/admin/billing/return`);
    expect(params.cancel_url).toBe(`${ORIGIN}/admin/billing?checkout=cancelled`);
    // The page stops being payable an hour after the attempt was written.
    expect(params.expires_at).toBe(Math.floor(plan.createdAt.getTime() / 1000) + 3600);
  });
});

describe("startCheckout: who may, and what is refused", () => {
  const knee = () => pick(["KNEE"], 1, "MONTH", 5900);

  async function refused(clinicId: string, selection = knee(), more: Partial<CheckoutDeps> = {}) {
    const fake = fakeStripe();
    const result = await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake, more) });
    // Refused means NOTHING was made: no customer, no page, no attempt.
    expect(fake.calls).toEqual({ createCustomer: 0, createSession: 0, expireSession: 0 });
    expect(await plansOf(clinicId)).toHaveLength(0);
    return result;
  }

  it("a hospital is refused, whatever seats it asks for, and so is a practice that has not answered", async () => {
    expect(await refused(await makeClinic("hospital", { practiceType: "HOSPITAL" }))).toMatchObject({ kind: "refused", message: expect.stringContaining("Hospitals") });
    expect(await refused(await makeClinic("unknown", { practiceType: "UNKNOWN" }))).toMatchObject({ kind: "refused", message: expect.stringContaining("clinic or a hospital") });
  });

  it("more seats than the Clinic limit is refused on the server and pointed at Pulse, even though the practice says it is a clinic", async () => {
    const clinicId = await makeClinic("eleven seats");
    const result = await refused(clinicId, pick(["KNEE"], 11, "MONTH", 64900));
    expect(result).toMatchObject({ kind: "refused", message: expect.stringContaining("More than 10 surgeon seats") });
    expect(result).toMatchObject({ message: expect.stringContaining("pulse3dmedia.com/schedulecall") });
  });

  it("zero seats is refused on the server with nothing made: every plan has at least one seat, so the owner alone never buys the library", async () => {
    const clinicId = await makeClinic("zero seats");
    expect(await refused(clinicId, pick(["KNEE"], 0, "MONTH", 0))).toMatchObject({ kind: "refused" });
  });

  it("a clinic managed by Pulse cannot start a checkout", async () => {
    const clinicId = await makeClinic("managed");
    await setClinicManagedByPulse(clinicId, true, "Vitest");
    expect(await refused(clinicId)).toMatchObject({ kind: "refused", message: expect.stringContaining("managed by Pulse 3D") });
  });

  it("a clinic Pulse staff paused by hand cannot pay for access it would not get", async () => {
    const clinicId = await makeClinic("staff paused");
    await setClinicStatusByStaff(clinicId, "PAUSED", "Vitest: paused by hand.", "Vitest");
    expect(await refused(clinicId)).toMatchObject({ kind: "refused", message: expect.stringContaining("paused this clinic by hand") });
  });

  it("a category that is not for sale is not a purchase option", async () => {
    vi.mocked(listSellableCategories).mockResolvedValue(["KNEE", "HIP"]);
    const clinicId = await makeClinic("not for sale");
    expect(await refused(clinicId, pick(["KNEE", "SHOULDER"], 1, "MONTH", 8900))).toMatchObject({ kind: "refused", message: expect.stringContaining("Not for sale right now: Shoulder") });
  });

  it("the built-in default prices are an estimate and are refused: checkout needs a saved, active version", async () => {
    vi.mocked(getActivePricing).mockResolvedValue({ source: { kind: "estimate" }, config: DEFAULT_PRICING_CONFIG });
    expect(await refused(await makeClinic("estimate"))).toMatchObject({ kind: "refused", message: expect.stringContaining("not open yet") });
  });

  it("checkout that is not switched on for this deployment is refused before anything is read", async () => {
    expect(await refused(await makeClinic("closed deployment"), knee(), { isOpen: false })).toMatchObject({ kind: "refused", message: expect.stringContaining("not open yet") });
  });

  it("a forged total, and a forged pricing version, make nothing: the admin is shown the server's total to accept", async () => {
    const clinicId = await makeClinic("forged");
    // Claims to have seen one cent.
    expect(await refused(clinicId, pick(["KNEE"], 2, "MONTH", 1))).toEqual({ kind: "changed", message: expect.stringContaining("$118.00 per month") });
    // Claims to have seen another (real, cheaper-looking) version.
    expect(await refused(clinicId, pick(["KNEE"], 2, "MONTH", 11800, versionB))).toMatchObject({ kind: "changed" });
  });

  it("prices changed while the page was open: nothing is charged at either price until the admin accepts the new total", async () => {
    const clinicId = await makeClinic("repriced");
    activeIs(versionB, CONFIG_B);

    // The page still shows version A's $59.
    const stale = await refused(clinicId, pick(["KNEE"], 1, "MONTH", 5900, versionA));
    expect(stale).toEqual({ kind: "changed", message: expect.stringContaining("$64.00 per month") });

    // The admin presses again with the new total on screen.
    const fake = fakeStripe();
    const accepted = await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 6400, versionB), actor, origin: ORIGIN, deps: depsFor(fake) });
    expect(accepted.kind).toBe("redirect");
    expect(fake.sessions[0].args.perSeatCents).toBe(6400);
    expect((await plansOf(clinicId))[0].pricingVersionId).toBe(versionB);
  });

  it("an attempt already written keeps its price when the active version changes afterwards", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("honoured");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    activeIs(versionB, CONFIG_B);

    // The page the admin is on at Stripe is still the $59 one, and paying it starts the $59 plan.
    expect(fake.sessions[0]).toMatchObject({ status: "open" });
    expect(fake.sessions[0].args.perSeatCents).toBe(5900);
    expect((await plansOf(clinicId))[0]).toMatchObject({ pricingVersionId: versionA, perSeatCents: 5900 });
  });
});

describe("startCheckout: doing it twice", () => {
  it("a double click: two identical requests at once end with one customer, one attempt and one payment page", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("double click");
    const go = () => startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 2, "MONTH", 17800), actor, origin: ORIGIN, deps: depsFor(fake) });

    const results = await Promise.all([go(), go(), go()]);

    expect(results.map((result) => result.kind)).toEqual(["redirect", "redirect", "redirect"]);
    expect(new Set(results.map((result) => (result.kind === "redirect" ? result.url : "")))).toHaveProperty("size", 1);
    expect(await plansOf(clinicId)).toHaveLength(1);
    expect(fake.sessions).toHaveLength(1);
    expect(new Set([...fake.sessions.map((session) => session.customerId)]).size).toBe(1);
    expect((await billingOf(clinicId))?.stripeCustomerId).toBe(fake.sessions[0].customerId);
  });

  it("pressing again a minute later finds the same attempt and the same page", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("again");
    const go = () => startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    const first = await go();
    const second = await go();

    expect(second).toEqual(first);
    expect(await plansOf(clinicId)).toHaveLength(1);
    expect(fake.sessions).toHaveLength(1);
    expect(fake.calls.createCustomer).toBe(1);
  });

  it("different picks in a second tab: a new attempt, and the first page is closed so it can never be paid", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("two tabs");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });
    await startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 1, "MONTH", 8900), actor, origin: ORIGIN, deps: depsFor(fake) });

    const plans = await plansOf(clinicId);
    expect(plans).toHaveLength(2);
    // The first attempt's row is history: never edited, just no longer pointed at.
    expect(plans[0]).toMatchObject({ perSeatCents: 5900 });
    expect((await billingOf(clinicId))?.pendingPlanId).toBe(plans[1].id);
    expect(fake.sessions.map((session) => session.status)).toEqual(["expired", "open"]);
    expect(() => fake.pay(fake.sessions[0].id)).toThrow();
  });

  it("an attempt older than its page's useful life is not reused", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("old attempt");
    const selection = pick(["KNEE"], 1, "MONTH", 5900);
    await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });

    const later = new Date(Date.now() + 55 * 60_000);
    await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake, { now: later }) });

    expect(await plansOf(clinicId)).toHaveLength(2);
    expect(fake.sessions.map((session) => session.status)).toEqual(["expired", "open"]);
  });

  it("the page was already paid and the notification is late: pressing again starts nothing new", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("paid, pressed again");
    const selection = pick(["KNEE"], 1, "MONTH", 5900);
    await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });
    fake.pay(fake.sessions[0].id);

    const again = await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(again).toEqual({ kind: "confirming" });
    expect(fake.sessions).toHaveLength(1);
    expect(await plansOf(clinicId)).toHaveLength(1);
  });

  it("a page closed out from under its attempt: a fresh attempt and a fresh page, not a dead address", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("closed page");
    const selection = pick(["KNEE"], 1, "MONTH", 5900);
    await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });
    await fake.gateway.expireSession(fake.sessions[0].id);

    const again = await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(again).toMatchObject({ kind: "redirect", url: expect.stringContaining(fake.sessions[1].id) });
    expect(fake.sessions.map((session) => session.status)).toEqual(["expired", "open"]);
  });

  it("a clinic that already has a subscription is refused a second one", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("subscribed");
    const selection = pick(["KNEE"], 1, "MONTH", 5900);
    await startCheckout({ clinicId, selection, actor, origin: ORIGIN, deps: depsFor(fake) });
    fake.pay(fake.sessions[0].id);
    await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });

    const again = await startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 1, "MONTH", 8900), actor, origin: ORIGIN, deps: depsFor(fake) });

    expect(again).toMatchObject({ kind: "refused", message: expect.stringContaining("already has a subscription") });
    expect(fake.sessions).toHaveLength(1);
    expect(await plansOf(clinicId)).toHaveLength(1);
  });

  it("one clinic's checkout never touches another's", async () => {
    const fake = fakeStripe();
    const mine = await makeClinic("mine");
    const theirs = await makeClinic("theirs");
    await startCheckout({ clinicId: theirs, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });
    await startCheckout({ clinicId: mine, selection: pick(["HIP"], 2, "MONTH", 11800), actor, origin: ORIGIN, deps: depsFor(fake) });

    // Their page is still open: closing "every other page" means every other page of MY customer.
    expect(fake.sessions.map((session) => session.status)).toEqual(["open", "open"]);
    expect((await billingOf(mine))?.stripeCustomerId).not.toBe((await billingOf(theirs))?.stripeCustomerId);
    expect(await plansOf(theirs)).toHaveLength(1);
  });
});

describe("what opens the clinic", () => {
  it("starting a checkout opens nothing: the clinic is exactly as closed as it was", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("still closed");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    const clinic = await clinicOf(clinicId);
    expect(clinic.status).toBe("PENDING");
    expect(clinic.categories).toEqual([]);
    expect(clinicIsOpen(clinic)).toBe(false);
    expect((await billingOf(clinicId))?.status).toBe("NONE");
  });

  it("the WEBHOOK opens it: a notification about the paid subscription starts the accepted plan, with no browser involved", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("webhook");
    await startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 3, "YEAR", 267000), actor, origin: ORIGIN, deps: depsFor(fake) });
    const subscriptionId = fake.pay(fake.sessions[0].id);
    const customerId = fake.sessions[0].customerId;

    const eventId = `evt_vitest${tag}webhook`;
    createdEventIds.push(eventId);
    const handled = await handleStripeEvent(
      { id: eventId, type: "checkout.session.completed", livemode: false, data: { object: { customer: customerId, subscription: subscriptionId } } },
      { fetchSubscription: fake.fetchSubscription },
    );

    expect(handled.status).toBe("processed");
    const clinic = await clinicOf(clinicId);
    expect(clinic).toMatchObject({ status: "ACTIVE", categories: ["KNEE", "HIP"], surgeonSeats: 3, pricingVersionId: versionA });
    expect(clinicIsOpen(clinic)).toBe(true);
    const billing = await billingOf(clinicId);
    expect(billing).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: subscriptionId, pendingPlanId: null });
    expect(billing?.currentPlanId).toBe((await plansOf(clinicId))[0].id);
  });

  it("Check again does the same through the same rules, and doing it twice changes and logs nothing more", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("check again");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });

    // Before paying: nothing to find.
    expect(await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toMatchObject({ status: "NONE" });
    expect((await clinicOf(clinicId)).status).toBe("PENDING");

    fake.pay(fake.sessions[0].id);
    expect(await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toEqual({ status: "ACTIVE", message: "Payment confirmed." });
    const notes = await prisma.clinicNote.count({ where: { clinicId } });

    expect(await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toMatchObject({ status: "ACTIVE" });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(notes);
    expect((await clinicOf(clinicId)).status).toBe("ACTIVE");
  });

  it("a payment Stripe has NOT confirmed opens nothing, however often it is checked", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("unconfirmed");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });
    fake.pay(fake.sessions[0].id, "unconfirmed");

    const result = await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });

    expect(result.status).toBe("INCOMPLETE");
    const clinic = await clinicOf(clinicId);
    expect(clinic.status).toBe("PENDING");
    expect(clinicIsOpen(clinic)).toBe(false);
  });

  it("a failed first attempt, then a second one that is paid: the late notice about the first cannot wipe the second", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("recovery");

    // Attempt one: the card needs confirming and the admin gives up.
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });
    const firstSub = fake.pay(fake.sessions[0].id, "unconfirmed");
    await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });
    expect((await billingOf(clinicId))?.status).toBe("INCOMPLETE");

    // Attempt two, different picks. Stripe then gives up on the first subscription.
    await startCheckout({ clinicId, selection: pick(["KNEE", "HIP"], 1, "MONTH", 8900), actor, origin: ORIGIN, deps: depsFor(fake) });
    const secondPlanId = (await billingOf(clinicId))?.pendingPlanId;
    fake.subscriptions.set(firstSub, { ...(fake.subscriptions.get(firstSub) as SubscriptionSnapshot), status: "incomplete_expired" });
    const lateId = `evt_vitest${tag}late`;
    createdEventIds.push(lateId);
    await handleStripeEvent(
      { id: lateId, type: "customer.subscription.updated", livemode: false, data: { object: { id: firstSub, customer: fake.sessions[0].customerId } } },
      { fetchSubscription: fake.fetchSubscription },
    );

    // The second attempt is still the one waiting.
    expect((await billingOf(clinicId))?.pendingPlanId).toBe(secondPlanId);

    // And paying it opens the clinic on the SECOND plan.
    fake.pay(fake.sessions[1].id);
    expect(await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toMatchObject({ status: "ACTIVE" });
    expect(await clinicOf(clinicId)).toMatchObject({ status: "ACTIVE", categories: ["KNEE", "HIP"] });
  });

  it("a clinic whose subscription ended can buy again, and the new plan replaces the old one", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("again after ending");
    await startCheckout({ clinicId, selection: pick(["KNEE"], 1, "MONTH", 5900), actor, origin: ORIGIN, deps: depsFor(fake) });
    const firstSub = fake.pay(fake.sessions[0].id);
    await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });
    fake.subscriptions.set(firstSub, { ...(fake.subscriptions.get(firstSub) as SubscriptionSnapshot), status: "canceled" });
    await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });
    expect((await clinicOf(clinicId)).status).toBe("CANCELED");

    const result = await startCheckout({ clinicId, selection: pick(["HIP", "SHOULDER"], 2, "MONTH", 17800), actor, origin: ORIGIN, deps: depsFor(fake) });
    expect(result.kind).toBe("redirect");
    fake.pay(fake.sessions[1].id);
    await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription });

    expect(await clinicOf(clinicId)).toMatchObject({ status: "ACTIVE", categories: ["SHOULDER", "HIP"], surgeonSeats: 2 });
  });

  it("Check again for a clinic with no checkout, and for an unknown clinic, does nothing", async () => {
    const fake = fakeStripe();
    const clinicId = await makeClinic("never started");
    expect(await checkPayment({ clinicId, gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toMatchObject({ status: "NONE", message: expect.stringContaining("No checkout has been started") });
    expect(await checkPayment({ clinicId: "clinic_that_does_not_exist", gateway: fake.gateway, fetchSubscription: fake.fetchSubscription })).toMatchObject({ status: "NONE" });
  });
});
