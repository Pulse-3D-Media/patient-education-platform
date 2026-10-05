import type { Category } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  REVIEW_MINUTES,
  classifyPlanChange,
  planChangeBlock,
  readChangeConfirm,
  readChangeRequest,
  reviewMomentIsUsable,
  type ChangeBlockFacts,
  type ChangeShape,
} from "./plan-change";

/**
 * The rules for changing a paid plan, with plain values: which changes
 * start now and which wait for the renewal, who may change a plan, and what
 * the two forms may say. No database, no Stripe.
 */

function shape(overrides: Partial<ChangeShape> = {}): ChangeShape {
  return { pricingVersionId: "v1", entitledCategories: ["KNEE", "HIP"], surgeonSeats: 3, interval: "MONTH", perSeatCents: 8900, ...overrides };
}

describe("classifyPlanChange", () => {
  const current = shape();

  it("only adding starts now: more seats, more categories, or both", () => {
    expect(classifyPlanChange(current, shape({ surgeonSeats: 4 }))).toEqual({ timing: "now" });
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE", "HIP", "SPINE"], perSeatCents: 10900 }))).toEqual({ timing: "now" });
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE", "HIP", "SPINE"], surgeonSeats: 5, perSeatCents: 10900 }))).toEqual({ timing: "now" });
  });

  it("only taking away waits for the renewal: fewer seats, fewer categories, or both", () => {
    expect(classifyPlanChange(current, shape({ surgeonSeats: 2 }))).toEqual({ timing: "renewal", why: "reduction" });
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE"], perSeatCents: 5900 }))).toEqual({ timing: "renewal", why: "reduction" });
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE"], surgeonSeats: 1, perSeatCents: 5900 }))).toEqual({ timing: "renewal", why: "reduction" });
  });

  it("adding one thing while taking another away is a mixed change and waits whole", () => {
    // A category added and another removed.
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE", "SPINE"] }))).toEqual({ timing: "renewal", why: "mixed" });
    // Seats raised while a category is dropped.
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE"], surgeonSeats: 6, perSeatCents: 5900 }))).toEqual({ timing: "renewal", why: "mixed" });
    // A category added while seats are lowered.
    expect(classifyPlanChange(current, shape({ entitledCategories: ["KNEE", "HIP", "SPINE"], surgeonSeats: 2, perSeatCents: 10900 }))).toEqual({ timing: "renewal", why: "mixed" });
  });

  it("changing how often you pay, or which prices you are on, waits for the renewal whatever else the change does", () => {
    expect(classifyPlanChange(current, shape({ interval: "YEAR", perSeatCents: 89000 }))).toEqual({ timing: "renewal", why: "interval" });
    expect(classifyPlanChange(current, shape({ interval: "YEAR", surgeonSeats: 9, perSeatCents: 89000 }))).toEqual({ timing: "renewal", why: "interval" });
    expect(classifyPlanChange(current, shape({ pricingVersionId: "v2", perSeatCents: 9400 }))).toEqual({ timing: "renewal", why: "pricing" });
    // Even a change that only adds, when it also moves to other prices.
    expect(classifyPlanChange(current, shape({ pricingVersionId: "v2", surgeonSeats: 4, perSeatCents: 9400 }))).toEqual({ timing: "renewal", why: "pricing" });
    // New prices outrank the interval as the reason given.
    expect(classifyPlanChange(current, shape({ pricingVersionId: "v2", interval: "YEAR" }))).toEqual({ timing: "renewal", why: "pricing" });
  });

  it("is never sorted by price alone", () => {
    // Costs MORE in total (six seats) and still takes a category away: not an upgrade.
    const dearerButLess = shape({ entitledCategories: ["KNEE"], surgeonSeats: 6, perSeatCents: 5900 });
    expect(dearerButLess.perSeatCents * dearerButLess.surgeonSeats).toBeGreaterThan(current.perSeatCents * current.surgeonSeats);
    expect(classifyPlanChange(current, dearerButLess).timing).toBe("renewal");
    // Costs the SAME per seat and includes a different pair of categories: a mixed change, not "nothing".
    expect(classifyPlanChange(current, shape({ entitledCategories: ["SPINE", "SHOULDER"] }))).toEqual({ timing: "renewal", why: "mixed" });
    // Costs the SAME (an equal rung on the price ladder) and only adds a category: an upgrade, starting now.
    const all: Category[] = ["SPINE", "COMPLEX_SPINE", "KNEE", "SHOULDER", "HIP", "FOOT_ANKLE"];
    const five = shape({ entitledCategories: all.slice(0, 5), perSeatCents: 13900 });
    expect(classifyPlanChange(five, shape({ entitledCategories: all, perSeatCents: 13900 }))).toEqual({ timing: "now" });
  });

  it("the same plan is no change, in whatever order its categories are listed", () => {
    expect(classifyPlanChange(current, shape({ entitledCategories: ["HIP", "KNEE"] }))).toEqual({ timing: "same" });
  });
});

