import type { BillingInterval, Category } from "@prisma/client";
import { CATEGORY_VALUES, MAX_QUOTE_SEATS, type Interval } from "./pricing";

/**
 * The checkout rules that need no database and no Stripe, so the plan
 * picker in the browser, the Server Action and the tests all use the same
 * ones. Pure and safe for the browser (rule 8 in CLAUDE.md): it imports
 * nothing from lib/db and nothing from lib/stripe.
 *
 * What the browser sends when an admin presses "Continue to payment" is a
 * REQUEST, never a fact. It names what was picked (categories, seats, month
 * or year) and what the admin was LOOKING AT when they pressed the button
 * (which pricing version, what total). The server works the price out again
 * from its own numbers; the two "looking at" values are only ever compared
 * with the server's, so that an admin is never charged a total they did not
 * see. No amount the browser sends is ever charged.
 */

/** How long a Stripe checkout page stays payable. Also how long an identical request reuses the same attempt instead of making a second one. */
export const SESSION_MINUTES = 60;

/** Stop reusing an attempt this long before its checkout page expires, so nobody is handed a page with a minute left on it. */
export const REUSE_MARGIN_MINUTES = 10;

/** What an admin picked, checked. */
export type PlanSelection = {
  categories: Category[];
  seats: number;
  interval: BillingInterval;
  /** The pricing version the page was showing. Compared with the server's, never used to price anything. */
  seenVersionId: string;
  /** The total the page was showing, in cents. Compared with the server's, never charged. */
  seenTotalCents: number;
};

export type SelectionResult = { ok: true; selection: PlanSelection } | { ok: false; error: string };

/** "MONTH" as the pricing engine's "month". */
export function engineInterval(interval: BillingInterval): Interval {
  return interval === "YEAR" ? "year" : "month";
}

/**
 * Read the plan picker's form. Everything is refused rather than guessed
 * at: a category that is not ours, the same category twice, seats that are
 * not a whole number, an interval that is not MONTH or YEAR. Fields the
 * form does not have (a clinic id, an amount, a founding flag) are simply
 * never read, so adding them to a request changes nothing.
 */
export function readPlanSelection(formData: FormData): SelectionResult {
  const rawCategories = formData.getAll("categories").map((value) => String(value));
  if (rawCategories.length === 0) return { ok: false, error: "Choose at least one category." };
  if (rawCategories.length > CATEGORY_VALUES.length) return { ok: false, error: "That is more categories than there are." };
  const unknown = rawCategories.filter((value) => !(CATEGORY_VALUES as string[]).includes(value));
  if (unknown.length > 0) return { ok: false, error: "One of those is not a category we have." };
  if (new Set(rawCategories).size !== rawCategories.length) return { ok: false, error: "A category was sent twice." };
  // In library order, so the same picks always make the same plan.
  const categories = CATEGORY_VALUES.filter((category) => rawCategories.includes(category));

  const seatsText = String(formData.get("seats") ?? "").trim();
  if (!/^\d{1,5}$/.test(seatsText)) return { ok: false, error: "Surgeon seats must be a whole number." };
  const seats = Number(seatsText);
  if (seats < 1 || seats > MAX_QUOTE_SEATS) return { ok: false, error: "Surgeon seats must be at least 1." };

  const intervalText = String(formData.get("interval") ?? "");
  if (intervalText !== "MONTH" && intervalText !== "YEAR") return { ok: false, error: "Choose monthly or yearly." };

  const seenVersionId = String(formData.get("seenVersionId") ?? "");
  if (!/^[a-z0-9]{8,40}$/i.test(seenVersionId)) return { ok: false, error: "This page is out of date. Reload it and try again." };

  const seenTotalText = String(formData.get("seenTotalCents") ?? "");
  if (!/^\d{1,12}$/.test(seenTotalText)) return { ok: false, error: "This page is out of date. Reload it and try again." };

  return { ok: true, selection: { categories, seats, interval: intervalText, seenVersionId, seenTotalCents: Number(seenTotalText) } };
}

/** The parts of an accepted plan that make two requests "the same request". */
export type PlanShape = {
  pricingVersionId: string;
  categories: Category[];
  entitledCategories: Category[];
  surgeonSeats: number;
  interval: BillingInterval;
  perSeatCents: number;
  totalCents: number;
};

const sameSet = (a: Category[], b: Category[]) => a.length === b.length && a.every((category) => b.includes(category));

/** True when two plans are the same in everything that is charged for and everything that is included. */
export function samePlanShape(a: PlanShape, b: PlanShape): boolean {
  return (
    a.pricingVersionId === b.pricingVersionId &&
    a.surgeonSeats === b.surgeonSeats &&
    a.interval === b.interval &&
    a.perSeatCents === b.perSeatCents &&
    a.totalCents === b.totalCents &&
    sameSet(a.categories, b.categories) &&
    sameSet(a.entitledCategories, b.entitledCategories)
  );
}

/** When the checkout page made for an attempt stops being payable. Worked out from the attempt's own time, so asking twice gives the same answer. */
export function sessionExpiresAt(attemptCreatedAt: Date): Date {
  return new Date(attemptCreatedAt.getTime() + SESSION_MINUTES * 60_000);
}

/** How far "now" may read BEFORE an attempt's own time and the attempt still count as recent. */
export const CLOCK_SLACK_MINUTES = 5;

/**
 * May an attempt made at this time still be reused now? Only while its
 * checkout page has a comfortable amount of time left.
 *
 * An attempt can look as if it was made slightly in the FUTURE: two requests
 * a few milliseconds apart read the clock at different moments, and the
 * clock that stamps the row is not always the one that asks this question.
 * That is exactly the double-click case this rule exists for, so a small
 * negative age still counts as recent. (A double click that made two
 * attempts would make two payment pages.)
 */
export function attemptIsReusable(attemptCreatedAt: Date, now: Date): boolean {
  const age = now.getTime() - attemptCreatedAt.getTime();
  return age > -CLOCK_SLACK_MINUTES * 60_000 && age < (SESSION_MINUTES - REUSE_MARGIN_MINUTES) * 60_000;
}
