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
 * of a percent: 10% is 1000), so nothing here ever does floating-point
 * money arithmetic.
 *
 * THE PRICING MODEL, as decided (see lib/pricing.test.ts for the record):
 *
 *   A price ladder by number of categories. One monthly price per surgeon
 *   seat for one category, another for two, and so on, whichever
 *   categories they are. A clinic is charged the ladder price for the
 *   number of categories it takes, times its number of surgeon seats.
 *   Yearly billing charges a set number of months for the year. Office
 *   staff are never charged.
 *
 *   There are no per-category prices. A count-based price makes the
 *   identity of the categories irrelevant to the amount: Knee and Hip cost
 *   the same as Spine and Shoulder. If a category ever needs a price of its
 *   own, that is a second pricing mode to decide on before it is built.
 *
 * The full library: when a config names a "full library from" count and a
 * clinic takes at least that many categories, it is charged that count's
 * ladder price and gets every category. The full library is only offered
 * while every category is for sale; until then a clinic taking N
 * categories pays the N-category price and gets those N, and the quote
 * says so.
 *
 * THE ONE ROUNDING: the billable amount for one seat for the interval
 * (month or year) is rounded to the cent exactly once, after the founding
 * offer if there is one, and the total is that times the number of seats.
 * Stripe will be given the same per-seat amount as the unit price and the
 * seats as the quantity, so what the calculator shows and what the card is
 * charged cannot differ. The "monthly equivalent" of a yearly price is for
 * display only and is never charged.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The six categories, in the order the library shows them. */
export const CATEGORY_VALUES: Category[] = CATEGORIES.map((c) => c.value);

/** How many categories there are. The ladder has one price per count. */
export const CATEGORY_COUNT = CATEGORY_VALUES.length;

export type Interval = "month" | "year";

/** A hospital is always Enterprise, whatever its size. Never guessed from a name: it is a question asked. */
export type PracticeType = "clinic" | "hospital";

/** Which offer a clinic falls under. Enterprise has no self-serve amount. */
export type Band = "solo" | "clinic" | "enterprise";

/** A saved set of prices. Stored as JSON in PricingVersion.config, validated on the way in and out. */
export type PricingConfig = {
  currency: "usd";
  /**
   * The ladder: the monthly price for one surgeon seat by how many
   * categories are taken, in whole cents. The first entry is for one
   * category, the second for two, and so on, one entry per category.
   */
  perSeatByCountCents: number[];
  /** Taking this many categories buys the full library at that count's price. Null means there is no full-library offer. */
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
  /** One line: the categories taken (or the full library) at the ladder price. Per seat, for the interval, before the founding offer. */
  lines: QuoteLine[];
  /** The sum of the lines: what one seat lists at for the interval. */
  perSeatListCents: number;
  /** The founding discount applied. 0 unless the quote asked for it. */
  foundingDiscountBp: number;
  /**
   * What one seat is charged for the interval after the founding offer,
   * rounded to the cent once. This is the number Stripe will be given as
   * the unit price. Everything else on the receipt is derived from it.
   */
  perSeatCents: number;
  /** perSeatCents times seats: the amount charged for the interval. */
  totalCents: number;
  /** What the founding offer took off across all seats. 0 without one. */
  savingsCents: number;
  /** For a yearly quote, the total spread over twelve months, for display only. Never charged. Null for monthly. */
  monthlyEquivalentCents: number | null;
};

