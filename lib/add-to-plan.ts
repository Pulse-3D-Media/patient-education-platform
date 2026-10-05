import type { Category } from "@prisma/client";
import { CATEGORIES, type CategoryAvailability, type CategoryConfig } from "./categories";

/**
 * "Add to your plan": the one small link from a category the clinic does not
 * have, in the library, to the Billing page with that category already
 * ticked. Pure, no database, safe for the browser.
 *
 * NOTHING HERE DECIDES ANYTHING ABOUT MONEY OR ACCESS. The link only carries
 * a suggestion in the address (/admin/billing?add=hip). The Billing page
 * reads it as a hint for which box to tick; the price is worked out by the
 * server as always, nothing is charged until the admin reviews and confirms,
 * and the category stays locked in the library until Stripe says the change
 * is paid. A forged or unknown suggestion is simply ignored.
 */

/** The name of the suggestion in the Billing page's address. */
export const ADD_PARAM = "add";

/** The id of the part of the Billing page the link lands on (the plan picker, the change form, or the words that stand in for them). */
export const ADD_ANCHOR = "change";

/** The Billing page's address with one category suggested, by its slug ("hip", "foot-ankle"). */
export function addToPlanHref(slug: string): string {
  return `/admin/billing?${ADD_PARAM}=${encodeURIComponent(slug)}#${ADD_ANCHOR}`;
}

/**
 * What the library shows beside a category that is not on the clinic's plan:
 *
 *   "link"  an office admin, and the category is for sale: "Add to your plan"
 *   "ask"   a member, and the category is for sale: told to ask an office admin, no link
 *   "none"  the category is not for sale, so there is nothing to add: the plain "Not on your plan"
 */
export type AddToPlanOffer = "link" | "ask" | "none";

/** `config` is the category's row from getCategoryConfigs(); a category with no row is for sale, the same default the table has. */
export function addToPlanOffer(isAdmin: boolean, config: CategoryConfig | undefined): AddToPlanOffer {
  if (config && !config.sellable) return "none";
  return isAdmin ? "link" : "ask";
}

/**
 * The category the Billing page should open with an extra tick on, or null.
 *
 * `raw` is whatever came in the address, so it is untrusted: anything that
 * is not exactly one known category's slug is ignored. So is a category that
 * cannot be bought right now, and one the clinic already has (there is
 * nothing to add). Ticking the box is all this ever leads to.
 */
export function readSuggestedCategory(
  raw: unknown,
  options: { value: Category; availability: CategoryAvailability }[],
  alreadyHas: Category[],
): Category | null {
  if (typeof raw !== "string") return null;
  const category = CATEGORIES.find((entry) => entry.slug === raw);
  if (!category) return null;
  if (alreadyHas.includes(category.value)) return null;
  const option = options.find((entry) => entry.value === category.value);
  return option?.availability === "sellable" ? category.value : null;
}
