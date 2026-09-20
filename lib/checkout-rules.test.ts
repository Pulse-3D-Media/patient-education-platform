import { describe, expect, it } from "vitest";
import { attemptIsReusable, readPlanSelection, samePlanShape, sessionExpiresAt, type PlanShape } from "./checkout-rules";

/**
 * The checkout rules that need no database: reading the plan picker's form,
 * and deciding when two requests are "the same request". Pure.
 */

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

const GOOD = { categories: ["KNEE", "HIP"], seats: "3", interval: "MONTH", seenVersionId: "cmversion0000000000000001", seenTotalCents: "26700" };

describe("readPlanSelection", () => {
  it("reads a good form, with the categories put in library order", () => {
    expect(readPlanSelection(form({ ...GOOD, categories: ["HIP", "KNEE"] }))).toEqual({
      ok: true,
      selection: { categories: ["KNEE", "HIP"], seats: 3, interval: "MONTH", seenVersionId: GOOD.seenVersionId, seenTotalCents: 26700 },
    });
  });

  it("never reads a clinic id, an amount, a price, a discount or a founding flag: adding them changes nothing", () => {
    const plain = readPlanSelection(form(GOOD));
    const stuffed = readPlanSelection(
      form({ ...GOOD, clinicId: "clinic_of_someone_else", amount: "1", perSeatCents: "1", totalCents: "1", unit_amount: "1", founding: "on", foundingDiscountBp: "10000", practiceType: "clinic", pricingVersionId: "another" }),
    );
    expect(stuffed).toEqual(plain);
  });

  it("refuses no categories, an unknown category, a duplicate, and more categories than exist", () => {
    expect(readPlanSelection(form({ ...GOOD, categories: [] }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, categories: ["KNEE", "ELBOW"] }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, categories: ["knee"] }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, categories: ["constructor"] }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, categories: ["KNEE", "KNEE"] }))).toMatchObject({ ok: false, error: expect.stringContaining("twice") });
    expect(readPlanSelection(form({ ...GOOD, categories: ["KNEE", "HIP", "SPINE", "SHOULDER", "FOOT_ANKLE", "COMPLEX_SPINE", "KNEE"] }))).toMatchObject({ ok: false });
  });

  it("refuses seats that are not a whole number from 1 up", () => {
    for (const seats of ["", "0", "-1", "2.5", "1e3", "NaN", "Infinity", " ", "3 seats", "999999"]) {
      expect(readPlanSelection(form({ ...GOOD, seats }))).toMatchObject({ ok: false });
    }
    expect(readPlanSelection(form({ ...GOOD, seats: " 7 " }))).toMatchObject({ ok: true, selection: { seats: 7 } });
  });

  it("refuses an interval that is not MONTH or YEAR", () => {
    for (const interval of ["", "month", "WEEK", "DAY", "YEARLY"]) expect(readPlanSelection(form({ ...GOOD, interval }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, interval: "YEAR" }))).toMatchObject({ ok: true, selection: { interval: "YEAR" } });
  });

  it("refuses a form that does not say what total was on screen", () => {
    expect(readPlanSelection(form({ ...GOOD, seenTotalCents: "" }))).toMatchObject({ ok: false, error: expect.stringContaining("out of date") });
    expect(readPlanSelection(form({ ...GOOD, seenTotalCents: "-5" }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, seenTotalCents: "59.00" }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, seenVersionId: "" }))).toMatchObject({ ok: false });
    expect(readPlanSelection(form({ ...GOOD, seenVersionId: "'; drop table" }))).toMatchObject({ ok: false });
  });
});

describe("samePlanShape", () => {
  const plan: PlanShape = { pricingVersionId: "v1", categories: ["KNEE", "HIP"], entitledCategories: ["KNEE", "HIP"], surgeonSeats: 3, interval: "MONTH", perSeatCents: 8900, totalCents: 26700 };

  it("is true for the same plan, whatever order the categories are in", () => {
    expect(samePlanShape(plan, { ...plan, categories: ["HIP", "KNEE"], entitledCategories: ["HIP", "KNEE"] })).toBe(true);
  });

  it("is false when anything charged for or included differs", () => {
    expect(samePlanShape(plan, { ...plan, pricingVersionId: "v2" })).toBe(false);
    expect(samePlanShape(plan, { ...plan, surgeonSeats: 4, totalCents: 35600 })).toBe(false);
    expect(samePlanShape(plan, { ...plan, interval: "YEAR" })).toBe(false);
    expect(samePlanShape(plan, { ...plan, perSeatCents: 8901 })).toBe(false);
    expect(samePlanShape(plan, { ...plan, categories: ["KNEE", "SPINE"] })).toBe(false);
    expect(samePlanShape(plan, { ...plan, entitledCategories: ["KNEE", "HIP", "SPINE"] })).toBe(false);
  });
});

describe("attemptIsReusable and sessionExpiresAt", () => {
  const made = new Date("2026-09-19T12:00:00.000Z");
  const at = (minutes: number) => new Date(made.getTime() + minutes * 60_000);

  it("a payment page lasts exactly an hour from the attempt's own time", () => {
    expect(sessionExpiresAt(made).toISOString()).toBe("2026-09-19T13:00:00.000Z");
  });

  it("an attempt is reused for the first fifty minutes, and not in the last ten of its page's life", () => {
    expect(attemptIsReusable(made, at(0))).toBe(true);
    expect(attemptIsReusable(made, at(49.9))).toBe(true);
    expect(attemptIsReusable(made, at(50))).toBe(false);
    expect(attemptIsReusable(made, at(61))).toBe(false);
  });

  it("an attempt that reads as made a moment in the future still counts as recent (a double click), but not one far in the future", () => {
    expect(attemptIsReusable(made, at(-0.001))).toBe(true);
    expect(attemptIsReusable(made, at(-4))).toBe(true);
    expect(attemptIsReusable(made, at(-5))).toBe(false);
    expect(attemptIsReusable(made, at(-600))).toBe(false);
  });
});
