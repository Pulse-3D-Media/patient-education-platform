import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import { BillingRefusedError, acceptPlanForCheckout, getCheckoutFacts, setStripeCustomer, type AcceptedPlanInput } from "./billing";
import { prisma } from "./client";
import { setClinicManagedByPulse, setClinicPracticeType, setClinicStatusByStaff } from "./clinics";
import { createPricingVersion } from "./pricing";
import { confirmSeat, reserveSeat } from "./seats";

/**
 * acceptPlanForCheckout against the real test database: the write that
 * turns "an admin accepted this plan" into a durable purchase attempt.
 *
 * The checkout flow checks who may pay BEFORE it gets here, for a quick
 * answer. These tests call the writer directly, because its own checks are
 * the ones that count: they run under the clinic's row lock, so they see a
 * clinic that was marked managed, paused or subscribed a moment ago, after
 * the page was drawn and after the flow's first look.
 *
 * Every id is made up. Everything made here is deleted afterwards.
 */

const tag = randomBytes(5).toString("hex");
const createdClinicIds: string[] = [];
let pricingVersionId = "";
let serial = 0;

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

async function makeClinic(label: string, options: { practiceType?: "UNKNOWN" | "CLINIC" | "HOSPITAL"; customer?: boolean } = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest attempt ${label} ${tag}`, practiceType: options.practiceType ?? "CLINIC" },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  if (options.customer !== false) await setStripeCustomer(clinic.id, `cus_vitestattempt${tag}${(serial += 1)}`);
  return clinic.id;
}

const countPlans = (clinicId: string) => prisma.billingPlan.count({ where: { clinicId } });

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest attempt fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

describe("acceptPlanForCheckout", () => {
  it("writes the attempt, points the clinic's record at it, and changes nothing about the clinic's access", async () => {
    const clinicId = await makeClinic("writes");
    const attempt = await acceptPlanForCheckout(clinicId, planInput());

    expect(attempt.reused).toBe(false);
    const facts = await getCheckoutFacts(clinicId);
    expect(facts?.facts).toMatchObject({ status: "NONE", pendingPlanId: attempt.planId, currentPlanId: null });
    expect(facts?.pendingPlan).toMatchObject({ perSeatCents: 8900, totalCents: 26700, surgeonSeats: 3, acceptedByName: "Vitest Admin" });
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true, categories: true, surgeonSeats: true } })).toEqual({
      status: "PENDING",
      categories: [],
      surgeonSeats: 0,
    });
  });

  it("the same plan again finds the same attempt; five at once still write one row", async () => {
    const clinicId = await makeClinic("same again");

    const results = await Promise.all(Array.from({ length: 5 }, () => acceptPlanForCheckout(clinicId, planInput())));

    expect(new Set(results.map((result) => result.planId)).size).toBe(1);
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
    expect(await countPlans(clinicId)).toBe(1);

    // Category order is not a difference.
    const reordered = await acceptPlanForCheckout(clinicId, planInput({ categories: ["HIP", "KNEE"], entitledCategories: ["HIP", "KNEE"] }));
    expect(reordered).toMatchObject({ planId: results[0].planId, reused: true });
  });

  it("anything that is charged for or included being different writes a new attempt and leaves the old row as it was", async () => {
    const clinicId = await makeClinic("different");
    const first = await acceptPlanForCheckout(clinicId, planInput());
    const second = await acceptPlanForCheckout(clinicId, planInput({ surgeonSeats: 4, totalCents: 35600 }));
    const third = await acceptPlanForCheckout(clinicId, planInput({ interval: "YEAR", perSeatCents: 89000, totalCents: 267000 }));

    expect(new Set([first.planId, second.planId, third.planId]).size).toBe(3);
    expect((await getCheckoutFacts(clinicId))?.facts.pendingPlanId).toBe(third.planId);
    expect(await prisma.billingPlan.findUniqueOrThrow({ where: { id: first.planId }, select: { surgeonSeats: true, totalCents: true } })).toEqual({ surgeonSeats: 3, totalCents: 26700 });
  });

  it("an attempt near the end of its payment page's life is not reused, and forceNew never reuses", async () => {
    const clinicId = await makeClinic("stale");
    const first = await acceptPlanForCheckout(clinicId, planInput());

    const late = await acceptPlanForCheckout(clinicId, planInput(), { now: new Date(first.createdAt.getTime() + 51 * 60_000) });
    expect(late.reused).toBe(false);
    expect(late.planId).not.toBe(first.planId);

    const forced = await acceptPlanForCheckout(clinicId, planInput(), { forceNew: true });
    expect(forced.reused).toBe(false);
    expect(await countPlans(clinicId)).toBe(3);
  });

  it("is refused, with nothing written, for a hospital, an unanswered practice, a managed clinic and a clinic staff paused: checked under the lock", async () => {
    const hospital = await makeClinic("hospital", { practiceType: "HOSPITAL" });
    const unknown = await makeClinic("unknown", { practiceType: "UNKNOWN" });
    const managed = await makeClinic("managed");
    await setClinicManagedByPulse(managed, true, "Vitest");
    const paused = await makeClinic("paused");
    await setClinicStatusByStaff(paused, "PAUSED", "Vitest: paused by hand.", "Vitest");
    const ended = await makeClinic("ended by staff");
    await setClinicStatusByStaff(ended, "CANCELED", "Vitest: ended by hand.", "Vitest");

    for (const clinicId of [hospital, unknown, managed, paused, ended]) {
      await expect(acceptPlanForCheckout(clinicId, planInput())).rejects.toBeInstanceOf(BillingRefusedError);
      expect(await countPlans(clinicId)).toBe(0);
    }
  });

  it("a clinic staff are holding OPEN may pay", async () => {
    const clinicId = await makeClinic("held open");
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest");
    await expect(acceptPlanForCheckout(clinicId, planInput())).resolves.toMatchObject({ reused: false });
  });

  it("a clinic that became a hospital after the page was drawn is refused", async () => {
    const clinicId = await makeClinic("became hospital", { practiceType: "UNKNOWN" });
    await setClinicPracticeType(clinicId, "HOSPITAL", "Vitest");
    await expect(acceptPlanForCheckout(clinicId, planInput())).rejects.toThrow(/Hospitals/);
  });

  it("is refused while a subscription is live, and before the clinic has a Stripe customer", async () => {
    const subscribed = await makeClinic("subscribed");
    await prisma.clinicBilling.update({ where: { clinicId: subscribed }, data: { status: "ACTIVE" } });
    await expect(acceptPlanForCheckout(subscribed, planInput())).rejects.toThrow(/already has a subscription/);
    await prisma.clinicBilling.update({ where: { clinicId: subscribed }, data: { status: "PAST_DUE" } });
    await expect(acceptPlanForCheckout(subscribed, planInput())).rejects.toThrow(/already has a subscription/);

    const noCustomer = await makeClinic("no customer", { customer: false });
    await expect(acceptPlanForCheckout(noCustomer, planInput())).rejects.toThrow(/no Stripe customer/);
    expect(await countPlans(noCustomer)).toBe(0);
  });

  it("refuses amounts that do not add up, whoever sends them", async () => {
    const clinicId = await makeClinic("bad sums");
    await expect(acceptPlanForCheckout(clinicId, planInput({ totalCents: 1 }))).rejects.toBeInstanceOf(BillingRefusedError);
    await expect(acceptPlanForCheckout(clinicId, planInput({ perSeatCents: 89.5, totalCents: 268.5 }))).rejects.toBeInstanceOf(BillingRefusedError);
    await expect(acceptPlanForCheckout(clinicId, planInput({ surgeonSeats: 0, totalCents: 0 }))).rejects.toBeInstanceOf(BillingRefusedError);
    expect(await countPlans(clinicId)).toBe(0);
  });

  it("refuses a plan with fewer surgeon seats than people hold right now, and says what to do", async () => {
    // A clinic Pulse opened by hand with five seats, three of them in use, now choosing a plan by card.
    const clinicId = await makeClinic("fewer seats");
    await prisma.clinic.update({ where: { id: clinicId }, data: { surgeonSeats: 5 } });
    for (const who of ["user_vitestseatA", "user_vitestseatB", "user_vitestseatC"]) {
      await reserveSeat(clinicId, who);
      await confirmSeat(clinicId, who);
    }

    const refused = acceptPlanForCheckout(clinicId, planInput({ surgeonSeats: 2, totalCents: 17800 }));
    await expect(refused).rejects.toBeInstanceOf(BillingRefusedError);
    await expect(refused).rejects.toThrow("3 people hold a surgeon seat, so the plan needs at least 3 seats");
    expect(await countPlans(clinicId)).toBe(0);

    // Exactly as many seats as are in use is fine.
    expect(await acceptPlanForCheckout(clinicId, planInput({ surgeonSeats: 3 }))).toMatchObject({ reused: false });
  });

  it("another clinic's surgeons do not count against this one", async () => {
    const busy = await makeClinic("busy neighbour");
    await prisma.clinic.update({ where: { id: busy }, data: { surgeonSeats: 5 } });
    await reserveSeat(busy, "user_vitestseatD");

    const mine = await makeClinic("quiet");
    expect(await acceptPlanForCheckout(mine, planInput({ surgeonSeats: 1, totalCents: 8900 }))).toMatchObject({ reused: false });
  });

  it("one clinic's attempt is never found for another", async () => {
    const mine = await makeClinic("mine");
    const theirs = await makeClinic("theirs");
    const theirAttempt = await acceptPlanForCheckout(theirs, planInput());
    const myAttempt = await acceptPlanForCheckout(mine, planInput());

    expect(myAttempt).toMatchObject({ reused: false });
    expect(myAttempt.planId).not.toBe(theirAttempt.planId);
  });
});
