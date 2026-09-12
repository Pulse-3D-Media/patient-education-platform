import type { Category } from "@prisma/client";

/**
 * The library categories, in the order they appear on screen.
 *
 * The database stores them as enum values (KNEE, FOOT_ANKLE). This file maps
 * each one to the label a surgeon reads ("Knee", "Foot & Ankle"), the slug in
 * the URL (/library/knee, /library/foot-ankle) and a tile image.
 *
 * Adding a category is one entry here plus the enum value in the schema. The
 * navigation, tiles and pages all render from this list.
 *
 * Tile images are stills already published on pulse3dmedia.com, served from
 * its CDN. Nothing here is unreleased. Every address was checked to return
 * 200 before it was committed: a wrong asset id returns 403 and the tile
 * renders empty, so do not invent one.
 */

/** The heading the category navigation groups these under. */
export const CATEGORY_GROUP = "Orthopedic Surgery";

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/";

export const CATEGORIES: { value: Category; label: string; slug: string; image: string }[] = [
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

/** Look a category up by its URL slug. Returns undefined for an unknown slug. */
export function categoryFromSlug(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}
