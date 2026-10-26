import { Prisma } from "@prisma/client";
import type { Category } from "../categories";
import { cache } from "react";
import {
  CATEGORY_DEFAULTS,
  categoryListFromRows,
  formerSlugsAfter,
  isStartingCategory,
  takenSlugs,
  type CategoryAvailability,
  type CategoryConfig,
  type CategoryDetails,
  type CategoryDetailsInput,
  type CategoryRow,
  type NewCategory,
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

/** The categories every installation starts with. Their rows are made on first read; rows for categories added later are made when they are added. */
const STARTING_CATEGORIES = CATEGORY_DEFAULTS.map((entry) => entry.value);

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
  const have = new Set(rows.map((row) => row.category));
  if (STARTING_CATEGORIES.some((category) => !have.has(category))) {
    await prisma.categoryConfig.createMany({
      data: STARTING_CATEGORIES.filter((category) => !have.has(category)).map((category) => ({ category })),
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
 * Why a category added on /pulse/videos cannot be switched on for sale yet: the
 * pricing engine prices a count of categories and treats five or more as the
 * full library of the six starting ones, and how an added category fits that is
 * a pricing decision Evan has not made (K3). Until it is, an added category is
 * never offered for sale; Pulse staff can still put it on a clinic's plan by hand.
 */
export const NOT_FOR_SALE_YET =
  "A category added here cannot be put on sale yet: how new categories are priced has not been decided. You can still add it to a clinic's plan by hand on its Plan tab.";

/**
 * Add a category (the "+" in the Categories panel). It starts NOT for sale,
 * and the library shows it as Coming soon until a video in it is published,
 * the same rule as any category (categoryState()). Checked first by
 * readNewCategory(); here, in one transaction that locks every row, the key
 * and the web address are checked again against the rows as they are now, so
 * two staff members adding at once cannot both take one. Nothing is ever
 * deleted: a category stays, at most off sale with nothing published in it.
 */
export async function addCategory(input: NewCategory): Promise<CategoryDetails> {
  await readRows();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "category" FROM "CategoryConfig" FOR UPDATE`;
      const list = categoryListFromRows(await tx.categoryConfig.findMany({ select: ROW_FIELDS }));
      if (list.some((entry) => entry.value === input.key || entry.label.toLowerCase() === input.label.toLowerCase())) {
        throw new CategoryDetailsError(`There is already a category called "${input.label}".`);
      }
      if (takenSlugs(list, input.key).has(input.slug)) {
        throw new CategoryDetailsError(`The web address "${input.slug}" belongs to another category. Choose another.`);
      }
      await tx.categoryConfig.create({
        data: { category: input.key, sellable: false, label: input.label, slug: input.slug, imageUrl: input.imageUrl, sortOrder: input.sortOrder },
      });
      const after = categoryListFromRows(await tx.categoryConfig.findMany({ select: ROW_FIELDS }));
      return after.find((entry) => entry.value === input.key) as CategoryDetails;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CategoryDetailsError("That category or web address was taken a moment ago. Check the list and try again.");
    }
    throw error;
  }
}

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
      if (config.sellable && !isStartingCategory(category)) throw new CategoryDetailsError(NOT_FOR_SALE_YET);

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
  for (const category of Object.keys(configs)) {
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
  const [availability, list] = await Promise.all([getCategoryAvailability(), getCategoryList()]);
  return list.map((entry) => entry.value).filter((category) => availability[category] === "sellable");
}

/** Why a category cannot be deleted. The message is one plain sentence for Pulse staff. */
export const CATEGORY_IN_USE =
  "This category is in use now (a video, a clinic's plan or an accepted plan), so it cannot be deleted. Switch it off sale and unpublish its videos instead.";

/** "Nothing uses this category": no video of any kind, no clinic's plan, no accepted plan. One SQL condition, used to list and to delete. */
const UNUSED = Prisma.sql`NOT EXISTS (SELECT 1 FROM "Video" v WHERE v."category" = c."category")
  AND NOT EXISTS (SELECT 1 FROM "Clinic" k WHERE k."categories" @> ARRAY[c."category"])
  AND NOT EXISTS (SELECT 1 FROM "BillingPlan" b WHERE b."categories" @> ARRAY[c."category"] OR b."entitledCategories" @> ARRAY[c."category"])`;

/**
 * The added categories (not one of the six starting ones) that nothing uses
 * yet: the ones the Categories panel offers a Delete for. A courtesy for the
 * page; deleteUnusedCategory() checks again.
 */
export async function listDeletableCategories(): Promise<Category[]> {
  const starting = CATEGORY_DEFAULTS.map((entry) => entry.value);
  const rows = await prisma.$queryRaw<{ category: string }[]>`
    SELECT c."category" FROM "CategoryConfig" c WHERE NOT (c."category" = ANY(${starting}::text[])) AND ${UNUSED}`;
  return rows.map((row) => row.category);
}

/**
 * Delete an added category that nothing uses (a mistake caught early, decided
 * by Evan on 2026-10-26). Never one of the six starting categories, and never
 * one with a video (published or not), on a clinic's plan, or in an accepted
 * plan: those must never disappear, so they are only ever taken off sale.
 *
 * One transaction that locks the category's row first. Adding a video in it
 * (its foreign key) and saving a clinic's plan with it (setClinicPlan() locks
 * the plan's category rows) both need that row too, so they either finished
 * before, and the check below sees them and refuses, or wait and then find
 * the category gone and refuse. Throws a CategoryDetailsError, deleting
 * nothing, when it may not be deleted.
 */
export async function deleteUnusedCategory(category: Category): Promise<void> {
  if (isStartingCategory(category)) throw new CategoryDetailsError("The six starting categories can never be deleted.");
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ category: string }[]>`SELECT "category" FROM "CategoryConfig" WHERE "category" = ${category} FOR UPDATE`;
    if (locked.length === 0) throw new CategoryDetailsError("That category no longer exists.");
    const unused = await tx.$queryRaw<{ category: string }[]>`SELECT c."category" FROM "CategoryConfig" c WHERE c."category" = ${category} AND ${UNUSED}`;
    if (unused.length === 0) throw new CategoryDetailsError(CATEGORY_IN_USE);
    await tx.categoryConfig.delete({ where: { category } });
  });
}
