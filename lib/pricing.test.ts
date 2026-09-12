import { describe, expect, it } from "vitest";
import {
  CATEGORY_VALUES,
  DEFAULT_PRICING_CONFIG,
  bandFor,
  bpToPercentText,
  centsToDollarsText,
  formatBp,
  formatCents,
  fullLibraryOffered,
  parseDollarsToCents,
  parsePercentToBp,
  quote,
  validatePricingConfig,
  type PricingConfig,
  type QuoteInput,
} from "./pricing";

/**
 * THE PRICING DECISION, recorded here beside the fixtures as prompt 6 asks.
 *
 * The question (Codex revision, 2026-09-11): is the product the exact
 * ladder of $59 / $89 / $109 / $125 / $139 per seat by number of
 * categories, or is it category prices with percentage discounts, with the
 * totals allowed to differ from that ladder?
 *
 * Decided by Evan on 2026-09-11: the rounded ladder. (He first said the
 * percentage model with exact cents, then reversed it the same evening:
 * "nope sorry rounded ladder".) So the config is the ladder itself, one
 * editable whole-cent price per number of categories, and the fixtures
 * below are those amounts to the cent. There are no per-category prices:
 * a count-based price makes the identity of the categories irrelevant, and
 * a category price of its own would be a second pricing mode to decide on
 * before it is built. The numbers themselves are placeholders to edit on
 * /pulse/pricing.
 */

/** All six categories are for sale unless a test says otherwise. */
const ALL_SELLABLE = [...CATEGORY_VALUES];

/** One seat, monthly, a clinic, no founding offer: the plainest input. */
function input(overrides: Partial<QuoteInput>): QuoteInput {
  return {
    seats: 1,
    categories: ["KNEE"],
    interval: "month",
    founding: false,
    practiceType: "clinic",
    sellable: ALL_SELLABLE,
    ...overrides,
  };
}

/** The first N categories in library order. */
function firstCategories(count: number) {
  return CATEGORY_VALUES.slice(0, count);
}

/** A quote that must succeed and must have amounts, or the test fails on the spot. */
function amountsFor(config: PricingConfig, overrides: Partial<QuoteInput>) {
  const result = quote(config, input(overrides));
  if (!result.ok) throw new Error(result.error);
  if (!result.quote.amounts) throw new Error(`Expected amounts, got band ${result.quote.band}`);
  return { quote: result.quote, amounts: result.quote.amounts };
}

describe("the defaults", () => {
  it("are a valid config", () => {
    const checked = validatePricingConfig(DEFAULT_PRICING_CONFIG);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.config).toEqual(DEFAULT_PRICING_CONFIG);
  });

  it("survive a trip through JSON, which is how a version is stored", () => {
    const checked = validatePricingConfig(JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG)));
    expect(checked.ok).toBe(true);
  });
});

