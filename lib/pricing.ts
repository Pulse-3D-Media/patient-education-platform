import type { Category } from "@prisma/client";
import { CATEGORIES } from "./categories";

/**
 * The pricing engine: what a clinic pays, worked out from a saved set of
 * prices (a "pricing config") and what the clinic has chosen.
 *
 * This file is pure and safe for the browser. It touches no database and
 * imports nothing from lib/db, so the calculator on /pulse/pricing can quote
 * live from unsaved numbers, and the server can run the very same code when
 * it comes to charging a card (prompt 11). Every amount is a whole number of
 * cents and every percentage is a whole number of basis points (hundredths
 * of a percent: 24.6% is 2460), so nothing here ever does floating-point
 * money arithmetic.
 *
 * THE PRICING MODEL, as decided (see lib/pricing.test.ts for the record):
 *
 *   Each category has its own monthly price per surgeon seat. A clinic is
 *   charged the sum of the categories it takes, less a discount that depends
 *   on how many categories that is, times its number of surgeon seats.
 *   Yearly billing charges a set number of months for the year. Office
 *   staff are never charged.
 *
 * The full library: when a config names a "full library from" count and a
 * clinic takes at least that many categories, it is charged for that many
 * and gets every category. The full library has one price, whichever
 * categories were ticked: it is priced as the N dearest categories, so
 * nobody gets the dear ones free by ticking the cheap ones. It is only
 * offered while every category is for sale; until then a clinic taking N
 * categories pays for N and gets those N, and the quote says so.
 *
 * THE ONE ROUNDING: the billable amount for one seat for the interval
 * (month or year) is rounded to the cent exactly once, after both discounts,
 * and the total is that times the number of seats. Stripe will be given the
 * same per-seat amount as the unit price and the seats as the quantity, so
 * what the calculator shows and what the card is charged cannot differ.
 * The "monthly equivalent" of a yearly price is for display only and is
 * never charged.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The six categories, in the order the library shows them. */
export const CATEGORY_VALUES: Category[] = CATEGORIES.map((c) => c.value);

/** How many categories there are. The discount table has one entry per count. */
export const CATEGORY_COUNT = CATEGORY_VALUES.length;

export type Interval = "month" | "year";

/** A hospital is always Enterprise, whatever its size. Never guessed from a name: it is a question asked. */
export type PracticeType = "clinic" | "hospital";

/** Which offer a clinic falls under. Enterprise has no self-serve amount. */
export type Band = "solo" | "clinic" | "enterprise";

/** A saved set of prices. Stored as JSON in PricingVersion.config, validated on the way in and out. */
export type PricingConfig = {
  currency: "usd";
  /** Monthly price for one surgeon seat, per category, in whole cents. */
  perSeatCents: Record<Category, number>;
  /**
   * Discount by how many categories are charged, in basis points. The first
   * entry is for one category, the second for two, and so on: one entry per
   * category. 2460 means 24.6% off.
   */
  countDiscountBp: number[];
  /** Taking this many categories buys the full library. Null means there is no full-library offer. */
  fullLibraryFrom: number | null;
  /** A year is charged as this many months. 10 means two months free. */
  yearlyMonths: number;
  /** The founding offer, in basis points off the total. 0 means no offer, which is the default. */
  foundingDiscountBp: number;
  /** Where Solo ends and where self-serve ends. A clinic with more surgeon seats than clinicMax is Enterprise. */
  seats: { soloMax: number; clinicMax: number };
};

/** What the calculator, and later checkout, asks for. */
export type QuoteInput = {
  /** Surgeon seats. A whole number, at least 1. Office staff are not seats. */
  seats: number;
  /** The categories ticked. A category ticked twice counts once. */
  categories: Category[];
  interval: Interval;
  /** Model the founding offer. On the calculator this is a what-if, not a promise to a customer. */
  founding: boolean;
  practiceType: PracticeType;
  /** The categories that may be bought right now (listSellableCategories() in lib/db/category-config.ts). */
  sellable: Category[];
};

/** One line of the receipt: a per-seat amount for the interval, in cents. Every line is exact. */
export type QuoteLine = { label: string; cents: number };

