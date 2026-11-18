import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubscriptionSnapshot } from "../billing-state";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import { PlanChangeOverrunError, reconcileSubscription, recordAcceptedPlan, setStripeCustomer, withPlanChangeLock, type AcceptedPlanInput } from "./billing";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
import { createPricingVersion } from "./pricing";
import { createShare } from "./shares";

/**
 * A slow Stripe must never hold up a surgeon's Send or a patient's Play.
 *
 * The forced overlap: "Stripe" is a stand-in that does not answer until the
 * test lets it. While billing is waiting on it, the test makes a link for the
 * SAME clinic with createShare(), which holds the clinic's row FOR SHARE
 * while it checks the plan (a printed code's Play, issueShareFromQrCode(),
 * takes the same lock).
 *
 *   Now:      billing asks Stripe holding only its own named lock, and takes
 *             the clinic's row lock afterwards, just for the write. The link
 *             is made while Stripe is still thinking.
 *   Before:   billing asked Stripe while holding the clinic's row lock. The
 *             control does exactly that (the row lock held across a pretend
 *             Stripe call) and shows the link waiting until it is let go,
 *             which proves the test would notice if the lock came back.
 *
 * Also here: two looks at Stripe for one clinic still happen one after the
 * other (so an older answer can never be applied over a newer one), a record
 * whose subscription changed while Stripe was being asked is not written
 * from the stale answer, and a plan change's lock is not one links wait for.
 */

const tag = randomBytes(5).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;
const createdClinicIds: string[] = [];
let pricingVersionId = "";
let videoId = "";

/** Long enough that an unblocked createShare finishes many times over, against the local or the remote database. */
const WAIT_MS = 2000;

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest slow Stripe fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
  videoId = (
    await prisma.video.create({
      data: { title: `Vitest slow Stripe video ${tag}`, category: "KNEE", videoUrl: "https://example.com/v.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (videoId) await prisma.video.deleteMany({ where: { id: videoId } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

function planInput(): AcceptedPlanInput {
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
  };
}

/** A paying clinic: its first payment confirmed, open, with Knee on its plan. */
async function makePayingClinic() {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest slow Stripe ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinic.id, customerId);
  const plan = await recordAcceptedPlan(clinic.id, planInput());
  const snap = (more: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
    subscriptionId,
    customerId,
    status: "active",
    latestInvoicePaid: true,
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    cancelAt: null,
    planId: plan.id,
    ...more,
  });
  await reconcileSubscription({ clinicId: clinic.id, subscriptionId, fetchSubscription: async () => snap() });
  const row = await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id }, select: { status: true } });
  expect(row.status).toBe("ACTIVE");
  return { clinicId: clinic.id, customerId, subscriptionId, planId: plan.id, snap };
}

