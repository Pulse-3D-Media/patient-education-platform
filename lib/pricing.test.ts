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
 * Built: category prices with percentage discounts. That is the structure
 * Evan set on 2026-09-10 ("per category, per seat, each category has its
 * own price, count discounts optional on top"). The ladder on Van's
 * proposal page was derived from those numbers and rounded for display,
 * and Van has not approved the numbers themselves. So the fixtures below
 * are the exact cents the defaults produce ($88.97, not $89) and nothing
 * pretends otherwise.
 *
 * Still open, flagged on the pull request: Evan and Van confirming that the
 * actual totals, not the rounded ladder, are what customers will be
 * charged. If the exact ladder wins instead, the config becomes bundle
 * amounts per category count, and that change has to land before checkout
 * (prompt 11B), the first place a real customer is charged.
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
  // The exact cents. The proposal page shows these rounded to whole dollars.
  const expected: Record<number, number> = { 1: 5900, 2: 8897, 3: 10903, 4: 12508, 5: 13895 };

  for (const count of [1, 2, 3, 4, 5]) {
    it(`${count} ${count === 1 ? "category" : "categories"} is ${formatCents(expected[count])}`, () => {
      const { amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(count) });
      expect(amounts.perSeatCents).toBe(expected[count]);
      expect(amounts.totalCents).toBe(expected[count]);
      expect(amounts.currency).toBe("usd");
      expect(amounts.interval).toBe("month");
    });
  }

  it("five categories buys the full library: charged for five, entitled to all six", () => {
    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: firstCategories(5) });
    expect(q.fullLibrary).toBe(true);
    expect(q.chargedCategories).toHaveLength(5);
    expect(q.entitledCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.lines).toEqual([{ label: "Full library (5 categories)", cents: 5 * 5900 }]);
    expect(amounts.perSeatCents).toBe(13895);
  });

  it("all six categories is the full library too, at the five-category price, never a sixth charge", () => {
    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: CATEGORY_VALUES });
    expect(q.fullLibrary).toBe(true);
    expect(q.selectedCategories).toEqual(CATEGORY_VALUES);
    expect(q.chargedCategories).toHaveLength(5);
    expect(q.entitledCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.perSeatCents).toBe(13895);
    expect(amounts.perSeatCents).not.toBe(16673);
  });

  it("multiplies the rounded per-seat amount by the seats, never rounds a total", () => {
    const three = amountsFor(DEFAULT_PRICING_CONFIG, { seats: 3, categories: firstCategories(2) }).amounts;
    expect(three.perSeatCents).toBe(8897);
    expect(three.totalCents).toBe(3 * 8897);
    expect(three.savingsCents).toBe(3 * (11800 - 8897));

    const ten = amountsFor(DEFAULT_PRICING_CONFIG, { seats: 10, categories: firstCategories(5) }).amounts;
    expect(ten.totalCents).toBe(138950);
  });

  it("lists each charged category as its own exact line below the full library", () => {
    const { amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["HIP", "KNEE"] });
    expect(amounts.lines).toEqual([
      { label: "Knee", cents: 5900 },
      { label: "Hip", cents: 5900 },
    ]);
    expect(amounts.perSeatListCents).toBe(11800);
    expect(amounts.countDiscountBp).toBe(2460);
    expect(amounts.foundingDiscountBp).toBe(0);
    expect(amounts.monthlyEquivalentCents).toBeNull();
  });
});