/** The money side of a quote. Absent for Enterprise. */
export type QuoteAmounts = {
  currency: "usd";
  interval: Interval;
  seats: number;
  /** One line per charged category, or one "Full library" line. Per seat, for the interval, before discounts. */
  lines: QuoteLine[];
  /** The sum of the lines: what one seat lists at for the interval. */
  perSeatListCents: number;
  /** The discount applied for the number of categories charged. */
  countDiscountBp: number;
  /** The founding discount applied. 0 unless the quote asked for it. */
  foundingDiscountBp: number;
  /**
   * What one seat is charged for the interval after both discounts, rounded
   * to the cent once. This is the number Stripe will be given as the unit
   * price. Everything else on the receipt is derived from it.
   */
  perSeatCents: number;
  /** perSeatCents times seats: the amount charged for the interval. */
  totalCents: number;
  /** What the discounts took off across all seats. */
  savingsCents: number;
  /** For a yearly quote, the total spread over twelve months, for display only. Never charged. Null for monthly. */
  monthlyEquivalentCents: number | null;
};

export type Quote = {
  band: Band;
  practiceType: PracticeType;
  /** The categories ticked, duplicates removed, in library order. */
  selectedCategories: Category[];
  /** The categories the price is made from. Empty for Enterprise. */
  chargedCategories: Category[];
  /** The categories the clinic would get. Every category when the full library is bought. Empty for Enterprise. */
  entitledCategories: Category[];
  /** True when the selection bought the full library. */
  fullLibrary: boolean;
  /** Plain sentences the calculator shows beside the amounts. */
  notes: string[];
  /** Null for Enterprise, which has no self-serve amount. */
  amounts: QuoteAmounts | null;
};

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: string };

/** One thing wrong with a config, and which field it is about (a path such as "perSeatCents.KNEE"). */
export type FieldError = { field: string; message: string };

export type ValidationResult = { ok: true; config: PricingConfig } | { ok: false; errors: FieldError[] };

// ---------------------------------------------------------------------------
// Limits. They bound the arithmetic as well as the business: with prices
// under MAX_PRICE_CENTS, at most CATEGORY_COUNT categories, at most
// MAX_YEARLY_MONTHS months and two discounts in basis points, the biggest
// number multiplied below stays under 2^53, where JavaScript's whole-number
// arithmetic is exact.
// ---------------------------------------------------------------------------

/** $5,000 per category per seat per month. Far above any real price; it is an arithmetic bound. */
export const MAX_PRICE_CENTS = 500_000;
/** 100%. */
export const MAX_BP = 10_000;
export const MAX_YEARLY_MONTHS = 12;
/** The most seats a self-serve boundary can be set to. */
export const MAX_SEAT_BOUNDARY = 1_000;
/** The most seats a quote will be worked out for. Anything above clinicMax is Enterprise long before this. */
export const MAX_QUOTE_SEATS = 10_000;

// ---------------------------------------------------------------------------
// The built-in defaults: an estimate for an installation that has not saved
// a pricing version yet. They are placeholders to edit on /pulse/pricing,
// never a price anyone has agreed to, and checkout will refuse to use them
// (it needs a saved, active version).
//
// $59 per category per seat with these count discounts gives, per seat per
// month: $59.00, $88.97, $109.03, $125.08, $138.95 for one to five
// categories, and the full library from five. Those are the exact cents the
// proposal page rounded to $59 / $89 / $109 / $125 / $139.
// ---------------------------------------------------------------------------

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: "usd",
  perSeatCents: {
    SPINE: 5900,
    COMPLEX_SPINE: 5900,
    KNEE: 5900,
    SHOULDER: 5900,
    HIP: 5900,
    FOOT_ANKLE: 5900,
  },
  countDiscountBp: [0, 2460, 3840, 4700, 5290, 5290],
  fullLibraryFrom: 5,
  yearlyMonths: 10,
  foundingDiscountBp: 0,
  seats: { soloMax: 1, clinicMax: 10 },
};

// ---------------------------------------------------------------------------
// Validation. Anything that is going to be saved, or that came out of the
// database, goes through this first. It checks shape, completeness and
// bounds, and reports every problem it finds, not just the first.
// ---------------------------------------------------------------------------

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check a would-be config and return it typed, or the list of what is wrong.
 * Unknown categories, missing categories, non-whole or out-of-range numbers,
 * a currency other than USD and a full-library count outside 2 to
 * CATEGORY_COUNT are all refused.
 */