describe("the price fixtures at the defaults (per seat, per month, exact cents)", () => {
  // The ladder as approved: whole dollars, to the cent.
  const expected: Record<number, number> = { 1: 5900, 2: 8900, 3: 10900, 4: 12500, 5: 13900 };

  for (const count of [1, 2, 3, 4, 5]) {
    it(`${count} ${count === 1 ? "category" : "categories"} is ${formatCents(expected[count])}`, () => {
      const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(count) });
      expect(q.chargedCount).toBe(count);
      expect(amounts.perSeatCents).toBe(expected[count]);
      expect(amounts.totalCents).toBe(expected[count]);
      expect(amounts.currency).toBe("usd");
      expect(amounts.interval).toBe("month");
    });
  }

  it("five categories buys the full library: charged as five, entitled to all six", () => {
    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(5) });
    expect(q.fullLibrary).toBe(true);
    expect(q.chargedCount).toBe(5);
    expect(q.chargedCategories).toEqual([]);
    expect(q.entitledCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.lines).toEqual([{ label: "Full library (5 categories)", cents: 13900 }]);
    expect(amounts.perSeatCents).toBe(13900);
  });

  it("all six categories is the full library too, at the five-category price, never a sixth charge", () => {
    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: CATEGORY_VALUES });
    expect(q.fullLibrary).toBe(true);
    expect(q.selectedCategories).toEqual(CATEGORY_VALUES);
    expect(q.chargedCount).toBe(5);
    expect(q.entitledCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.perSeatCents).toBe(13900);
  });

  it("multiplies the per-seat amount by the seats, never rounds a total", () => {
    const three = amountsFor(DEFAULT_PRICING_CONFIG, { seats: 3, categories: firstCategories(2) }).amounts;
    expect(three.perSeatCents).toBe(8900);
    expect(three.totalCents).toBe(3 * 8900);
    expect(three.savingsCents).toBe(0);

    const ten = amountsFor(DEFAULT_PRICING_CONFIG, { seats: 10, categories: firstCategories(5) }).amounts;
    expect(ten.totalCents).toBe(139000);
  });

  it("puts the categories taken on one exact receipt line at the ladder price", () => {
    const { amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["HIP", "KNEE"] });
    expect(amounts.lines).toEqual([{ label: "2 categories: Knee, Hip", cents: 8900 }]);
    expect(amounts.perSeatListCents).toBe(8900);
    expect(amounts.foundingDiscountBp).toBe(0);
    expect(amounts.monthlyEquivalentCents).toBeNull();
  });

  it("charges the same for any two categories: which ones they are does not change the price", () => {
    const a = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["SPINE", "KNEE"] }).amounts;
    const b = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["HIP", "FOOT_ANKLE"] }).amounts;
    expect(a.perSeatCents).toBe(b.perSeatCents);
    expect(a.perSeatCents).toBe(8900);
  });
});

describe("yearly billing", () => {
  it("charges the configured number of months, per seat", () => {
    const one = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year" }).amounts;
    expect(one.lines).toEqual([{ label: "1 category: Knee", cents: 59000 }]);
    expect(one.perSeatCents).toBe(59000);

    const two = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", categories: firstCategories(2) }).amounts;
    expect(two.perSeatCents).toBe(89000);

    const twoThreeSeats = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", seats: 3, categories: firstCategories(2) }).amounts;
    expect(twoThreeSeats.totalCents).toBe(3 * 89000);
  });

  it("gives a monthly equivalent for display only, and it is not the charged amount", () => {
    const { amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", categories: firstCategories(2) });
    expect(amounts.monthlyEquivalentCents).toBe(7417); // 89000 / 12 = 7416.67
    expect(amounts.totalCents).toBe(89000);
  });
});

describe("the founding offer", () => {
  const withFounding: PricingConfig = { ...DEFAULT_PRICING_CONFIG, foundingDiscountBp: 1000 };

  it("is zero by default, so asking for it changes nothing", () => {
    const without = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(2) }).amounts;
    const asked = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(2), founding: true }).amounts;
    expect(asked.foundingDiscountBp).toBe(0);
    expect(asked.perSeatCents).toBe(without.perSeatCents);
  });

  it("is applied exactly once, with one rounding, on the ladder price", () => {
    const monthly = amountsFor(withFounding, { categories: firstCategories(2), founding: true }).amounts;
    // 8900 * 0.9 = 8010.
    expect(monthly.foundingDiscountBp).toBe(1000);
    expect(monthly.perSeatCents).toBe(8010);
    expect(monthly.savingsCents).toBe(890);

    const yearly = amountsFor(withFounding, { categories: firstCategories(2), founding: true, interval: "year" }).amounts;
    // 89000 * 0.9 = 80100: the year is charged once and the offer is taken once.
    expect(yearly.perSeatCents).toBe(80100);

    // A rounding case: $109 a year is 109000 cents; 12.5% off is 95375.0, but 12.55% off is 95312.05 -> 95312.
    const odd: PricingConfig = { ...DEFAULT_PRICING_CONFIG, foundingDiscountBp: 1255 };
    expect(amountsFor(odd, { categories: firstCategories(3), founding: true, interval: "year" }).amounts.perSeatCents).toBe(95312);
  });

  it("is not applied when the quote does not ask for it", () => {
    const { amounts } = amountsFor(withFounding, { categories: firstCategories(2), founding: false });
    expect(amounts.foundingDiscountBp).toBe(0);
    expect(amounts.perSeatCents).toBe(8900);
  });
});

