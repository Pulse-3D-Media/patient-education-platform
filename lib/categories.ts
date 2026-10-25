import { parseLogoUrl } from "./branding";

/**
 * A category's key, the word every plan, video and link stores ("KNEE",
 * "FOOT_ANKLE"). Plain text since K2: the categories that exist are the rows
 * of the CategoryConfig table, so the compiler cannot know them in advance.
 * A value that came from a form, an address or a script is only used once
 * isKnownCategory() has checked it against that list.
 */
export type Category = string;

/**
 * The library categories AS THEY START: each one's default label, slug and
 * tile image, in the default order.
 *
 * The database stores a category as an enum value (KNEE, FOOT_ANKLE). This
 * file maps each one to the label a surgeon reads ("Knee", "Foot & Ankle"),
 * the slug in the URL (/library/knee, /library/foot-ankle) and a tile image.
 *
 * Pulse staff can change the label, the slug, the image and the order on
 * /pulse/videos (the Categories panel). Those changes live in the
 * CategoryConfig table, and an empty column there means the value here. So
 * no screen reads this list directly: pages ask the server for the full list
 * (getCategoryList() in lib/db/category-config.ts), which is this list with
 * the table's changes laid over it, and hand it to the browser as props.
 * What still reads this list directly is the fixed set of enum values and
 * their fixed order, which is how plans are stored (lib/pricing.ts,
 * lib/access.ts). Adding a category is one entry here plus the enum value in
 * the schema.
 *
 * Tile images are stills already published on pulse3dmedia.com, served from
 * its CDN. Nothing here is unreleased. Every address was checked to return
 * 200 before it was committed: a wrong asset id returns 403 and the tile
 * renders empty, so do not invent one.
 */

/** The heading the category navigation groups these under. */
export const CATEGORY_GROUP = "Orthopedic Surgery";

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/";

/** One category's starting details. */
export type CategoryDefault = { value: Category; label: string; slug: string; image: string };

export const CATEGORY_DEFAULTS: CategoryDefault[] = [
  {
    // The enum value stayed SPINE when the label became "Orthopedic Spine",
    // so no migration was needed. Nothing outside this app links to the old
    // /library/spine slug.
    value: "SPINE",
    label: "Orthopedic Spine",
    slug: "orthopedic-spine",
    image: CDN + "6949c3ca377bfce5f6c7fbe8_PCF_04_Cervical_Construct-p-1080.png",
  },
  {
    // Deformity and revision work: osteotomies, scoliosis correction, long
    // constructs. A permanent category that sits next to Orthopedic Spine.
    // Only the videos inside it are placeholders for now.
    value: "COMPLEX_SPINE",
    label: "Complex Spine",
    slug: "complex-spine",
    // A long posterior pedicle screw and rod construct (K2M NILE), from the
    // Still Images page on pulse3dmedia.com. That is the kind of construct a
    // deformity patient gets, and it is a different picture from the cervical
    // construct on the tile above. Checked 200 on 2026-09-05. The original is
    // 640x360 and Webflow made no resized (-p-800) copy of it, so this is the
    // only working address.
    image: CDN + "6949c4131995a0c298500b44_K2M_NILE_01.jpg",
  },
  {
    value: "KNEE",
    label: "Knee",
    slug: "knee",
    image: CDN + "6a7f89845d05b79e5a09997a_knee-animation-still-p-800.jpg",
  },
  {
    value: "SHOULDER",
    label: "Shoulder",
    slug: "shoulder",
    image: CDN + "6949c3bf2a16dcedecc57845_ICONIX_Shoulder_Final%20(00265)-p-1080.png",
  },
  {
    value: "HIP",
    label: "Hip",
    slug: "hip",
    image: CDN + "6949c4135d66415681632d15_Biomet%20g7_Hip_Implants-p-800.jpg",
  },
  {
    value: "FOOT_ANKLE",
    label: "Foot & Ankle",
    slug: "foot-ankle",
    image: CDN + "6a98cf3cac7f6fbb9d607b69_achilles-wide.jpg",
  },
];

