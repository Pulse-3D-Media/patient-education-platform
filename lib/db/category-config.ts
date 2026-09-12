import { Category } from "@prisma/client";
import type { CategoryAvailability } from "../categories";
import { prisma } from "./client";

/**
 * The CategoryConfig table: one row per library category, saying whether the
 * category is for sale and what the library shows while it has nothing
 * published.
 *
 * Rows are created on first read with the defaults (for sale, no sentence of
 * its own), so nothing ever has to check whether a row exists: a category
 * nobody has touched behaves exactly like one saved with the defaults.
 *
 * Videos belong to Pulse 3D, not to a clinic, so none of this takes a
 * clinicId (rule 1 only requires it for clinic-owned data).
 */

/** What one category's row says. */
export type CategoryConfig = {
  /** False takes the category off the price list. It still shows in the library. */
  sellable: boolean;
  /** The sentence on the library's "Coming soon" tile. Null means the default sentence. */
  comingSoonText: string | null;
};

/** What a category says while it has no published video and no sentence of its own. */
export const DEFAULT_COMING_SOON = "Animations for this category are in production and will appear here when they are released.";

const ALL_CATEGORIES = Object.values(Category);

/**
 * The sentence the library shows on a category's "Coming soon" tile: the
 * one staff wrote, or the default. Pure, so the library pages can call it
 * without another query.
 */
export function comingSoonSentence(config: CategoryConfig | undefined) {
  const text = config?.comingSoonText?.trim();
  return text ? text : DEFAULT_COMING_SOON;
}

/**
 * Every category's row, keyed by category. Creates any row that is missing
 * with the defaults first, so the result always has all six categories in
 * it. One query when the rows exist; two on the first read.
 */
export async function getCategoryConfigs(): Promise<Record<Category, CategoryConfig>> {
  let rows = await prisma.categoryConfig.findMany();

  if (rows.length < ALL_CATEGORIES.length) {
    const have = new Set(rows.map((row) => row.category));
    await prisma.categoryConfig.createMany({
      data: ALL_CATEGORIES.filter((category) => !have.has(category)).map((category) => ({ category })),
      // Two first reads at the same moment: one insert wins, the other is skipped, neither fails.
      skipDuplicates: true,
    });
    rows = await prisma.categoryConfig.findMany();
  }

  const configs = {} as Record<Category, CategoryConfig>;
  for (const row of rows) {
    configs[row.category] = { sellable: row.sellable, comingSoonText: row.comingSoonText };
  }
  return configs;
}

/**
 * Save one category's row, creating it if it has never been read. Returns
 * the row as it now is. Callers check the text first; this function trusts it.
 */
export async function saveCategoryConfig(category: Category, config: CategoryConfig): Promise<CategoryConfig> {
  const row = await prisma.categoryConfig.upsert({
    where: { category },
    create: { category, ...config },
    update: config,
  });
  return { sellable: row.sellable, comingSoonText: row.comingSoonText };
}

/**
 * Whether each category can be bought right now, and if not, why not:
 * "not-for-sale" when its switch is off, "coming-soon" when nothing is
 * published in it yet. This is what the labels on the clinic Plan form and
 * the calculator's category chips say. It is about NEW purchases only: a
 * category a clinic already has is never taken away by this.
 */
export async function getCategoryAvailability(): Promise<Record<Category, CategoryAvailability>> {
  const [configs, published] = await Promise.all([
    getCategoryConfigs(),
    prisma.video.groupBy({ by: ["category"], where: { isPublished: true }, _count: { _all: true } }),
  ]);
  const hasVideos = new Set(published.map((row) => row.category));

  const availability = {} as Record<Category, CategoryAvailability>;
  for (const category of ALL_CATEGORIES) {
    availability[category] = !configs[category].sellable ? "not-for-sale" : hasVideos.has(category) ? "sellable" : "coming-soon";
  }
  return availability;
}

/**
 * The categories that may be offered for sale: sellable is on, and at least
 * one video is published in it. This is the list billing and the plan
 * screens will offer; nothing sells a category that has nothing in it.
 */
export async function listSellableCategories(): Promise<Category[]> {
  const availability = await getCategoryAvailability();
  return ALL_CATEGORIES.filter((category) => availability[category] === "sellable");
}
