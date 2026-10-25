import { Category, Prisma } from "@prisma/client";
import { cache } from "react";
import {
  CATEGORY_DEFAULTS,
  categoryListFromRows,
  formerSlugsAfter,
  takenSlugs,
  type CategoryAvailability,
  type CategoryConfig,
  type CategoryDetails,
  type CategoryDetailsInput,
  type CategoryRow,
} from "../categories";
import { prisma } from "./client";

// The row's shape, the default sentence and comingSoonSentence() have no
// database in them, so they live in lib/categories.ts, where the category
// form in the browser can import them too. Passed along here so server code
// keeps one import.
export { DEFAULT_COMING_SOON, comingSoonSentence, type CategoryConfig, type CategoryDetails } from "../categories";

/**
 * The CategoryConfig table: one row per library category, saying whether the
 * category is for sale, what the library shows while it has nothing
 * published, and the details a person sees (name, web address, tile picture,
 * place in the list). An empty detail means the default in lib/categories.ts.
 *
 * Rows are created on first read with the defaults (for sale, no sentence of
 * its own, every detail empty), so nothing ever has to check whether a row
 * exists: a category nobody has touched behaves exactly like one saved with
 * the defaults.
 *
 * Videos belong to Pulse 3D, not to a clinic, so none of this takes a
 * clinicId (rule 1 only requires it for clinic-owned data).
 */

const ALL_CATEGORIES = Object.values(Category);

const ROW_FIELDS = {
  category: true,
  sellable: true,
  comingSoonText: true,
  label: true,
  slug: true,
  imageUrl: true,
  sortOrder: true,
  formerSlugs: true,
} as const;

/** Every row, creating any that is missing with the defaults first. One query when the rows exist; three on the first read. */
async function readRows(): Promise<CategoryRow[]> {
  let rows = await prisma.categoryConfig.findMany({ select: ROW_FIELDS });
  if (rows.length < ALL_CATEGORIES.length) {
    const have = new Set(rows.map((row) => row.category));
    await prisma.categoryConfig.createMany({
      data: ALL_CATEGORIES.filter((category) => !have.has(category)).map((category) => ({ category })),
      // Two first reads at the same moment: one insert wins, the other is skipped, neither fails.
      skipDuplicates: true,
    });
    rows = await prisma.categoryConfig.findMany({ select: ROW_FIELDS });
  }
  return rows;
}

/**
 * THE category list every screen draws from: each category's current label,
 * slug, tile image and place, its "for sale" switch and its coming-soon
 * sentence, in list order. The defaults in lib/categories.ts with the table
 * laid over them. Cached for the length of one request, so a page, its
 * layout and the pieces inside it read the table once. Client components get
 * it as props.
 */
export const getCategoryList = cache(async (): Promise<CategoryDetails[]> => categoryListFromRows(await readRows()));

/**
 * Every category's sale settings, keyed by category. Always has every
 * category in it. Read from the same cached list as getCategoryList().
 */
export async function getCategoryConfigs(): Promise<Record<Category, CategoryConfig>> {
  const configs = {} as Record<Category, CategoryConfig>;
  for (const entry of await getCategoryList()) {
    configs[entry.value] = { sellable: entry.sellable, comingSoonText: entry.comingSoonText };
  }
  return configs;
}

/** Why a details save was refused. The message is one plain sentence for Pulse staff. */
export class CategoryDetailsError extends Error {}

/**
 * Save one category's row: its sale settings and its details, creating the
 * row if it has never been read. Returns its sale settings as they now are. Callers
 * check the text first (readCategoryDetails() in lib/categories.ts); this
 * function checks what needs the other rows: that the web address is not one
 * another category has, or had. Throws a CategoryDetailsError when it is,
 * writing nothing.
 *
 * One transaction that locks every row first, so two staff members saving
 * at once go one after the other and cannot both take the same address. A
 * changed address keeps the one being left in formerSlugs, so a bookmark to
 * it still opens this category.
 */
export async function saveCategoryConfig(
  category: Category,
  config: CategoryConfig,
  details?: CategoryDetailsInput,
): Promise<CategoryConfig> {
  await readRows(); // makes sure every row exists, so the lock below covers all of them
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "category" FROM "CategoryConfig" FOR UPDATE`;
      const list = categoryListFromRows(await tx.categoryConfig.findMany({ select: ROW_FIELDS }));
      const before = list.find((entry) => entry.value === category);
      if (!before) throw new CategoryDetailsError("That is not one of our categories.");

      let detailFields = {};
      if (details) {
        const newSlug = details.slug ?? (CATEGORY_DEFAULTS.find((entry) => entry.value === category)?.slug as string);
        if (takenSlugs(list, category).has(newSlug)) {
          throw new CategoryDetailsError(`The web address "${newSlug}" belongs to another category. Choose another.`);
        }
        detailFields = {
          label: details.label,
          slug: details.slug,
          imageUrl: details.imageUrl,
          sortOrder: details.sortOrder,
          formerSlugs: formerSlugsAfter(category, before, newSlug),
        };
      }

      const row = await tx.categoryConfig.update({ where: { category }, data: { ...config, ...detailFields } });
      return { sellable: row.sellable, comingSoonText: row.comingSoonText };
    });
  } catch (error) {
    // The unique column on slug is the last word if anything got past the check above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CategoryDetailsError("That web address belongs to another category. Choose another.");
    }
    throw error;
  }
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