describe("planChangeBlock", () => {
  const ok: ChangeBlockFacts = { eligibility: { eligible: true }, open: true, status: "ACTIVE", hasCurrentPlan: true, cancelAt: null, pendingPlanId: null };

  it("lets a paid-up, eligible clinic change its plan where card payment is open", () => {
    expect(planChangeBlock(ok)).toBeNull();
  });

  it("gives one plain reason for every case that is refused", () => {
    expect(planChangeBlock({ ...ok, eligibility: { eligible: false, reason: "managed-by-pulse" } })).toContain("managed by Pulse 3D");
    expect(planChangeBlock({ ...ok, eligibility: { eligible: false, reason: "hospital" } })).toContain("Hospitals");
    expect(planChangeBlock({ ...ok, eligibility: { eligible: false, reason: "closed-by-staff" } })).toContain("paused this clinic by hand");
    expect(planChangeBlock({ ...ok, open: false })).toContain("not open yet");
    expect(planChangeBlock({ ...ok, status: "PAST_DUE" })).toContain("did not go through");
    for (const status of ["NONE", "INCOMPLETE", "CANCELED"] as const) expect(planChangeBlock({ ...ok, status })).toContain("no subscription to change");
    expect(planChangeBlock({ ...ok, hasCurrentPlan: false })).toContain("no subscription to change");
    expect(planChangeBlock({ ...ok, cancelAt: new Date() })).toContain("set to end");
    expect(planChangeBlock({ ...ok, pendingPlanId: "plan_1" })).toContain("waiting for its payment");
  });

  it("who may pay by card comes first: a managed clinic is told that, not that checkout is shut", () => {
    expect(planChangeBlock({ ...ok, open: false, status: "PAST_DUE", eligibility: { eligible: false, reason: "managed-by-pulse" } })).toContain("managed by Pulse 3D");
  });
});

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
}

const PICKS = { categories: ["KNEE", "HIP"], seats: "3", interval: "MONTH", seenVersionId: "cmversion0000000000000001", seenTotalCents: "26700" };

describe("what the change forms may say", () => {
  it("reads the picks and whether to move to current pricing, and nothing else", () => {
    const read = readChangeRequest(form({ ...PICKS, moveToCurrentPricing: "yes", clinicId: "someone-else", perSeatCents: "1", founding: "true", customerId: "cus_other" }));
    expect(read).toEqual({
      ok: true,
      request: { selection: { categories: ["KNEE", "HIP"], seats: 3, interval: "MONTH", seenVersionId: "cmversion0000000000000001", seenTotalCents: 26700 }, moveToCurrentPricing: true },
    });
    expect(readChangeRequest(form(PICKS))).toMatchObject({ ok: true, request: { moveToCurrentPricing: false } });
    expect(readChangeRequest(form({ ...PICKS, moveToCurrentPricing: "true" }))).toMatchObject({ ok: true, request: { moveToCurrentPricing: false } });
  });

  it("refuses bad picks the same way the plan picker does", () => {
    expect(readChangeRequest(form({ ...PICKS, categories: ["KNEE", "NOT_A_CATEGORY"] })).ok).toBe(false);
    expect(readChangeRequest(form({ ...PICKS, seats: "0" })).ok).toBe(false);
    expect(readChangeRequest(form({ ...PICKS, seats: "2.5" })).ok).toBe(false);
    expect(readChangeRequest(form({ ...PICKS, interval: "WEEK" })).ok).toBe(false);
  });

  it("Confirm also says what was on the review step, and junk there means 'review again'", () => {
    expect(readChangeConfirm(form({ ...PICKS, seenTiming: "renewal" }))).toMatchObject({ ok: true, seen: { timing: "renewal", at: null, dueNowCents: null } });
    expect(readChangeConfirm(form({ ...PICKS, seenTiming: "now", seenAt: "1791720000", seenDueNowCents: "7866" }))).toMatchObject({
      ok: true,
      seen: { timing: "now", at: new Date(1_791_720_000_000), dueNowCents: 7866 },
    });
    const junk: Record<string, string>[] = [
      { seenTiming: "later" },
      {},
      { seenTiming: "now" },
      { seenTiming: "now", seenAt: "soon", seenDueNowCents: "7866" },
      { seenTiming: "now", seenAt: "1791720000", seenDueNowCents: "78.66" },
      { seenTiming: "now", seenAt: "1791720000" },
    ];
    for (const bad of junk) {
      expect(readChangeConfirm(form({ ...PICKS, ...bad }))).toMatchObject({ ok: false, error: expect.stringContaining("Review the change again") });
    }
  });
});

describe("reviewMomentIsUsable", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const periodStart = new Date("2026-10-01T12:00:00.000Z");
  const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

  it("accepts a recent moment inside the period being paid for", () => {
    expect(reviewMomentIsUsable(now, now, periodStart)).toBe(true);
    expect(reviewMomentIsUsable(minutes(-REVIEW_MINUTES + 1), now, periodStart)).toBe(true);
  });

  it("refuses an old one, a future one, one before the period began, and a date that is not a date", () => {
    expect(reviewMomentIsUsable(minutes(-REVIEW_MINUTES - 1), now, periodStart)).toBe(false);
    expect(reviewMomentIsUsable(minutes(5), now, periodStart)).toBe(false);
    expect(reviewMomentIsUsable(minutes(-5), now, minutes(-1))).toBe(false);
    expect(reviewMomentIsUsable(new Date(Number.NaN), now, periodStart)).toBe(false);
  });
});
