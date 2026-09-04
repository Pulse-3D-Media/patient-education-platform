import type { Category } from "@prisma/client";

/**
 * The library categories, in the order they appear on screen.
 *
 * The database stores them as enum values (KNEE, FOOT_ANKLE). This file maps
 * each one to the label a surgeon reads ("Knee", "Foot & Ankle"), the slug in
 * the URL (/library/knee, /library/foot-ankle) and a tile image.
 *
 * Adding a category is one line here plus the enum value in the schema. The
 * navigation, tiles and pages all render from this list.
 *
 * Tile images are stills already published on pulse3dmedia.com, served from
 * its CDN. Nothing here is unreleased.
 */

/** The heading the category navigation groups these under. */
export const CATEGORY_GROUP = "Orthopedic Surgery";

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/";

export const CATEGORIES: { value: Category; label: string; slug: string; image: string }[] = [
  {
    value: "SPINE",
    label: "Spine",
    slug: "spine",
    image: CDN + "6949c3ca377bfce5f6c7fbe8_PCF_04_Cervical_Construct-p-1080.png",
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

/** Look a category up by its URL slug. Returns undefined for an unknown slug. */
export function categoryFromSlug(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}
