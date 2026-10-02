import type { BillingStatus, ClinicStatus, StaffAccess } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  NO_BILLING,
  decideBilling,
  effectiveAccess,
  graceDeadline,
  hasLiveSubscription,
  isValidGraceDays,
  sameBillingFacts,
  selfServeEligibility,
  type BillingFacts,
  type SubscriptionSnapshot,
} from "./billing-state";
import { clinicIsOpen } from "./clinic-status";

/**
 * The billing rules with plain values: no database, no Stripe. Every id in
 * here is made up.
 *
 * The first block IS the state table at the top of billing-state.ts, row by
 * row, written before the transitions were coded.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const GRACE_END = new Date("2026-10-15T12:00:00.000Z"); // 14 days after NOW
const DAY = 24 * 60 * 60 * 1000;

describe("the state table: what is stored as the clinic's status, and whether it is open", () => {
  type Row = {
    name: string;
    staff: StaffAccess | null;
    managed: boolean;
    billing: BillingStatus;
    status: ClinicStatus;
    /** Open when asked one millisecond before the grace deadline, and at it. */
    openBefore: boolean;
    openAt: boolean;
  };

  const ALL_BILLING: BillingStatus[] = ["NONE", "INCOMPLETE", "ACTIVE", "PAST_DUE", "CANCELED"];

  const rows: Row[] = [
    // Rows 1 to 3: what staff set by hand wins, whatever billing says, managed or not.
    ...ALL_BILLING.flatMap((billing) =>
      [false, true].flatMap((managed): Row[] => [
        { name: `staff pause over ${billing}`, staff: "PAUSED", managed, billing, status: "PAUSED", openBefore: false, openAt: false },
        { name: `staff cancel over ${billing}`, staff: "CANCELED", managed, billing, status: "CANCELED", openBefore: false, openAt: false },
        { name: `held open by hand over ${billing}`, staff: "OPEN", managed, billing, status: "ACTIVE", openBefore: true, openAt: true },
      ]),
    ),
    // Row 4: Pulse-managed and not opened by hand: pending, whatever billing says.
    ...ALL_BILLING.map((billing): Row => ({ name: `managed, nothing by hand, ${billing}`, staff: null, managed: true, billing, status: "PENDING", openBefore: false, openAt: false })),
    // Rows 5 to 9: self-serve, nothing by hand: billing decides.
    { name: "no plan", staff: null, managed: false, billing: "NONE", status: "PENDING", openBefore: false, openAt: false },
    { name: "incomplete checkout", staff: null, managed: false, billing: "INCOMPLETE", status: "PENDING", openBefore: false, openAt: false },
    { name: "paid active (also: cancellation scheduled)", staff: null, managed: false, billing: "ACTIVE", status: "ACTIVE", openBefore: true, openAt: true },
    { name: "payment failed, in grace then out", staff: null, managed: false, billing: "PAST_DUE", status: "PAST_DUE", openBefore: true, openAt: false },
    { name: "canceled", staff: null, managed: false, billing: "CANCELED", status: "CANCELED", openBefore: false, openAt: false },
  ];

  it.each(rows)("$name", (row) => {
    const access = effectiveAccess({
      staffAccess: row.staff,
      managedByPulse: row.managed,
      billingStatus: row.billing,
      billingGraceEndsAt: row.billing === "PAST_DUE" ? GRACE_END : null,
    });
    expect(access.status).toBe(row.status);
    // The deadline is only ever stored together with PAST_DUE.
    expect(access.graceEndsAt).toEqual(row.status === "PAST_DUE" ? GRACE_END : null);
    expect(clinicIsOpen(access, new Date(GRACE_END.getTime() - 1))).toBe(row.openBefore);
    expect(clinicIsOpen(access, GRACE_END)).toBe(row.openAt);
  });

  it("a billing status it does not know is closed, never open", () => {
    const access = effectiveAccess({ staffAccess: null, managedByPulse: false, billingStatus: "SOMETHING_NEW" as BillingStatus, billingGraceEndsAt: null });
    expect(access.status).toBe("PENDING");
  });

  it("past due with no deadline stored is closed", () => {
    const access = effectiveAccess({ staffAccess: null, managedByPulse: false, billingStatus: "PAST_DUE", billingGraceEndsAt: null });
    expect(access).toEqual({ status: "PAST_DUE", graceEndsAt: null });
    expect(clinicIsOpen(access, NOW)).toBe(false);
  });
});