export function validatePricingConfig(value: unknown): ValidationResult {
  const errors: FieldError[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ field: "config", message: "The config must be an object." }] };
  }

  if (value.currency !== "usd") {
    errors.push({ field: "currency", message: "Only USD is supported." });
  }

  // Prices: exactly the six categories, each a whole number of cents from 0 up to the bound.
  const perSeatCents = {} as Record<Category, number>;
  if (!isPlainObject(value.perSeatCents)) {
    errors.push({ field: "perSeatCents", message: "Every category needs a price." });
  } else {
    for (const category of CATEGORY_VALUES) {
      const cents = value.perSeatCents[category];
      if (!isWholeNumber(cents) || cents < 0 || cents > MAX_PRICE_CENTS) {
        errors.push({
          field: `perSeatCents.${category}`,
          message: `A whole number of cents from 0 to ${MAX_PRICE_CENTS.toLocaleString("en-US")}.`,
        });
      } else {
        perSeatCents[category] = cents;
      }
    }
    for (const key of Object.keys(value.perSeatCents)) {
      if (!(CATEGORY_VALUES as string[]).includes(key)) {
        errors.push({ field: `perSeatCents.${key}`, message: "Not one of our categories." });
      }
    }
  }

  // Count discounts: one entry per possible count, each 0 to 100%.
  const countDiscountBp: number[] = [];
  if (!Array.isArray(value.countDiscountBp) || value.countDiscountBp.length !== CATEGORY_COUNT) {
    errors.push({ field: "countDiscountBp", message: `Needs exactly ${CATEGORY_COUNT} entries, one per number of categories.` });
  } else {
    value.countDiscountBp.forEach((bp, index) => {
      if (!isWholeNumber(bp) || bp < 0 || bp > MAX_BP) {
        errors.push({ field: `countDiscountBp.${index}`, message: "A percentage from 0 to 100, with up to two decimals." });
      } else {
        countDiscountBp[index] = bp;
      }
    });
  }

  // Full library: null, or a count from 2 up to every category.
  let fullLibraryFrom: number | null = null;
  if (value.fullLibraryFrom !== null) {
    if (!isWholeNumber(value.fullLibraryFrom) || value.fullLibraryFrom < 2 || value.fullLibraryFrom > CATEGORY_COUNT) {
      errors.push({ field: "fullLibraryFrom", message: `A count from 2 to ${CATEGORY_COUNT}, or none.` });
    } else {
      fullLibraryFrom = value.fullLibraryFrom;
    }
  }

  if (!isWholeNumber(value.yearlyMonths) || value.yearlyMonths < 1 || value.yearlyMonths > MAX_YEARLY_MONTHS) {
    errors.push({ field: "yearlyMonths", message: `A whole number of months from 1 to ${MAX_YEARLY_MONTHS}.` });
  }

  if (!isWholeNumber(value.foundingDiscountBp) || value.foundingDiscountBp < 0 || value.foundingDiscountBp > MAX_BP) {
    errors.push({ field: "foundingDiscountBp", message: "A percentage from 0 to 100, with up to two decimals." });
  }

  let soloMax = 0;
  let clinicMax = 0;
  if (!isPlainObject(value.seats)) {
    errors.push({ field: "seats", message: "The Solo and Clinic seat limits are needed." });
  } else {
    if (!isWholeNumber(value.seats.soloMax) || value.seats.soloMax < 1 || value.seats.soloMax > MAX_SEAT_BOUNDARY) {
      errors.push({ field: "seats.soloMax", message: `A whole number from 1 to ${MAX_SEAT_BOUNDARY.toLocaleString("en-US")}.` });
    } else {
      soloMax = value.seats.soloMax;
    }
    if (!isWholeNumber(value.seats.clinicMax) || value.seats.clinicMax < 1 || value.seats.clinicMax > MAX_SEAT_BOUNDARY) {
      errors.push({ field: "seats.clinicMax", message: `A whole number from 1 to ${MAX_SEAT_BOUNDARY.toLocaleString("en-US")}.` });
    } else {
      clinicMax = value.seats.clinicMax;
    }
    if (soloMax > 0 && clinicMax > 0 && clinicMax < soloMax) {
      errors.push({ field: "seats.clinicMax", message: "The Clinic limit cannot be below the Solo limit." });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    config: {
      currency: "usd",
      perSeatCents,
      countDiscountBp,
      fullLibraryFrom,
      yearlyMonths: value.yearlyMonths as number,
      foundingDiscountBp: value.foundingDiscountBp as number,
      seats: { soloMax, clinicMax },
    },
  };
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

/**
 * numerator divided by denominator, rounded half up to a whole number.
 * Exact for whole numbers below 2^53, which the limits above guarantee.
 */
function roundedDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator / 2) / denominator);
}