export type Quote = {
  band: Band;
  practiceType: PracticeType;
  /** The categories ticked, duplicates removed, in library order. */
  selectedCategories: Category[];
  /** How many categories the ladder price is for. Capped at the full-library count when the full library is bought. */
  chargedCount: number;
  /** The categories that count is made of. Empty when the full library is bought (the count, not the categories, is what is charged) and for Enterprise. */
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

/** One thing wrong with a config, and which field it is about (a path such as "perSeatByCountCents.1"). */
export type FieldError = { field: string; message: string };

export type ValidationResult = { ok: true; config: PricingConfig } | { ok: false; errors: FieldError[] };

// ---------------------------------------------------------------------------
// Limits. They bound the arithmetic as well as the business: with ladder
// prices under MAX_PRICE_CENTS, at most MAX_YEARLY_MONTHS months and one
// discount in basis points, the biggest number multiplied below stays far
// under 2^53, where JavaScript's whole-number arithmetic is exact.
// ---------------------------------------------------------------------------

/** $50,000 per seat per month. Far above any real price; it is an arithmetic bound. */
export const MAX_PRICE_CENTS = 5_000_000;
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
// Per seat per month: $59, $89, $109, $125 and $139 for one to five
// categories, and the full library from five, exactly as the proposal page
// shows them. The sixth entry only matters if the full-library offer is
// turned off; it is set to the five-category price so six is never dearer.
// ---------------------------------------------------------------------------

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: "usd",
  perSeatByCountCents: [5900, 8900, 10900, 12500, 13900, 13900],
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
 * A ladder with the wrong number of entries, a price that is not a whole
 * number of cents from 0 up to the bound, a currency other than USD and a
 * full-library count outside 2 to CATEGORY_COUNT are all refused.
 */
export function validatePricingConfig(value: unknown): ValidationResult {
  const errors: FieldError[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ field: "config", message: "The config must be an object." }] };
  }

  if (value.currency !== "usd") {
    errors.push({ field: "currency", message: "Only USD is supported." });
  }

  // The ladder: one entry per possible count, each a whole number of cents from 0 up to the bound.
  const perSeatByCountCents: number[] = [];
  if (!Array.isArray(value.perSeatByCountCents) || value.perSeatByCountCents.length !== CATEGORY_COUNT) {
    errors.push({ field: "perSeatByCountCents", message: `Needs exactly ${CATEGORY_COUNT} prices, one per number of categories.` });
  } else {
    value.perSeatByCountCents.forEach((cents, index) => {
      if (!isWholeNumber(cents) || cents < 0 || cents > MAX_PRICE_CENTS) {
        errors.push({
          field: `perSeatByCountCents.${index}`,
          message: `A whole number of cents from 0 to ${MAX_PRICE_CENTS.toLocaleString("en-US")}.`,
        });
      } else {
        perSeatByCountCents[index] = cents;
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
      perSeatByCountCents,
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

/** "1 category" or "3 categories". */
function countWords(count: number) {
  return `${count} ${count === 1 ? "category" : "categories"}`;
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
        chargedCount: 0,
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

  // How many categories the ladder price is for, and which categories the
  // clinic gets. The full library caps the count and includes everything.
  const notes: string[] = [];
  const wantsFullLibrary = config.fullLibraryFrom !== null && selected.length >= config.fullLibraryFrom;
  const fullLibrary = wantsFullLibrary && fullLibraryOffered(config, input.sellable);
  const chargedCount = fullLibrary ? (config.fullLibraryFrom as number) : selected.length;
  const chargedCategories = fullLibrary ? [] : selected;
  const entitledCategories = fullLibrary ? [...CATEGORY_VALUES] : selected;
  if (fullLibrary) {
    notes.push(`The full library: every category, at the ${countWords(chargedCount)} price.`);
  } else if (wantsFullLibrary) {
    notes.push(
      `The full library is not offered until every category is for sale, so this is ${countWords(selected.length)} charged and included, no more.`,
    );
  }

  // The one receipt line: the ladder price for that count, per seat, for
  // the interval, before the founding offer. Exact.
  const months = input.interval === "year" ? config.yearlyMonths : 1;
  const ladderCents = config.perSeatByCountCents[chargedCount - 1];
  const lines: QuoteLine[] = [
    {
      label: fullLibrary
        ? `Full library (${countWords(chargedCount)})`
        : `${countWords(chargedCount)}: ${selected.map(categoryLabel).join(", ")}`,
      cents: ladderCents * months,
    },
  ];
  const perSeatListCents = lines.reduce((sum, line) => sum + line.cents, 0);

  // The founding offer, then the one rounding.
  const foundingDiscountBp = input.founding ? config.foundingDiscountBp : 0;
  const perSeatCents = roundedDivide(perSeatListCents * (MAX_BP - foundingDiscountBp), MAX_BP);
  const totalCents = perSeatCents * input.seats;

  return {
    ok: true,
    quote: {
      band,
      practiceType: input.practiceType,
      selectedCategories: selected,
      chargedCount,
      chargedCategories,
      entitledCategories,
      fullLibrary,
      notes,
      amounts: {
        currency: "usd",
        interval: input.interval,
        seats: input.seats,
        lines,
        perSeatListCents,
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

/** 5900 as "$59.00"; 138900 as "$1,389.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = Math.abs(cents) % 100;
  return `${sign}$${whole.toLocaleString("en-US")}.${String(part).padStart(2, "0")}`;
}

/** 1000 as "10%"; 1250 as "12.5%"; 0 as "0%"; 4703 as "47.03%". */
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

/** 1250 as "12.5", the form of a percentage in an input box. */
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

/** "12.5", "12.50", "0" as basis points. Null when the text is not a percentage with at most two decimals. */
export function parsePercentToBp(text: string): number | null {
  const cleaned = text.trim().replace(/%$/, "");
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const part = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + part;
}