describe("grace", () => {
  it("ends exactly the grace days after the failure was first recorded", () => {
    expect(graceDeadline(NOW, 14)).toEqual(GRACE_END);
    expect(graceDeadline(NOW, 1)).toEqual(new Date(NOW.getTime() + DAY));
    expect(graceDeadline(NOW, 365)).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });

  it("gives no deadline, which means closed, for a setting or a time that cannot be read", () => {
    for (const bad of [0, -1, 366, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "14", null, undefined]) {
      expect(isValidGraceDays(bad)).toBe(false);
      expect(graceDeadline(NOW, bad)).toBeNull();
    }
    expect(graceDeadline(new Date("nonsense"), 14)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decideBilling
// ---------------------------------------------------------------------------

const CUSTOMER = "cus_madeup_1";
const SUB = "sub_madeup_1";
const PLAN = "plan_madeup_1";

function facts(overrides: Partial<BillingFacts> = {}): BillingFacts {
  return { ...NO_BILLING, stripeCustomerId: CUSTOMER, ...overrides };
}

function snap(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    subscriptionId: SUB,
    customerId: CUSTOMER,
    status: "active",
    latestInvoicePaid: true,
    currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    cancelAt: null,
    planId: PLAN,
    ...overrides,
  };
}

/** Decide, and insist the answer is "apply". */
function apply(current: BillingFacts, snapshot: SubscriptionSnapshot, now = NOW, graceDays: unknown = 14) {
  const decision = decideBilling(current, snapshot, now, graceDays);
  if (decision.kind !== "apply") throw new Error(`expected apply, got ignored: ${decision.reason}`);
  return decision;
}

const waiting = facts({ pendingPlanId: PLAN });
const active = facts({ status: "ACTIVE", stripeSubscriptionId: SUB, currentPlanId: PLAN, currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z") });

describe("decideBilling: checkout and the first payment", () => {
  it("an incomplete subscription carrying the waiting plan is taken on, and opens nothing", () => {
    const d = apply(waiting, snap({ status: "incomplete", latestInvoicePaid: false }));
    expect(d.next.status).toBe("INCOMPLETE");
    expect(d.next.stripeSubscriptionId).toBe(SUB);
    expect(d.activatePlanId).toBeNull();
    expect(d.entries).toHaveLength(1);
    expect(effectiveAccess({ staffAccess: null, managedByPulse: false, billingStatus: d.next.status, billingGraceEndsAt: null }).status).toBe("PENDING");
  });

  it("Stripe saying active is not enough: without a paid invoice nothing is activated", () => {
    const d = apply(waiting, snap({ status: "active", latestInvoicePaid: false }));
    expect(d.next.status).toBe("INCOMPLETE");
    expect(d.activatePlanId).toBeNull();
  });

  it("active with a paid invoice activates the waiting plan, once", () => {
    const d = apply(waiting, snap());
    expect(d.next).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: SUB, currentPlanId: PLAN, pendingPlanId: null });
    expect(d.activatePlanId).toBe(PLAN);

    // The same state decided again: nothing to say, nothing to activate, nothing changed.
    const again = apply(d.next, snap());
    expect(again.entries).toEqual([]);
    expect(again.activatePlanId).toBeNull();
    expect(sameBillingFacts(again.next, d.next)).toBe(true);
  });

  it("a failed FIRST payment leaves the subscription incomplete: no grace, no access", () => {
    const started = apply(waiting, snap({ status: "incomplete", latestInvoicePaid: false })).next;
    const failed = apply(started, snap({ status: "incomplete", latestInvoicePaid: false }));
    expect(failed.next.status).toBe("INCOMPLETE");
    expect(failed.next.paymentFailedAt).toBeNull();
    expect(failed.next.graceEndsAt).toBeNull();
    expect(failed.entries).toEqual([]);
  });

  it("a checkout that expires unpaid goes back to no subscription and frees the waiting plan", () => {
    const started = apply(waiting, snap({ status: "incomplete", latestInvoicePaid: false })).next;
    const expired = apply(started, snap({ status: "incomplete_expired", latestInvoicePaid: false }));
    expect(expired.next).toMatchObject({ status: "NONE", stripeSubscriptionId: null, pendingPlanId: null });
    expect(expired.activatePlanId).toBeNull();
  });
});

describe("decideBilling: a failed renewal, grace and recovery", () => {
  it("starts grace once, at the moment the failure is first recorded", () => {
    const d = apply(active, snap({ status: "past_due", latestInvoicePaid: false }));
    expect(d.next).toMatchObject({ status: "PAST_DUE", paymentFailedAt: NOW, graceEndsAt: GRACE_END });
    expect(d.entries).toHaveLength(1);
    expect(d.activatePlanId).toBeNull();
  });

  it("a repeated failure days later does not move the deadline and logs nothing", () => {
    const first = apply(active, snap({ status: "past_due", latestInvoicePaid: false })).next;
    const later = new Date(NOW.getTime() + 5 * DAY);
    const again = apply(first, snap({ status: "past_due", latestInvoicePaid: false }), later, 30);
    expect(again.next.paymentFailedAt).toEqual(NOW);
    expect(again.next.graceEndsAt).toEqual(GRACE_END);
    expect(again.entries).toEqual([]);

    // Stripe's "unpaid" (retries used up) is the same failure, not a new one.
    const unpaid = apply(first, snap({ status: "unpaid", latestInvoicePaid: false }), later);
    expect(unpaid.next.graceEndsAt).toEqual(GRACE_END);
    expect(unpaid.entries).toEqual([]);
  });

  it("a grace days setting that cannot be read gives no grace at all, and says so", () => {
    const d = apply(active, snap({ status: "past_due", latestInvoicePaid: false }), NOW, Number.NaN);
    expect(d.next.status).toBe("PAST_DUE");
    expect(d.next.graceEndsAt).toBeNull();
    expect(d.entries[0]).toContain("no grace period");
  });

  it("recovers only on a PAID invoice, and then clears the failure and the deadline", () => {
    const failed = apply(active, snap({ status: "past_due", latestInvoicePaid: false })).next;

    // Written off in Stripe: Stripe says active, nothing was paid. Not a recovery.
    const writtenOff = apply(failed, snap({ status: "active", latestInvoicePaid: false }));
    expect(writtenOff.next.status).toBe("PAST_DUE");
    expect(writtenOff.next.graceEndsAt).toEqual(GRACE_END);
    expect(writtenOff.entries).toEqual([]);

    const recovered = apply(failed, snap({ status: "active", latestInvoicePaid: true }));
    expect(recovered.next).toMatchObject({ status: "ACTIVE", paymentFailedAt: null, graceEndsAt: null });
    expect(recovered.entries).toEqual(["Payment recovered. The subscription is active again."]);
    expect(recovered.activatePlanId).toBeNull();
  });

  it("a second failure after a recovery starts a fresh grace period", () => {
    const failed = apply(active, snap({ status: "past_due", latestInvoicePaid: false })).next;
    const recovered = apply(failed, snap()).next;
    const later = new Date(NOW.getTime() + 40 * DAY);
    const failedAgain = apply(recovered, snap({ status: "past_due", latestInvoicePaid: false }), later);
    expect(failedAgain.next.paymentFailedAt).toEqual(later);
    expect(failedAgain.next.graceEndsAt).toEqual(new Date(later.getTime() + 14 * DAY));
  });
});

describe("decideBilling: cancellation", () => {
  it("a scheduled cancellation keeps the subscription active, and is logged once", () => {
    const cancelAt = new Date("2026-11-01T00:00:00.000Z");
    const scheduled = apply(active, snap({ cancelAt }));
    expect(scheduled.next).toMatchObject({ status: "ACTIVE", cancelAt });
    expect(scheduled.entries).toHaveLength(1);

    expect(apply(scheduled.next, snap({ cancelAt })).entries).toEqual([]);

    const removed = apply(scheduled.next, snap({ cancelAt: null }));
    expect(removed.next.cancelAt).toBeNull();
    expect(removed.entries).toEqual(["The scheduled cancellation was removed."]);
  });

  it("canceled ends it, and clears the dates that no longer mean anything", () => {
    const failed = apply(active, snap({ status: "past_due", latestInvoicePaid: false })).next;
    const ended = apply(failed, snap({ status: "canceled", latestInvoicePaid: false }));
    expect(ended.next).toMatchObject({ status: "CANCELED", cancelAt: null, paymentFailedAt: null, graceEndsAt: null, stripeSubscriptionId: SUB });
    expect(apply(ended.next, snap({ status: "canceled", latestInvoicePaid: false })).entries).toEqual([]);
  });

  it("cancelled before it was ever paid is not 'ended': the clinic never became a customer", () => {
    const started = apply(waiting, snap({ status: "incomplete", latestInvoicePaid: false })).next;
    const d = apply(started, snap({ status: "canceled", latestInvoicePaid: false }));
    expect(d.next).toMatchObject({ status: "NONE", stripeSubscriptionId: null, pendingPlanId: null });
  });
});

describe("decideBilling: whose subscription is it", () => {
  it("ignores a subscription that belongs to another customer, and asks for a look", () => {
    const d = decideBilling(active, snap({ customerId: "cus_someone_else" }), NOW, 14);
    expect(d).toMatchObject({ kind: "ignored", needsLook: true });
  });

  it("ignores everything for a clinic that has no Stripe customer", () => {
    expect(decideBilling(NO_BILLING, snap(), NOW, 14).kind).toBe("ignored");
  });

  it("ignores an unrelated subscription: not the expected one, not carrying the waiting plan", () => {
    // Nobody is being charged for it: noise, and nobody needs to look.
    const unpaid = decideBilling(active, snap({ subscriptionId: "sub_unrelated", planId: null, status: "incomplete", latestInvoicePaid: false }), NOW, 14);
    expect(unpaid).toMatchObject({ kind: "ignored", needsLook: false });
    const wrongPlan = decideBilling(waiting, snap({ subscriptionId: "sub_unrelated", planId: "plan_of_another_clinic", status: "incomplete", latestInvoicePaid: false }), NOW, 14);
    expect(wrongPlan).toMatchObject({ kind: "ignored", needsLook: false });
  });

  it("an unrecognised subscription that IS being charged changes nothing but asks for a look: the clinic is paying for something", () => {
    // The checkout case: the admin paid on the page of an earlier attempt after accepting a newer plan.
    for (const status of ["active", "past_due", "unpaid", "trialing"]) {
      const d = decideBilling(waiting, snap({ subscriptionId: "sub_earlier_attempt", planId: "plan_of_the_earlier_attempt", status }), NOW, 14);
      expect(d).toMatchObject({ kind: "ignored", needsLook: true, reason: expect.stringContaining("earlier attempt") });
    }
  });

  it("an attempt that dies clears the waiting plan only when it is the plan that attempt was for", () => {
    // The ordinary case: the one attempt expires, and nothing is waiting any more.
    const started = facts({ status: "INCOMPLETE", stripeSubscriptionId: SUB, pendingPlanId: PLAN });
    for (const status of ["incomplete_expired", "canceled"]) {
      expect(apply(started, snap({ status, latestInvoicePaid: false })).next).toMatchObject({ status: "NONE", stripeSubscriptionId: null, pendingPlanId: null });
    }
    // The checkout case: the admin started again, so a NEWER plan is waiting. The old attempt's death must leave it alone,
    // or the new checkout would be paid and then not recognised.
    const startedAgain = facts({ status: "INCOMPLETE", stripeSubscriptionId: SUB, pendingPlanId: "plan_newer" });
    for (const status of ["incomplete_expired", "canceled"]) {
      expect(apply(startedAgain, snap({ status, latestInvoicePaid: false, planId: PLAN })).next).toMatchObject({ status: "NONE", stripeSubscriptionId: null, pendingPlanId: "plan_newer" });
    }
  });

  it("news of an OLD, cancelled subscription cannot touch the plan that replaced it", () => {
    const replaced = facts({ status: "ACTIVE", stripeSubscriptionId: "sub_new", currentPlanId: "plan_new" });
    const d = decideBilling(replaced, snap({ subscriptionId: "sub_old", status: "canceled", planId: "plan_old", latestInvoicePaid: false }), NOW, 14);
    expect(d.kind).toBe("ignored");
  });

  it("after a cancellation, a new subscription carrying the newly accepted plan takes over", () => {
    const ended = facts({ status: "CANCELED", stripeSubscriptionId: "sub_old", currentPlanId: "plan_old", pendingPlanId: "plan_new" });
    const d = apply(ended, snap({ subscriptionId: "sub_new", planId: "plan_new" }));
    expect(d.next).toMatchObject({ status: "ACTIVE", stripeSubscriptionId: "sub_new", currentPlanId: "plan_new", pendingPlanId: null });
    expect(d.activatePlanId).toBe("plan_new");
  });

  it("a dead subscription is never taken on, even when it carries the waiting plan", () => {
    for (const status of ["canceled", "incomplete_expired"]) {
      expect(decideBilling(waiting, snap({ status, latestInvoicePaid: false }), NOW, 14).kind).toBe("ignored");
    }
  });

  it("a second live subscription while one is being paid for changes nothing and asks for a look", () => {
    const d = decideBilling({ ...active, pendingPlanId: "plan_second" }, snap({ subscriptionId: "sub_second", planId: "plan_second" }), NOW, 14);
    expect(d).toMatchObject({ kind: "ignored", needsLook: true });
  });

  it("a state this app never creates (a trial, a pause) changes nothing and asks for a look", () => {
    for (const status of ["trialing", "paused", "a_word_stripe_adds_later"]) {
      expect(decideBilling(active, snap({ status }), NOW, 14)).toMatchObject({ kind: "ignored", needsLook: true });
    }
  });
});

describe("who may pay by card", () => {
  it("a clinic, or one Pulse staff never marked (UNKNOWN counts as a clinic, decided 2026-09-25); never a hospital, never one managed by Pulse", () => {
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: false })).toEqual({ eligible: true });
    expect(selfServeEligibility({ practiceType: "UNKNOWN", managedByPulse: false })).toEqual({ eligible: true });
    expect(selfServeEligibility({ practiceType: "HOSPITAL", managedByPulse: false })).toEqual({ eligible: false, reason: "hospital" });
    // A hospital is refused for what it is, whatever else is true of it.
    expect(selfServeEligibility({ practiceType: "HOSPITAL", managedByPulse: false, staffAccess: "OPEN" })).toEqual({ eligible: false, reason: "hospital" });
    // UNKNOWN is only ever treated as a clinic: the other refusals still apply to it.
    expect(selfServeEligibility({ practiceType: "UNKNOWN", managedByPulse: true })).toEqual({ eligible: false, reason: "managed-by-pulse" });
    expect(selfServeEligibility({ practiceType: "UNKNOWN", managedByPulse: false, staffAccess: "PAUSED" })).toEqual({ eligible: false, reason: "closed-by-staff" });
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: true })).toEqual({ eligible: false, reason: "managed-by-pulse" });
    // Paused or ended by Pulse staff: a payment would be taken and the clinic would stay closed, so it may not pay.
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: false, staffAccess: "PAUSED" })).toEqual({ eligible: false, reason: "closed-by-staff" });
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: false, staffAccess: "CANCELED" })).toEqual({ eligible: false, reason: "closed-by-staff" });
    // Held open by hand may pay: its first confirmed payment hands its access over to its payments.
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: false, staffAccess: "OPEN" })).toEqual({ eligible: true });
    expect(selfServeEligibility({ practiceType: "CLINIC", managedByPulse: false, staffAccess: null })).toEqual({ eligible: true });
  });

  it("a subscription that may still be charging is any but none and ended", () => {
    expect((["NONE", "INCOMPLETE", "ACTIVE", "PAST_DUE", "CANCELED"] as const).filter(hasLiveSubscription)).toEqual(["INCOMPLETE", "ACTIVE", "PAST_DUE"]);
  });
});