/**
 * Whether a category can be bought right now, and if not, why not:
 * "not-for-sale" when its switch on /pulse/videos is off, "coming-soon"
 * when nothing is published in it yet. Worked out on the server by
 * getCategoryAvailability() in lib/db/category-config.ts; the type lives
 * here so the forms can name it without reaching into lib/db.
 */
export type CategoryAvailability = "sellable" | "not-for-sale" | "coming-soon";

/** The short label a form shows beside a category that cannot be bought right now, or null when it can. */
export function availabilityLabel(availability: CategoryAvailability): string | null {
  if (availability === "not-for-sale") return "Not for sale";
  if (availability === "coming-soon") return "Coming soon";
  return null;
}

/** What one category's row in the CategoryConfig table says (read and saved in lib/db/category-config.ts). */
export type CategoryConfig = {
  /** False takes the category off the price list. It still shows in the library. */
  sellable: boolean;
  /** The sentence on the library's "Coming soon" tile. Null means the default sentence. */
  comingSoonText: string | null;
};

/** What a category says while it has no published video and no sentence of its own. */
export const DEFAULT_COMING_SOON = "Animations for this category are in production and will appear here when they are released.";

/**
 * The sentence the library shows on a category's "Coming soon" tile: the
 * one staff wrote, or the default. Pure, so the library pages can call it
 * without another query.
 */
export function comingSoonSentence(config: CategoryConfig | undefined) {
  const text = config?.comingSoonText?.trim();
  return text ? text : DEFAULT_COMING_SOON;
}

// ---------------------------------------------------------------------------
// The full list: the defaults above with the CategoryConfig table laid over
// them. Built on the server (getCategoryList() in lib/db/category-config.ts)
// and handed to the browser as props. Everything below is pure.
// ---------------------------------------------------------------------------

/** One category as every screen shows it: the current label, slug, image and place, and its sale settings. */
export type CategoryDetails = CategoryDefault & {
  /** Place in the list, smallest first. */
  order: number;
  /** False takes the category off the price list. It still shows in the library. */
  sellable: boolean;
  /** The sentence on the library's "Coming soon" tile. Null means the default sentence. */
  comingSoonText: string | null;
  /** Earlier slugs that redirect to the current one (the default slug always does too). */
  formerSlugs: string[];
};

/** What one CategoryConfig row holds, as lib/db/category-config.ts reads it. Empty means the default. */
export type CategoryRow = {
  category: Category;
  sellable: boolean;
  comingSoonText: string | null;
  label: string | null;
  slug: string | null;
  imageUrl: string | null;
  sortOrder: number | null;
  formerSlugs: string[];
};

/** A category's default place: 10, 20, 30, so a new place can be typed between two. */
export function defaultOrder(category: Category): number {
  const index = CATEGORY_DEFAULTS.findIndex((entry) => entry.value === category);
  return (index < 0 ? CATEGORY_DEFAULTS.length : index + 1) * 10;
}

/**
 * The full list from the table's rows: every category in CATEGORY_DEFAULTS,
 * each detail the row's when it has one and the default when not, sorted by
 * place (ties keep the default order). A category with no row is exactly as
 * it starts: for sale, the default sentence.
 */
export function categoryListFromRows(rows: CategoryRow[]): CategoryDetails[] {
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  const known = new Set(CATEGORY_DEFAULTS.map((entry) => entry.value));
  const list = CATEGORY_DEFAULTS.map((entry, index) => {
    const row = byCategory.get(entry.value);
    const details: CategoryDetails = {
      value: entry.value,
      label: row?.label?.trim() || entry.label,
      slug: row?.slug || entry.slug,
      image: row?.imageUrl || entry.image,
      order: row?.sortOrder ?? defaultOrder(entry.value),
      sellable: row?.sellable ?? true,
      comingSoonText: row?.comingSoonText ?? null,
      formerSlugs: row?.formerSlugs ?? [],
    };
    return { details, index };
  });
  // A category with a row but no starting details (one added later, from the table): its row is all there is.
  for (const row of rows) {
    if (known.has(row.category)) continue;
    list.push({
      details: {
        value: row.category,
        label: row.label?.trim() || row.category,
        slug: row.slug || row.category.toLowerCase().replace(/_/g, "-"),
        image: row.imageUrl || "",
        order: row.sortOrder ?? (CATEGORY_DEFAULTS.length + 1) * 10,
        sellable: row.sellable,
        comingSoonText: row.comingSoonText,
        formerSlugs: row.formerSlugs,
      },
      index: CATEGORY_DEFAULTS.length + list.length,
    });
  }
  list.sort((a, b) => a.details.order - b.details.order || a.index - b.index);
  return list.map((entry) => entry.details);
}

