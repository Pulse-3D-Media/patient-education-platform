/**
 * How `npm run db:set-plan` reads its --categories and --seats values. Pure:
 * no database, so the rules can be tested with plain values
 * (prisma/plan-args.test.ts).
 *
 * Both are strict on purpose, because a typo here changes what a clinic can
 * use and how many seats it has:
 * - An empty --categories value is refused, not read as "no categories".
 *   To take every category away, type the word `none`.
 * - --seats is plain digits only (the same rule as the Plan form on /pulse),
 *   so "0x10", "1e2" or "1.0", which JavaScript would happily turn into a
 *   number, are refused.
 */
import { unknownCategories, type Category } from "../lib/categories";

/** The largest number the seats column can hold (a PostgreSQL integer). */
export const MAX_PLAN_SEATS = 2_147_483_647;

export type ReadCategories = { ok: true; categories: Category[] } | { ok: false; reason: string };
export type ReadSeats = { ok: true; seats: number } | { ok: false; reason: string };

/** "all", "none" or "KNEE,HIP" (any capitals) into a list of known categories, or a plain refusal. */
export function readPlanCategories(value: string, known: Category[]): ReadCategories {
  const text = value.trim().toUpperCase();
  if (text === "ALL") return { ok: true, categories: known };
  if (text === "NONE") return { ok: true, categories: [] };

  const names = text.split(",").map((name) => name.trim());
  if (names.every((name) => name === "")) {
    return { ok: false, reason: 'No categories were given. To take every category away, write the word "none".' };
  }
  if (names.some((name) => name === "")) {
    return { ok: false, reason: `"${value}" has an empty entry in it. Write the keys separated by single commas, like KNEE,HIP.` };
  }
  if (names.includes("ALL") || names.includes("NONE")) {
    return { ok: false, reason: 'Write "all" or "none" on its own, not inside a list.' };
  }

  const unknown = unknownCategories(known.map((key) => ({ value: key })), names);
  if (unknown.length > 0) {
    return { ok: false, reason: `Not a category: ${unknown.join(", ")}. The categories are: ${known.join(", ")}.` };
  }
  return { ok: true, categories: names as Category[] };
}

/** A whole number of seats written as plain digits, 0 or more, or a plain refusal. */
export function readPlanSeats(value: string): ReadSeats {
  const text = value.trim();
  // [0-9] rather than \d, so no other alphabet's digits slip through, whatever flags the pattern gets later.
  if (!/^[0-9]+$/.test(text)) {
    return { ok: false, reason: `Seats must be a whole number written as plain digits, 0 or more. Got "${value}".` };
  }
  const seats = Number(text);
  if (!Number.isSafeInteger(seats) || seats > MAX_PLAN_SEATS) {
    return { ok: false, reason: `"${value}" is too many seats.` };
  }
  return { ok: true, seats };
}
