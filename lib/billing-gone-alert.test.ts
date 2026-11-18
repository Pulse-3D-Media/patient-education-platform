import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SubscriptionSnapshot } from "./billing-state";
import { goneAlertEmail, notifyPulseOfGoneSubscription, reconcileAndTellPulse } from "./billing-gone-alert";
import { recordAcceptedPlan, setStripeCustomer, type AcceptedPlanInput, type GoneClosure } from "./db/billing";
import { prisma } from "./db/client";
import { createPricingVersion } from "./db/pricing";
import { DEFAULT_PRICING_CONFIG } from "./pricing";

/**
 * The email to Pulse staff when Stripe no longer has a paying clinic's
 * subscription and the app ends it (audit finding E3; the email decided by
 * Evan on 2026-11-18). Against the database, with a stand-in for Stripe and
 * for Resend. A stand-in proves the logic, not that Resend delivers.
 */

const tag = randomBytes(5).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;
const createdClinicIds: string[] = [];
let pricingVersionId = "";

const EMAIL_ENV = { RESEND_API_KEY: "re_madeup_for_vitest_only", EMAIL_FROM: "alerts@example.com", ERROR_ALERT_EMAIL: "staff@example.com", APP_ORIGINS: "https://app.example.com" };

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest gone-alert fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

function planInput(): AcceptedPlanInput {
  return {
    pricingVersionId,
    categories: ["KNEE"],
    entitledCategories: ["KNEE"],
    surgeonSeats: 2,
    interval: "MONTH",
    perSeatCents: 5900,
    totalCents: 11800,
    acceptedById: "user_vitest_admin",
    acceptedByName: "Vitest Admin",
  };
}

/** A clinic whose first payment got as far as `status`. */
async function makeClinic(status: "active" | "past_due" | "incomplete") {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest gone alert ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinic.id, customerId);
  const plan = await recordAcceptedPlan(clinic.id, planInput());
  const snap = (s: string): SubscriptionSnapshot => ({
    subscriptionId,
    customerId,
    status: s,
    latestInvoicePaid: s !== "incomplete",
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    cancelAt: null,
    planId: plan.id,
  });
  const quiet = vi.fn(async () => undefined);
  // Paid first, then (for past_due) a failed renewal.
  await reconcileAndTellPulse({ clinicId: clinic.id, subscriptionId, fetchSubscription: async () => snap(status === "incomplete" ? "incomplete" : "active") }, quiet);
  if (status === "past_due") await reconcileAndTellPulse({ clinicId: clinic.id, subscriptionId, fetchSubscription: async () => ({ ...snap("past_due"), latestInvoicePaid: false }) }, quiet);
  expect(quiet).not.toHaveBeenCalled();
  return { clinicId: clinic.id, customerId, subscriptionId };
}