/** The label a category shows now ("Knee"). Falls back to the default label, then the value, so it never shows nothing. */
export function labelOf(list: CategoryDetails[], category: Category | string): string {
  return (
    list.find((entry) => entry.value === category)?.label ??
    CATEGORY_DEFAULTS.find((entry) => entry.value === category)?.label ??
    String(category)
  );
}

/** Every category's current label, keyed by category, for the pieces that only need names (the pricing engine's receipt line). */
export function labelsOf(list: CategoryDetails[]): Record<Category, string> {
  const labels = {} as Record<Category, string>;
  for (const entry of CATEGORY_DEFAULTS) labels[entry.value] = labelOf(list, entry.value);
  for (const entry of list) labels[entry.value] = entry.label;
  return labels;
}

/**
 * Is this a category that exists, one of the list's keys? The one check every
 * place a category arrives makes (a form, an address, a script, a stored plan),
 * because a text column would hold any word. `list` is getCategoryList() on
 * the server, or the list handed to a page.
 */
export function isKnownCategory(list: readonly { value: string }[], value: unknown): value is Category {
  return typeof value === "string" && list.some((entry) => entry.value === value);
}

/** The given values that are not categories in the list, for a plain refusal. */
export function unknownCategories(list: readonly { value: string }[], values: readonly unknown[]): string[] {
  return values.filter((value) => !isKnownCategory(list, value)).map((value) => String(value));
}

/** The given categories in the list's order, each once. Values not in the list are dropped. */
export function inListOrder(list: CategoryDetails[], categories: readonly Category[]): Category[] {
  const wanted = new Set(categories);
  return list.filter((entry) => wanted.has(entry.value)).map((entry) => entry.value);
}

/** The given categories' current labels, in the list's order. */
export function labelsInOrder(list: CategoryDetails[], categories: readonly Category[]): string[] {
  return list.filter((entry) => categories.includes(entry.value)).map((entry) => entry.label);
}

/**
 * Look a category up by a slug in an address. `current` is true when the
 * slug is its address now, false when it is an earlier one (its default
 * slug, or one in formerSlugs), which the page answers with a redirect so no
 * bookmark breaks. Current slugs are looked at first. Undefined for a slug
 * no category has ever had.
 */
export function findCategoryBySlug(list: CategoryDetails[], slug: string): { category: CategoryDetails; current: boolean } | undefined {
  const now = list.find((entry) => entry.slug === slug);
  if (now) return { category: now, current: true };
  const before = list.find((entry) => entry.formerSlugs.includes(slug) || defaultSlugOf(entry.value) === slug);
  return before ? { category: before, current: false } : undefined;
}

function defaultSlugOf(category: Category) {
  return CATEGORY_DEFAULTS.find((entry) => entry.value === category)?.slug;
}

// ---------------------------------------------------------------------------
// The details form on /pulse/videos, checked the same way in the browser and
// on the server.
// ---------------------------------------------------------------------------

/** The longest a category's label may be. */
export const CATEGORY_LABEL_MAX = 40;
/** The longest a category's slug may be. */
export const CATEGORY_SLUG_MAX = 40;
/** The furthest place a category may be put. */
export const CATEGORY_ORDER_MAX = 9999;
/**
 * Slugs that are already pages of their own under /library, so a category
 * given one could never be reached. Refused.
 */
export const RESERVED_SLUGS = ["search", "watch"];

/** A slug: lowercase letters and digits in groups joined by single hyphens ("foot-ankle"). */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the details form may change, checked. Null means "the default". */
export type CategoryDetailsInput = {
  label: string | null;
  slug: string | null;
  imageUrl: string | null;
  sortOrder: number | null;
};