describe("what is selected, charged and entitled", () => {
  it("counts a category ticked twice once, so duplicates cannot alter a price", () => {
    const once = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["KNEE", "HIP"] });
    const twice = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["HIP", "KNEE", "KNEE", "HIP", "KNEE"] });
    expect(twice.quote.selectedCategories).toEqual(["KNEE", "HIP"]);
    expect(twice.quote.chargedCount).toBe(2);
    expect(twice.quote.chargedCategories).toEqual(["KNEE", "HIP"]);
    expect(twice.amounts.perSeatCents).toBe(once.amounts.perSeatCents);
    expect(twice.amounts.perSeatCents).toBe(8900);
  });

  it("does not offer the full library while any category is not for sale", () => {
    const fiveForSale = CATEGORY_VALUES.filter((category) => category !== "FOOT_ANKLE");
    expect(fullLibraryOffered(DEFAULT_PRICING_CONFIG, fiveForSale)).toBe(false);

    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: fiveForSale, sellable: fiveForSale });
    expect(q.fullLibrary).toBe(false);
    expect(q.chargedCount).toBe(5);
    expect(q.chargedCategories).toEqual(fiveForSale);
    expect(q.entitledCategories).toEqual(fiveForSale);
    expect(q.notes.join(" ")).toContain("not offered until every category is for sale");
    expect(amounts.lines[0].label).toMatch(/^5 categories: /);
    expect(amounts.perSeatCents).toBe(13900);
  });

  it("refuses a category that is not for sale, by name", () => {
    const fiveForSale = CATEGORY_VALUES.filter((category) => category !== "FOOT_ANKLE");
    const result = quote(DEFAULT_PRICING_CONFIG, input({ categories: ["FOOT_ANKLE"], sellable: fiveForSale }));
    expect(result).toEqual({ ok: false, error: "Not for sale right now: Foot & Ankle." });
  });

  it("charges the six-category price when there is no full-library offer", () => {
    const noBundle: PricingConfig = { ...DEFAULT_PRICING_CONFIG, fullLibraryFrom: null, perSeatByCountCents: [5900, 8900, 10900, 12500, 13900, 15900] };
    const { quote: q, amounts } = amountsFor(noBundle, { categories: CATEGORY_VALUES });
    expect(q.fullLibrary).toBe(false);
    expect(q.chargedCount).toBe(6);
    expect(q.chargedCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.perSeatCents).toBe(15900);
  });

  it("uses the edited ladder, not fixed numbers", () => {
    const dearer: PricingConfig = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [6500, 9500, 11500, 13000, 14500, 14500] };
    expect(amountsFor(dearer, { categories: firstCategories(1) }).amounts.perSeatCents).toBe(6500);
    expect(amountsFor(dearer, { categories: firstCategories(3) }).amounts.perSeatCents).toBe(11500);
    expect(amountsFor(dearer, { categories: CATEGORY_VALUES }).amounts.perSeatCents).toBe(14500);
  });
});

