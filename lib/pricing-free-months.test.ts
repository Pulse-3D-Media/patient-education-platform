import { describe, expect, it } from "vitest";
import { CATEGORY_VALUES, DEFAULT_PRICING_CONFIG, freeMonthsOnYearly, freeMonthsWords, MAX_YEARLY_MONTHS, quote, type PricingConfig } from "./pricing";

/**
 * "2 months free" on the sign-up plan step is only ever shown when the prices make it true (Evan, 2026-11-19:
 * "promote yearly as two months free"). These prove it is worked out from the quoted totals, and that today it holds
 * for every plan a clinic can pick.
 */

const totals = (config: PricingConfig, categories: string[], seats: number) => {
  const base = { seats, categories, founding: false, practiceType: "clinic" as const, sellable: CATEGORY_VALUES, library: { all: CATEGORY_VALUES, comingSoon: [] } };
  const month = quote(config, { ...base, interval: "month" });
  const year = quote(config, { ...base, interval: "year" });
  if (!month.ok || !year.ok) throw new Error("quote refused");
  return { month: month.quote.amounts?.totalCents ?? null, year: year.quote.amounts?.totalCents ?? null };
};

describe("freeMonthsOnYearly", () => {
  it("is the whole number of monthly payments a year saves", () => {
    expect(freeMonthsOnYearly(10_000, 100_000)).toBe(2);
    expect(freeMonthsOnYearly(10_000, 110_000)).toBe(1);
  });

  it("says nothing when it is not a whole month, not a saving, or there is nothing to compare", () => {
    expect(freeMonthsOnYearly(10_000, 105_000)).toBeNull(); // a month and a half: no claim
    expect(freeMonthsOnYearly(10_000, 120_000)).toBeNull(); // twelve months' price: nothing free
    expect(freeMonthsOnYearly(10_000, 130_000)).toBeNull();
    expect(freeMonthsOnYearly(null, 100_000)).toBeNull();
    expect(freeMonthsOnYearly(10_000, null)).toBeNull();
    expect(freeMonthsOnYearly(0, 0)).toBeNull();
  });

  it("words", () => {
    expect(freeMonthsWords(2)).toBe("2 months free");
    expect(freeMonthsWords(1)).toBe("1 month free");
  });
});

describe("is it true for every plan today?", () => {
  it("with the default prices (yearly = 10 months), every category count and every card-plan seat count is exactly two months free", () => {
    expect(DEFAULT_PRICING_CONFIG.yearlyMonths).toBe(10);
    for (let count = 1; count <= CATEGORY_VALUES.length; count++) {
      for (let seats = 1; seats <= DEFAULT_PRICING_CONFIG.seats.clinicMax; seats++) {
        const { month, year } = totals(DEFAULT_PRICING_CONFIG, CATEGORY_VALUES.slice(0, count), seats);
        expect(year).toBe((month ?? 0) * 10);
        expect(freeMonthsOnYearly(month, year)).toBe(2);
      }
    }
  });

  it("for every months setting a pricing version allows, the claim is 12 minus that, and nothing at 12", () => {
    for (let months = 1; months <= MAX_YEARLY_MONTHS; months++) {
      const config = { ...DEFAULT_PRICING_CONFIG, yearlyMonths: months };
      const { month, year } = totals(config, ["KNEE", "HIP"], 3);
      expect(freeMonthsOnYearly(month, year)).toBe(months === 12 ? null : 12 - months);
    }
  });
});