/**
 * Check the details form's four boxes for one category. An empty box, or a
 * box holding exactly the default, means the default and is stored as empty.
 * Refuses, in one plain sentence, a label that is too long or more than one
 * line, a slug of the wrong shape or one that is a page of its own, an image
 * address that is not https (the same rule as a clinic's logo), and a place
 * that is not a whole number from 1 to 9999.
 */
export function readCategoryDetails(
  category: Category,
  raw: { label: unknown; slug: unknown; imageUrl: unknown; sortOrder: unknown },
): { ok: true; details: CategoryDetailsInput } | { ok: false; error: string } {
  const start = CATEGORY_DEFAULTS.find((entry) => entry.value === category);
  if (!start) return { ok: false, error: "That is not one of our categories." };

  const labelRaw = typeof raw.label === "string" ? raw.label : "";
  if (/[\r\n\t]/.test(labelRaw.trim())) return { ok: false, error: "Keep the name on one line." };
  const labelText = labelRaw.trim();
  if (labelText.length > CATEGORY_LABEL_MAX) return { ok: false, error: `Keep the name to ${CATEGORY_LABEL_MAX} characters.` };

  const slugText = typeof raw.slug === "string" ? raw.slug.trim() : "";
  if (slugText) {
    if (slugText.length > CATEGORY_SLUG_MAX) return { ok: false, error: `Keep the web address to ${CATEGORY_SLUG_MAX} characters.` };
    if (!SLUG_SHAPE.test(slugText)) {
      return { ok: false, error: "The web address can only use lowercase letters, numbers and single hyphens, like foot-ankle." };
    }
    if (RESERVED_SLUGS.includes(slugText)) return { ok: false, error: `"${slugText}" is already a page of its own. Choose another web address.` };
  }

  const imageText = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
  const image = imageText ? parseLogoUrl(imageText) : null;
  if (imageText && !image) return { ok: false, error: "The tile picture must be a full address starting with https://." };

  const orderText = typeof raw.sortOrder === "string" ? raw.sortOrder.trim() : "";
  let sortOrder: number | null = null;
  if (orderText) {
    const n = Number(orderText);
    if (!/^\d+$/.test(orderText) || !Number.isInteger(n) || n < 1 || n > CATEGORY_ORDER_MAX) {
      return { ok: false, error: `The place in the list must be a whole number from 1 to ${CATEGORY_ORDER_MAX}.` };
    }
    sortOrder = n === defaultOrder(category) ? null : n;
  }

  return {
    ok: true,
    details: {
      label: labelText && labelText !== start.label ? labelText : null,
      slug: slugText && slugText !== start.slug ? slugText : null,
      imageUrl: image && image !== start.image ? image : null,
      sortOrder,
    },
  };
}

/**
 * The list as it starts, with no changes from the table: for pure code and
 * tests that are handed no list.
 */
export const DEFAULT_CATEGORY_LIST: CategoryDetails[] = categoryListFromRows([]);

/**
 * Which addresses belong to OTHER categories and so cannot be taken: each
 * one's current slug, its default slug and its earlier ones. An address,
 * once a category has had it, stays that category's, so an old bookmark
 * never opens a different category.
 */
export function takenSlugs(list: CategoryDetails[], category: Category): Set<string> {
  const taken = new Set<string>();
  for (const entry of list) {
    if (entry.value === category) continue;
    taken.add(entry.slug);
    const start = defaultSlugOf(entry.value);
    if (start) taken.add(start);
    for (const slug of entry.formerSlugs) taken.add(slug);
  }
  return taken;
}

/**
 * The earlier slugs to keep after a slug change: the old ones, plus the slug
 * being left (unless it is the default, which always redirects anyway), minus
 * the new one (a category may go back to an address it had).
 */
export function formerSlugsAfter(category: Category, before: { slug: string; formerSlugs: string[] }, newSlug: string): string[] {
  const start = defaultSlugOf(category);
  const kept = new Set(before.formerSlugs);
  if (before.slug !== newSlug && before.slug !== start) kept.add(before.slug);
  kept.delete(newSlug);
  return [...kept];
}
