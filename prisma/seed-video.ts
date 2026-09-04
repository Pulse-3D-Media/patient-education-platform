/**
 * One-off seed for the first library video. Run with: npm run db:seed-video
 *
 * Inserts the Total Knee Replacement teaser (hosted on the Webflow CDN for
 * Phase 1) into the Video table so the library and watch pages have something
 * to show.
 *
 * Safe to run more than once: if a video with this title and category already
 * exists it prints the existing id instead of creating a duplicate.
 */
import { prisma } from "../lib/db/client";

const VIDEO = {
  title: "Total Knee Replacement",
  category: "KNEE" as const,
  videoUrl:
    "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a4fc5dbbbce8d36065ff9b0_knee-tka-teaser-silent.mp4",
  durationSeconds: 30,
  isPublished: true,
};

async function main() {
  const existing = await prisma.video.findFirst({
    where: { title: VIDEO.title, category: VIDEO.category },
  });

  if (existing) {
    console.log(`Video "${VIDEO.title}" already exists.`);
    console.log(`VIDEO_ID=${existing.id}`);
    return;
  }

  const video = await prisma.video.create({ data: VIDEO });

  console.log(`Created video "${VIDEO.title}" (${VIDEO.category}, published).`);
  console.log(`VIDEO_ID=${video.id}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