describe("yearly billing", () => {
  it("charges the configured number of months, rounded once per seat", () => {
    const one = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year" }).amounts;
    expect(one.lines).toEqual([{ label: "Knee", cents: 59000 }]);
    expect(one.perSeatCents).toBe(59000);

    const two = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", categories: firstCategories(2) }).amounts;
    // 118000 cents listed, 24.6% off: 88972.0 exactly.
    expect(two.perSeatCents).toBe(88972);

    const twoThreeSeats = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", seats: 3, categories: firstCategories(2) }).amounts;
    expect(twoThreeSeats.totalCents).toBe(3 * 88972);
  });

  it("gives a monthly equivalent for display only, and it is not the charged amount", () => {
    const { amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { interval: "year", categories: firstCategories(2) });
    expect(amounts.monthlyEquivalentCents).toBe(7414); // 88972 / 12 = 7414.33
    expect(amounts.totalCents).toBe(88972);
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

  it("is applied exactly once, on top of the count discount, with one rounding", () => {
    const monthly = amountsFor(withFounding, { categories: firstCategories(2), founding: true }).amounts;
    // 11800 * 0.754 * 0.9 = 8007.48, so 8007. Not 8897 * 0.9 rounded twice, and not 10% off twice.
    expect(monthly.foundingDiscountBp).toBe(1000);
    expect(monthly.perSeatCents).toBe(8007);

    const yearly = amountsFor(withFounding, { categories: firstCategories(2), founding: true, interval: "year" }).amounts;
    // 118000 * 0.754 * 0.9 = 80074.8, so 80075: the year is charged once and the offer is taken once.
    expect(yearly.perSeatCents).toBe(80075);
  });

  it("is not applied when the quote does not ask for it", () => {
    const { amounts } = amountsFor(withFounding, { categories: firstCategories(2), founding: false });
    expect(amounts.foundingDiscountBp).toBe(0);
    expect(amounts.perSeatCents).toBe(8897);
  });
});

describe("what is selected, charged and entitled", () => {
  it("counts a category ticked twice once, so duplicates cannot alter a price", () => {
    const once = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["KNEE", "HIP"] });
    const twice = amountsFor(DEFAULT_PRICING_CONFIG, { categories: ["HIP", "KNEE", "KNEE", "HIP", "KNEE"] });
    expect(twice.quote.selectedCategories).toEqual(["KNEE", "HIP"]);
    expect(twice.quote.chargedCategories).toEqual(["KNEE", "HIP"]);
    expect(twice.amounts.perSeatCents).toBe(once.amounts.perSeatCents);
    expect(twice.amounts.perSeatCents).toBe(8897);
  });

  it("does not offer the full library while any category is not for sale", () => {
    const fiveForSale = CATEGORY_VALUES.filter((category) => category !== "FOOT_ANKLE");
    expect(fullLibraryOffered(DEFAULT_PRICING_CONFIG, fiveForSale)).toBe(false);

    const { quote: q, amounts } = amountsFor(DEFAULT_PRICING_CONFIG, { categories: fiveForSale, sellable: fiveForSale });
    expect(q.fullLibrary).toBe(false);
    expect(q.chargedCategories).toEqual(fiveForSale);
    expect(q.entitledCategories).toEqual(fiveForSale);
    expect(q.notes.join(" ")).toContain("not offered until every category is for sale");
    expect(amounts.lines).toHaveLength(5);
    expect(amounts.perSeatCents).toBe(13895);
  });

  it("refuses a category that is not for sale, by name", () => {
    const fiveForSale = CATEGORY_VALUES.filter((category) => category !== "FOOT_ANKLE");
    const result = quote(DEFAULT_PRICING_CONFIG, input({ categories: ["FOOT_ANKLE"], sellable: fiveForSale }));
    expect(result).toEqual({ ok: false, error: "Not for sale right now: Foot & Ankle." });
  });

  it("prices the full library as the dearest categories, whichever ones were ticked", () => {
    const kneeDearer: PricingConfig = {
      ...DEFAULT_PRICING_CONFIG,
      perSeatCents: { ...DEFAULT_PRICING_CONFIG.perSeatCents, KNEE: 9900 },
    };
    const cheapFive = CATEGORY_VALUES.filter((category) => category !== "KNEE");
    const cheap = amountsFor(kneeDearer, { categories: cheapFive });
    const all = amountsFor(kneeDearer, { categories: CATEGORY_VALUES });
    const dearFive = amountsFor(kneeDearer, { categories: ["KNEE", "SPINE", "COMPLEX_SPINE", "SHOULDER", "HIP"] });

    // 9900 + 4 * 5900 = 33500 listed, 52.9% off: 15778.5, so 15779. The same three ways.
    expect(cheap.quote.chargedCategories).toContain("KNEE");
    expect(cheap.amounts.perSeatListCents).toBe(33500);
    expect(cheap.amounts.perSeatCents).toBe(15779);
    expect(all.amounts.perSeatCents).toBe(15779);
    expect(dearFive.amounts.perSeatCents).toBe(15779);
  });

  it("charges every category when there is no full-library offer", () => {
    const noBundle: PricingConfig = { ...DEFAULT_PRICING_CONFIG, fullLibraryFrom: null };
    const { quote: q, amounts } = amountsFor(noBundle, { categories: CATEGORY_VALUES });
    expect(q.fullLibrary).toBe(false);
    expect(q.chargedCategories).toEqual(CATEGORY_VALUES);
    expect(amounts.lines).toHaveLength(6);
    expect(amounts.countDiscountBp).toBe(5290);
    expect(amounts.perSeatCents).toBe(16673); // 35400 * 0.471 = 16673.4
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
  function broken(change: (config: Record<string, unknown> & { perSeatCents: Record<string, unknown>; seats: Record<string, unknown> }) => void) {
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

  it("needs a price for every category and no others", () => {
    expect(fieldsOf(broken((c) => delete c.perSeatCents.HIP))).toEqual(["perSeatCents.HIP"]);
    expect(fieldsOf(broken((c) => (c.perSeatCents.HAND = 5900)))).toEqual(["perSeatCents.HAND"]);
  });

  it("needs prices to be finite whole cents from zero up to the bound", () => {
    expect(fieldsOf(broken((c) => (c.perSeatCents.KNEE = -1)))).toEqual(["perSeatCents.KNEE"]);
    expect(fieldsOf(broken((c) => (c.perSeatCents.KNEE = 59.5)))).toEqual(["perSeatCents.KNEE"]);
    expect(fieldsOf(broken((c) => (c.perSeatCents.KNEE = "5900")))).toEqual(["perSeatCents.KNEE"]);
    expect(fieldsOf(broken((c) => (c.perSeatCents.KNEE = Number.POSITIVE_INFINITY)))).toEqual(["perSeatCents.KNEE"]);
    expect(fieldsOf(broken((c) => (c.perSeatCents.KNEE = 500_001)))).toEqual(["perSeatCents.KNEE"]);
    expect(broken((c) => (c.perSeatCents.KNEE = 0)).ok).toBe(true);
  });

  it("needs one discount per category count, each from 0 to 100 percent", () => {
    expect(fieldsOf(broken((c) => (c.countDiscountBp = [0, 2460])))).toEqual(["countDiscountBp"]);
    expect(fieldsOf(broken((c) => ((c.countDiscountBp as number[])[1] = 10_001)))).toEqual(["countDiscountBp.1"]);
    expect(fieldsOf(broken((c) => ((c.countDiscountBp as number[])[1] = -5)))).toEqual(["countDiscountBp.1"]);
    expect(fieldsOf(broken((c) => ((c.countDiscountBp as number[])[1] = 24.6)))).toEqual(["countDiscountBp.1"]);
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
      delete c.perSeatCents.SPINE;
    });
    expect(fieldsOf(result).sort()).toEqual(["currency", "perSeatCents.SPINE", "yearlyMonths"]);
  });
});

describe("reading and writing the numbers", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(5900)).toBe("$59.00");
    expect(formatCents(8897)).toBe("$88.97");
    expect(formatCents(138950)).toBe("$1,389.50");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-2903)).toBe("-$29.03");
  });

  it("formats basis points as a percentage without trailing zeros", () => {
    expect(formatBp(0)).toBe("0%");
    expect(formatBp(2460)).toBe("24.6%");
    expect(formatBp(4700)).toBe("47%");
    expect(formatBp(4703)).toBe("47.03%");
    expect(formatBp(10_000)).toBe("100%");
  });

  it("turns a config's numbers into the text an input box shows, and back, exactly", () => {
    expect(centsToDollarsText(5900)).toBe("59.00");
    expect(centsToDollarsText(29)).toBe("0.29");
    expect(parseDollarsToCents(centsToDollarsText(123456))).toBe(123456);
    expect(bpToPercentText(2460)).toBe("24.6");
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
    expect(parsePercentToBp("24.6")).toBe(2460);
    expect(parsePercentToBp("24.60")).toBe(2460);
    expect(parsePercentToBp("0")).toBe(0);
    expect(parsePercentToBp("100%")).toBe(10_000);
    expect(parsePercentToBp("24.605")).toBeNull();
    expect(parsePercentToBp("twenty")).toBeNull();
  });
});