/** A stand-in Stripe call that answers only when the test says so. `asked` resolves once it has been called. */
function heldStripe<T>(answer: () => T) {
  let release!: () => void;
  let markAsked!: () => void;
  const asked = new Promise<void>((resolve) => (markAsked = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const call = async () => {
    calls += 1;
    markAsked();
    await gate;
    return answer();
  };
  return { call, asked, release, calls: () => calls };
}

/** Did `promise` settle within `ms`? */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  const done = promise.then(
    () => true,
    () => true,
  );
  const result = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return result;
}

describe("a slow Stripe and the clinic's links", () => {
  it("a link is made for the clinic while billing is still waiting on Stripe", async () => {
    const f = await makePayingClinic();
    const stripe = heldStripe(() => f.snap({ cancelAt: new Date("2026-12-01T00:00:00.000Z") }));

    const reconciling = reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: stripe.call });
    await stripe.asked;

    // Stripe has not answered. A surgeon presses Send for this very clinic.
    const sending = createShare(f.clinicId, videoId);
    expect(await settlesWithin(sending, WAIT_MS)).toBe(true);
    await expect(sending).resolves.toMatchObject({ code: expect.any(String) });

    stripe.release();
    await expect(reconciling).resolves.toMatchObject({ kind: "processed", logged: 1 });
    const billing = await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId: f.clinicId }, select: { cancelAt: true } });
    expect(billing.cancelAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("control: with the clinic's row lock held across the Stripe call, as before, the link has to wait", async () => {
    const f = await makePayingClinic();
    const stripe = heldStripe(() => null);

    // What reconcileSubscription used to do: take the row lock, then ask Stripe.
    const oldWay = prisma.$transaction(
      async (tx) => {
        await readClinicLocked(tx, f.clinicId, { id: true });
        await stripe.call();
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    await stripe.asked;

    const sending = createShare(f.clinicId, videoId);
    expect(await settlesWithin(sending, WAIT_MS)).toBe(false);

    stripe.release();
    await oldWay;
    await expect(sending).resolves.toMatchObject({ code: expect.any(String) });
  });

  it("a plan change waiting on Stripe does not hold up a link either, and a second plan change waits its turn", async () => {
    const f = await makePayingClinic();
    const stripe = heldStripe(() => "done");
    const order: string[] = [];

    const first = withPlanChangeLock(f.clinicId, async () => {
      const answer = await stripe.call();
      order.push("first");
      return answer;
    });
    await stripe.asked;

    const sending = createShare(f.clinicId, videoId);
    expect(await settlesWithin(sending, WAIT_MS)).toBe(true);

    const second = withPlanChangeLock(f.clinicId, async () => {
      order.push("second");
      return "second";
    });
    expect(await settlesWithin(second, WAIT_MS)).toBe(false);

    stripe.release();
    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first", "second"]);
  });
});

describe("two looks at Stripe for one clinic", () => {
  it("still happen one after the other, so an older answer is never applied over a newer one", async () => {
    const f = await makePayingClinic();
    // The first look gets Stripe's OLD answer (no cancellation), but slowly. The second look, started
    // while the first is still waiting, gets the NEW answer (a cancellation scheduled) straight away.
    const slowOld = heldStripe(() => f.snap());
    const fastNew = async () => f.snap({ cancelAt: new Date("2026-12-01T00:00:00.000Z") });

    const first = reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription: slowOld.call });
    await slowOld.asked;
    let secondAsked = false;
    const second = reconcileSubscription({
      clinicId: f.clinicId,
      subscriptionId: f.subscriptionId,
      fetchSubscription: async () => {
        secondAsked = true;
        return fastNew();
      },
    });

    // The second look must not even ask Stripe while the first is under way.
    expect(await settlesWithin(second, WAIT_MS)).toBe(false);
    expect(secondAsked).toBe(false);

    slowOld.release();
    await first;
    await second;
    const billing = await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId: f.clinicId }, select: { cancelAt: true } });
    expect(billing.cancelAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("a record whose subscription changed while Stripe was being asked is not written from that answer: Stripe is asked again", async () => {
    const f = await makePayingClinic();
    const otherSubscription = unique("sub");
    let calls = 0;
    const stripe = heldStripe(() => f.snap({ cancelAt: new Date("2026-12-01T00:00:00.000Z") }));
    const fetchSubscription = async (id: string) => {
      calls += 1;
      if (calls === 1) return stripe.call();
      return f.snap({ subscriptionId: id, cancelAt: new Date("2027-01-01T00:00:00.000Z") });
    };

    const reconciling = reconcileSubscription({ clinicId: f.clinicId, subscriptionId: f.subscriptionId, fetchSubscription });
    await stripe.asked;
    // A row written around the app while Stripe was thinking: the record now expects another subscription.
    await prisma.clinicBilling.update({ where: { clinicId: f.clinicId }, data: { stripeSubscriptionId: otherSubscription } });
    stripe.release();
    await reconciling;

    expect(calls).toBe(2);
    const billing = await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId: f.clinicId }, select: { cancelAt: true, stripeSubscriptionId: true } });
    // The first, stale answer (a cancellation on 1 December) was never written.
    expect(billing.cancelAt?.toISOString()).not.toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("a plan change that overruns its lock (audit finding E7)", () => {
  it("stops before its next Stripe write instead of carrying on, and one inside the time carries on", async () => {
    const f = await makePayingClinic();
    let wrote = false;
    const late = withPlanChangeLock(
      f.clinicId,
      async (ensureHeld) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        ensureHeld();
        wrote = true;
      },
      { writeCutoffMs: 50 },
    );
    await expect(late).rejects.toBeInstanceOf(PlanChangeOverrunError);
    expect(wrote).toBe(false);

    await expect(withPlanChangeLock(f.clinicId, async (ensureHeld) => {
        ensureHeld();
        return "wrote";
      })).resolves.toBe("wrote");
  });
});
