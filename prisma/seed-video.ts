/**
 * THE CATALOGUE IS MANAGED AT /pulse/videos. This script is for a fresh
 * database only: it puts the first real animation in place so the library
 * is not empty.
 *
 * Seed for the first library video. Run with: npm run db:seed-video
 *
 * CREATE-ONLY. If a "Total Knee Replacement" video is already in the KNEE
 * category, this script says so and leaves it exactly as it is: its address,
 * its length, and above all whether it is published. Unpublishing is the one
 * way to withdraw a video from every patient link, so a rerun must never
 * publish it again. To change the file behind a video, edit it on
 * /pulse/videos.
 *
 * Against production it also needs --production (see prisma/preflight.ts).
 */
import { prisma } from "../lib/db/client";
import { errorKind } from "../lib/error-kind";
import { preflight } from "./preflight";

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
  preflight();

  const existing = await prisma.video.findFirst({
    where: { title: VIDEO.title, category: VIDEO.category },
    select: { id: true },
  });

  if (existing) {
    console.log(`Video "${VIDEO.title}" already exists. Left exactly as it is (edit it on /pulse/videos).`);
    console.log(`VIDEO_ID=${existing.id}`);
    return;
  }

  const video = await prisma.video.create({ data: VIDEO });
  console.log(`Created video "${VIDEO.title}" (${VIDEO.category}, published).`);
  console.log(`VIDEO_ID=${video.id}`);
}

main()
  .catch((error) => {
    // The kind of failure only, never its message (lib/error-kind.ts).
    console.error("Seed failed:", errorKind(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
