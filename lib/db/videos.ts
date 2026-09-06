import type { Category } from "@prisma/client";
import { CATEGORIES } from "../categories";
import { prisma } from "./client";

/**
 * Queries for the Video table.
 *
 * Videos belong to Pulse 3D, not to a clinic, so these functions do not take a
 * clinicId (rule 1 only requires it for clinic-owned data such as shares).
 *
 * Everything here returns published videos only. Unpublished ones are Van's
 * staging area and must never reach a surgeon's screen.
 */

/** The published videos in one category, newest first. */
export async function listPublishedVideosByCategory(category: Category) {
  return prisma.video.findMany({
    where: { category, isPublished: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * How many published videos each category has. Used by the library home so a
 * surgeon can see which categories have something in them before tapping.
 * Categories with nothing published are simply missing from the result.
 */
export async function countPublishedVideosByCategory() {
  const rows = await prisma.video.groupBy({
    by: ["category"],
    where: { isPublished: true },
    _count: { _all: true },
  });

  const counts: Partial<Record<Category, number>> = {};
  for (const row of rows) {
    counts[row.category] = row._count._all;
  }
  return counts;
}

/**
 * Every published video across all categories, for the admin console.
 * Sorted by category in the order lib/categories lists them (the same order
 * as the library tiles and the drawer), then by title.
 *
 * The sort happens here rather than in the database because Postgres keeps
 * enum values in the order they were added, so Complex Spine would land
 * after Foot & Ankle instead of next to Orthopedic Spine.
 */
export async function listPublishedVideos() {
  const videos = await prisma.video.findMany({
    where: { isPublished: true },
    orderBy: { title: "asc" },
  });

  // Where each category sits in the on-screen order. Sorting is stable, so
  // videos in the same category keep their title order from the query.
  const position = new Map(CATEGORIES.map((c, index) => [c.value, index]));
  return videos.sort((a, b) => (position.get(a.category) ?? 99) - (position.get(b.category) ?? 99));
}