describe("bands", () => {
  it("is Solo up to the Solo limit, Clinic up to the Clinic limit, then Enterprise", () => {
    expect(bandFor(DEFAULT_PRICING_CONFIG, 1, "clinic")).toBe("solo");
    expect(bandFor(DEFAULT_PRICING_CONFIG, 2, "clinic")).toBe("clinic");
    expect(bandFor(DEFAULT_PRICING_CONFIG, 10, "clinic")).toBe("clinic");
    expect(bandFor(DEFAULT_PRICING_CONFIG, 11, "clinic")).toBe("enterprise");
  });

  it("gives a hospital with one surgeon Enterprise, with no amount", () => {
    const result = quote(DEFAULT_PRICING_CONFIG, input({ practiceType: "hospital" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.band).toBe("enterprise");
    expect(result.quote.amounts).toBeNull();
    expect(result.quote.chargedCount).toBe(0);
    expect(result.quote.chargedCategories).toEqual([]);
    expect(result.quote.entitledCategories).toEqual([]);
    expect(result.quote.notes[0]).toContain("Hospitals");
  });

  it("gives a clinic past the self-serve seat limit Enterprise, with no amount", () => {
    const result = quote(DEFAULT_PRICING_CONFIG, input({ seats: 11, categories: firstCategories(3) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.band).toBe("enterprise");
    expect(result.quote.amounts).toBeNull();
  });

  it("uses the edited limits, not fixed ones", () => {
    const wider: PricingConfig = { ...DEFAULT_PRICING_CONFIG, seats: { soloMax: 2, clinicMax: 25 } };
    expect(bandFor(wider, 2, "clinic")).toBe("solo");
    expect(bandFor(wider, 25, "clinic")).toBe("clinic");
    expect(bandFor(wider, 26, "clinic")).toBe("enterprise");
  });
});

describe("input that cannot be quoted", () => {
  it("needs at least one category", () => {
    expect(quote(DEFAULT_PRICING_CONFIG, input({ categories: [] }))).toEqual({ ok: false, error: "Choose at least one category." });
  });

  it("refuses a category that is not ours", () => {
    const result = quote(DEFAULT_PRICING_CONFIG, input({ categories: ["HAND" as never] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("HAND");
  });

  it("needs seats to be a whole number, at least one", () => {
    for (const seats of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_001]) {
      const result = quote(DEFAULT_PRICING_CONFIG, input({ seats }));
      expect(result.ok, `seats ${seats}`).toBe(false);
    }
  });

  it("refuses an interval or practice type it does not know", () => {
    expect(quote(DEFAULT_PRICING_CONFIG, input({ interval: "week" as never })).ok).toBe(false);
    expect(quote(DEFAULT_PRICING_CONFIG, input({ practiceType: "school" as never })).ok).toBe(false);
  });
});

describe("validatePricingConfig", () => {
  /** A copy of the defaults with one thing wrong, as plain data. */
  function broken(change: (config: Record<string, unknown> & { perSeatByCountCents: unknown[]; seats: Record<string, unknown> }) => void) {
    const config = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
    change(config);
    return validatePricingConfig(config);
  }

  function fieldsOf(result: ReturnType<typeof validatePricingConfig>) {
    return result.ok ? [] : result.errors.map((error) => error.field);
  }

  it("refuses anything that is not an object", () => {
    expect(validatePricingConfig(null).ok).toBe(false);
    expect(validatePricingConfig("59").ok).toBe(false);
    expect(validatePricingConfig([]).ok).toBe(false);
  });

  it("needs one ladder price per number of categories", () => {
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents = [5900, 8900])))).toEqual(["perSeatByCountCents"]);
    expect(fieldsOf(broken((c) => delete (c as Record<string, unknown>).perSeatByCountCents))).toEqual(["perSeatByCountCents"]);
  });

  it("needs each ladder price to be finite whole cents from zero up to the bound", () => {
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents[1] = -1)))).toEqual(["perSeatByCountCents.1"]);
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents[1] = 89.5)))).toEqual(["perSeatByCountCents.1"]);
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents[1] = "8900")))).toEqual(["perSeatByCountCents.1"]);
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents[1] = Number.POSITIVE_INFINITY)))).toEqual(["perSeatByCountCents.1"]);
    expect(fieldsOf(broken((c) => (c.perSeatByCountCents[1] = 5_000_001)))).toEqual(["perSeatByCountCents.1"]);
    expect(broken((c) => (c.perSeatByCountCents[0] = 0)).ok).toBe(true);
  });

  it("needs the full-library count to be from 2 to 6, or none", () => {
    expect(fieldsOf(broken((c) => (c.fullLibraryFrom = 1)))).toEqual(["fullLibraryFrom"]);
    expect(fieldsOf(broken((c) => (c.fullLibraryFrom = 7)))).toEqual(["fullLibraryFrom"]);
    expect(fieldsOf(broken((c) => (c.fullLibraryFrom = "5")))).toEqual(["fullLibraryFrom"]);
    expect(broken((c) => (c.fullLibraryFrom = null)).ok).toBe(true);
    expect(broken((c) => (c.fullLibraryFrom = 6)).ok).toBe(true);
  });

  it("bounds the yearly months and the founding offer", () => {
    expect(fieldsOf(broken((c) => (c.yearlyMonths = 0)))).toEqual(["yearlyMonths"]);
    expect(fieldsOf(broken((c) => (c.yearlyMonths = 13)))).toEqual(["yearlyMonths"]);
    expect(fieldsOf(broken((c) => (c.foundingDiscountBp = 10_001)))).toEqual(["foundingDiscountBp"]);
    expect(fieldsOf(broken((c) => (c.foundingDiscountBp = -1)))).toEqual(["foundingDiscountBp"]);
  });

  it("needs the seat limits to be whole numbers, Clinic at or above Solo", () => {
    expect(fieldsOf(broken((c) => (c.seats.soloMax = 0)))).toEqual(["seats.soloMax"]);
    expect(fieldsOf(broken((c) => (c.seats.clinicMax = 1001)))).toEqual(["seats.clinicMax"]);
    expect(fieldsOf(broken((c) => ((c.seats.soloMax = 5), (c.seats.clinicMax = 4))))).toEqual(["seats.clinicMax"]);
    expect(fieldsOf(broken((c) => delete c.seats.clinicMax))).toEqual(["seats.clinicMax"]);
  });

  it("only takes USD", () => {
    expect(fieldsOf(broken((c) => (c.currency = "eur")))).toEqual(["currency"]);
  });

  it("reports every problem at once", () => {
    const result = broken((c) => {
      c.currency = "gbp";
      c.yearlyMonths = 20;
      c.perSeatByCountCents[0] = -5;
    });
    expect(fieldsOf(result).sort()).toEqual(["currency", "perSeatByCountCents.0", "yearlyMonths"]);
  });
});