const gone = async () => null;
const statusOf = async (clinicId: string) => ({
  billing: (await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId }, select: { status: true } })).status,
  clinic: (await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true } })).status,
});
/** Let the send that was started after the commit run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a paying clinic's subscription gone from Stripe", () => {
  it("one email to Pulse staff, naming the clinic, once the clinic is closed", async () => {
    const f = await makeClinic("active");
    const tell = vi.fn<(closure: GoneClosure) => Promise<undefined>>(async () => undefined);
    const result = await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await settle();
    expect(result.kind).toBe("processed");
    expect(await statusOf(f.clinicId)).toEqual({ billing: "CANCELED", clinic: "CANCELED" });
    expect(tell).toHaveBeenCalledTimes(1);
    expect(tell.mock.calls[0][0]).toMatchObject({ clinicId: f.clinicId, clinicName: `Vitest gone alert ${tag}`, clinicStatus: "CANCELED" });
  });

  it("a past-due clinic gets the email too", async () => {
    const f = await makeClinic("past_due");
    const tell = vi.fn(async () => undefined);
    await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await settle();
    expect(tell).toHaveBeenCalledTimes(1);
  });

  it("no second email when the same thing is found again", async () => {
    const f = await makeClinic("active");
    const tell = vi.fn(async () => undefined);
    await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await settle();
    expect(tell).toHaveBeenCalledTimes(1);
  });

  it("no email for a first payment that never finished: that clinic was never open", async () => {
    const f = await makeClinic("incomplete");
    const tell = vi.fn(async () => undefined);
    const result = await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await settle();
    expect(result.kind).toBe("processed");
    expect((await statusOf(f.clinicId)).billing).toBe("NONE");
    expect(tell).not.toHaveBeenCalled();
  });

  it("a forced overlap (a notification and Check with Stripe at the same moment) sends one email", async () => {
    const f = await makeClinic("active");
    const tell = vi.fn(async () => undefined);
    // Both looks are held at Stripe until both have started, so they truly overlap.
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowGone = async () => {
      arrived += 1;
      if (arrived === 1) setTimeout(release, 300);
      await gate;
      return null;
    };
    await Promise.all([
      reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: slowGone }, tell),
      reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: slowGone }, tell),
    ]);
    await settle();
    expect(tell).toHaveBeenCalledTimes(1);
    const notes = await prisma.clinicNote.findMany({ where: { clinicId: f.clinicId, body: { contains: "Stripe no longer has" } }, select: { id: true } });
    expect(notes).toHaveLength(1);
  });

  it("a failing Resend changes nothing else: the clinic is still closed and the look still succeeds", async () => {
    const f = await makeClinic("active");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refusing = vi.fn(async () => new Response("no", { status: 500 }));
    let outcome: unknown = null;
    const tell = async (closure: GoneClosure) => (outcome = await notifyPulseOfGoneSubscription(closure, { env: EMAIL_ENV, fetch: refusing as unknown as typeof fetch }));
    const result = await reconcileAndTellPulse({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: gone }, tell);
    await settle();
    expect(result.kind).toBe("processed");
    expect(await statusOf(f.clinicId)).toEqual({ billing: "CANCELED", clinic: "CANCELED" });
    expect(refusing).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ told: false, reason: "refused" });

    // A send that throws outright is caught as well.
    const g = await makeClinic("active");
    const throwing = vi.fn(async () => {
      throw new Error("boom cus_secret");
    });
    await expect(reconcileAndTellPulse({ clinicId: g.clinicId, subscriptionId: g.subscriptionId, fetchSubscription: gone }, throwing)).resolves.toMatchObject({ kind: "processed" });
    await settle();
    expect(await statusOf(g.clinicId)).toEqual({ billing: "CANCELED", clinic: "CANCELED" });
    // The log holds words and the kind of failure, never the message.
    expect(JSON.stringify(errors.mock.calls)).not.toContain("cus_secret");
    errors.mockRestore();
  });
});

describe("the email itself", () => {
  const closure: GoneClosure = { clinicId: "clinic_madeup", clinicName: "Lakeside\nOrtho", clinicStatus: "CANCELED", at: new Date("2026-11-18T12:00:00.000Z") };

  it("names the clinic, links its /pulse page from the trusted origin, says what to do, with no Stripe ids, payment detail or em dashes", () => {
    const message = goneAlertEmail(closure, ["staff@example.com"], "https://app.example.com");
    expect(message.subject).toBe("Pulse 3D: Stripe no longer has a clinic's subscription (Lakeside Ortho)");
    expect(message.text).toContain("https://app.example.com/pulse/clinics/clinic_madeup");
    expect(message.text).toContain("closed the clinic");
    expect(message.text).toContain("Reset billing");
    expect(message.text).not.toMatch(/sub_|cus_|\$|—/);
    expect(message.subject).not.toContain("—");
    expect(message.idempotencyKey).toBe(`billing-gone-clinic_madeup-${closure.at.getTime()}`);
  });

  it("names the page instead of linking it when no origin can be trusted, and says when Pulse manages the clinic", () => {
    expect(goneAlertEmail(closure, ["staff@example.com"], null).text).toContain("/pulse/clinics/clinic_madeup");
    expect(goneAlertEmail({ ...closure, clinicStatus: "ACTIVE" }, ["staff@example.com"], null).text).toContain("Pulse manages this clinic");
  });

  it("is sent to the error-alert address with the configured origin, and not at all when email is not set up", async () => {
    const accepting = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
    await expect(notifyPulseOfGoneSubscription(closure, { env: EMAIL_ENV, fetch: accepting as unknown as typeof fetch })).resolves.toEqual({ told: true });
    const body = JSON.parse(String(accepting.mock.calls[0][1].body));
    expect(body.to).toEqual(["staff@example.com"]);
    expect(body.text).toContain("https://app.example.com/pulse/clinics/clinic_madeup");

    const unused = vi.fn();
    await expect(notifyPulseOfGoneSubscription(closure, { env: { ...EMAIL_ENV, ERROR_ALERT_EMAIL: "" }, fetch: unused as unknown as typeof fetch })).resolves.toEqual({
      told: false,
      reason: "not-configured",
    });
    expect(unused).not.toHaveBeenCalled();
  });
});