/** The categories given, each once, in library order. Unknown values are dropped (the caller has already refused them). */
function inLibraryOrder(categories: Category[]): Category[] {
  const wanted = new Set(categories);
  return CATEGORY_VALUES.filter((category) => wanted.has(category));
}

/** The label a category shows on a receipt: "Knee", "Foot & Ankle". */
export function categoryLabel(category: Category): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

/** Solo, Clinic or Enterprise, from the practice type and the number of seats. */
export function bandFor(config: PricingConfig, seats: number, practiceType: PracticeType): Band {
  if (practiceType === "hospital") return "enterprise";
  if (seats > config.seats.clinicMax) return "enterprise";
  if (seats <= config.seats.soloMax) return "solo";
  return "clinic";
}

/**
 * Is the full library on offer right now? Only when the config has a
 * full-library count and every category is for sale. An incomplete library
 * is never sold as the full one.
 */
export function fullLibraryOffered(config: PricingConfig, sellable: Category[]): boolean {
  if (config.fullLibraryFrom === null) return false;
  return CATEGORY_VALUES.every((category) => sellable.includes(category));
}

/**
 * The categories the full library is priced as: the N dearest, N being the
 * full-library count. Ties keep library order. One price, whatever was
 * ticked.
 */
function fullLibraryChargedCategories(config: PricingConfig): Category[] {
  const count = config.fullLibraryFrom ?? CATEGORY_COUNT;
  return [...CATEGORY_VALUES]
    .sort((a, b) => config.perSeatCents[b] - config.perSeatCents[a])
    .slice(0, count)
    .sort((a, b) => CATEGORY_VALUES.indexOf(a) - CATEGORY_VALUES.indexOf(b));
}

/**
 * Work out what a clinic would pay. Pure: the same input always gives the
 * same quote. Returns an error for input that cannot be quoted (no
 * categories, a category that is not ours or not for sale, seats that are
 * not a whole number from 1 up). Enterprise is not an error: it is a quote
 * with no amounts.
 */
