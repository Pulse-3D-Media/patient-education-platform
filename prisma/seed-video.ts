/**
 * Seed for the first library video. Run with: npm run db:seed-video
 *
 * Makes sure the Total Knee Replacement animation (hosted on the Webflow CDN
 * for Phase 1) is in the Video table with the address and length below.
 *
 * Safe to run more than once. If the video already exists it updates the
 * address and length to match this file, so this file is the record of what
 * the library is currently playing. Edit the values here and rerun to swap
 * the file behind the video.
 */
import { prisma } from "../lib/db/client";

const VIDEO = {
  title: "Total Knee Replacement",
  category: "KNEE" as const,
  // The full 1:50 animation, 1080p, compressed to about 19 MB with narration.
  videoUrl:
    "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a9b3ee8b6ec46348bcd5e45_knee-tka-full.mp4",
  durationSeconds: 110,
  isPublished: true,
};

async function main() {
  const existing = await prisma.video.findFirst({
    where: { title: VIDEO.title, category: VIDEO.category },
  });

  if (existing) {
    const video = await prisma.video.update({
      where: { id: existing.id },
      data: {
        videoUrl: VIDEO.videoUrl,
        durationSeconds: VIDEO.durationSeconds,
        isPublished: VIDEO.isPublished,
      },
    });
    console.log(`Updated video "${VIDEO.title}" (${VIDEO.durationSeconds}s).`);
    console.log(`VIDEO_ID=${video.id}`);
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
