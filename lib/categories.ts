import type { Category } from "@prisma/client";

/**
 * The five library categories, in the order they appear on screen.
 *
 * The database stores them as enum values (KNEE, FOOT_ANKLE). This file maps
 * each one to the label a surgeon reads ("Knee", "Foot & Ankle") and the slug
 * that appears in the URL (/library/knee, /library/foot-ankle).
 */
export const CATEGORIES: { value: Category; label: string; slug: string }[] = [
  { value: "SPINE", label: "Spine", slug: "spine" },
  { value: "KNEE", label: "Knee", slug: "knee" },
  { value: "SHOULDER", label: "Shoulder", slug: "shoulder" },
  { value: "HIP", label: "Hip", slug: "hip" },
  { value: "FOOT_ANKLE", label: "Foot & Ankle", slug: "foot-ankle" },
];

/** Look a category up by its URL slug. Returns undefined for an unknown slug. */
export function categoryFromSlug(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}