export function quote(config: PricingConfig, input: QuoteInput): QuoteResult {
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > MAX_QUOTE_SEATS) {
    return { ok: false, error: `Seats must be a whole number from 1 to ${MAX_QUOTE_SEATS.toLocaleString("en-US")}.` };
  }
  if (input.interval !== "month" && input.interval !== "year") {
    return { ok: false, error: "The interval must be month or year." };
  }
  if (input.practiceType !== "clinic" && input.practiceType !== "hospital") {
    return { ok: false, error: "The practice type must be clinic or hospital." };
  }

  const unknown = input.categories.filter((category) => !(CATEGORY_VALUES as string[]).includes(category));
  if (unknown.length > 0) {
    return { ok: false, error: `Not one of our categories: ${unknown.join(", ")}.` };
  }
  const selected = inLibraryOrder(input.categories);
  if (selected.length === 0) {
    return { ok: false, error: "Choose at least one category." };
  }
  const notForSale = selected.filter((category) => !input.sellable.includes(category));
  if (notForSale.length > 0) {
    return { ok: false, error: `Not for sale right now: ${notForSale.map(categoryLabel).join(", ")}.` };
  }

  const band = bandFor(config, input.seats, input.practiceType);
  if (band === "enterprise") {
    return {
      ok: true,
      quote: {
        band,
        practiceType: input.practiceType,
        selectedCategories: selected,
        chargedCategories: [],
        entitledCategories: [],
        fullLibrary: false,
        notes: [
          input.practiceType === "hospital"
            ? "Hospitals are priced by agreement with Pulse 3D."
            : `More than ${config.seats.clinicMax} surgeon seats is priced by agreement with Pulse 3D.`,
        ],
        amounts: null,
      },
    };
  }

  // Which categories the price is made from, and which the clinic gets.
  const notes: string[] = [];
  const wantsFullLibrary = config.fullLibraryFrom !== null && selected.length >= config.fullLibraryFrom;
  const fullLibrary = wantsFullLibrary && fullLibraryOffered(config, input.sellable);
  let charged: Category[];
  let entitled: Category[];
  if (fullLibrary) {
    charged = fullLibraryChargedCategories(config);
    entitled = [...CATEGORY_VALUES];
    notes.push(`The full library: every category, priced as ${charged.length}.`);
  } else {
    charged = selected;
    entitled = selected;
    if (wantsFullLibrary) {
      notes.push(
        `The full library is not offered until every category is for sale, so this is ${selected.length} ${
          selected.length === 1 ? "category" : "categories"
        } charged and included, no more.`,
      );
    }
  }

  // The receipt lines: per seat, for the interval, before discounts. Exact.
  const months = input.interval === "year" ? config.yearlyMonths : 1;
  const lines: QuoteLine[] = fullLibrary
    ? [
        {
          label: `Full library (${charged.length} ${charged.length === 1 ? "category" : "categories"})`,
          cents: charged.reduce((sum, category) => sum + config.perSeatCents[category], 0) * months,
        },
      ]
    : charged.map((category) => ({ label: categoryLabel(category), cents: config.perSeatCents[category] * months }));
  const perSeatListCents = lines.reduce((sum, line) => sum + line.cents, 0);

  // Both discounts, then the one rounding.
  const countDiscountBp = config.countDiscountBp[charged.length - 1] ?? 0;
  const foundingDiscountBp = input.founding ? config.foundingDiscountBp : 0;
  const perSeatCents = roundedDivide(
    perSeatListCents * (MAX_BP - countDiscountBp) * (MAX_BP - foundingDiscountBp),
    MAX_BP * MAX_BP,
  );
  const totalCents = perSeatCents * input.seats;

  return {
    ok: true,
    quote: {
      band,
      practiceType: input.practiceType,
      selectedCategories: selected,
      chargedCategories: charged,
      entitledCategories: entitled,
      fullLibrary,
      notes,
      amounts: {
        currency: "usd",
        interval: input.interval,
        seats: input.seats,
        lines,
        perSeatListCents,
        countDiscountBp,
        foundingDiscountBp,
        perSeatCents,
        totalCents,
        savingsCents: (perSeatListCents - perSeatCents) * input.seats,
        monthlyEquivalentCents: input.interval === "year" ? roundedDivide(totalCents, 12) : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Reading and writing the numbers as people type them. Text in, whole
// numbers out, and back, with no floating point in between.
// ---------------------------------------------------------------------------

/** 5900 as "$59.00"; 138945 as "$1,389.45". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = Math.abs(cents) % 100;
  return `${sign}$${whole.toLocaleString("en-US")}.${String(part).padStart(2, "0")}`;
}

/** 2460 as "24.6%"; 5290 as "52.9%"; 0 as "0%"; 4703 as "47.03%". */
export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const part = bp % 100;
  if (part === 0) return `${whole}%`;
  const decimals = String(part).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${decimals}%`;
}

/** 5900 as "59.00", the form of a price in an input box. */
export function centsToDollarsText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** 2460 as "24.6", the form of a percentage in an input box. */
export function bpToPercentText(bp: number): string {
  return formatBp(bp).replace("%", "");
}

/**
 * "59", "59.00", "$1,234.5" as cents. Null when the text is not a dollar
 * amount with at most two decimals. Text, not floating point, so "0.29"
 * comes back as 29 and not 28.999999.
 */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  return dollars * 100 + cents;
}

/** "24.6", "24.60", "0" as basis points. Null when the text is not a percentage with at most two decimals. */
export function parsePercentToBp(text: string): number | null {
  const cleaned = text.trim().replace(/%$/, "");
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const part = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + part;
}