describe("reading and writing the numbers", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(5900)).toBe("$59.00");
    expect(formatCents(8010)).toBe("$80.10");
    expect(formatCents(139000)).toBe("$1,390.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-2903)).toBe("-$29.03");
  });

  it("formats basis points as a percentage without trailing zeros", () => {
    expect(formatBp(0)).toBe("0%");
    expect(formatBp(1250)).toBe("12.5%");
    expect(formatBp(1000)).toBe("10%");
    expect(formatBp(4703)).toBe("47.03%");
    expect(formatBp(10_000)).toBe("100%");
  });

  it("turns a config's numbers into the text an input box shows, and back, exactly", () => {
    expect(centsToDollarsText(5900)).toBe("59.00");
    expect(centsToDollarsText(29)).toBe("0.29");
    expect(parseDollarsToCents(centsToDollarsText(123456))).toBe(123456);
    expect(bpToPercentText(1250)).toBe("12.5");
    expect(parsePercentToBp(bpToPercentText(4703))).toBe(4703);
  });

  it("reads dollar amounts as typed, with no floating point", () => {
    expect(parseDollarsToCents("59")).toBe(5900);
    expect(parseDollarsToCents("59.5")).toBe(5950);
    expect(parseDollarsToCents("0.29")).toBe(29);
    expect(parseDollarsToCents("$1,234.56")).toBe(123456);
    expect(parseDollarsToCents(" 59.00 ")).toBe(5900);
    expect(parseDollarsToCents("59.999")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });

  it("reads percentages as typed, to two decimals", () => {
    expect(parsePercentToBp("12.5")).toBe(1250);
    expect(parsePercentToBp("12.50")).toBe(1250);
    expect(parsePercentToBp("0")).toBe(0);
    expect(parsePercentToBp("100%")).toBe(10_000);
    expect(parsePercentToBp("12.505")).toBeNull();
    expect(parsePercentToBp("twelve")).toBeNull();
  });
});
