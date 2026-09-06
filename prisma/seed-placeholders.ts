/**
 * Seed for the PLACEHOLDER library. Run with: npm run db:seed-placeholders
 *
 * Twelve videos, two per category. Each carries a real procedure name from
 * the production tracker, but the animation that plays is one of four sample
 * clips already on the Webflow CDN, not that procedure. They exist so the
 * library, the send flow and the patient page can be tested with something in
 * every category before the finished animations arrive.
 *
 * Every row is marked isPlaceholder (and isPublished, so it shows). The app
 * shows that mark everywhere the video can appear: the library card, the
 * player, the patient page and the admin list. Nobody, patient included,
 * should be able to mistake one for finished work.
 *
 * This file is deliberately separate from seed-video.ts, which holds the one
 * real animation and is never touched by this script. When the finished
 * animations arrive, delete this file and its npm script, and remove the rows
 * (they are the ones with isPlaceholder = true; delete their share links
 * first, since a share points at its video).
 *
 * Safe to run more than once: a placeholder that already exists (same title
 * and category) is updated to match this file rather than duplicated. A real
 * video that has taken one of these titles is left alone and reported.
 */
import type { Category } from "@prisma/client";
import { prisma } from "../lib/db/client";

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/";

/**
 * The four sample animations. durationSeconds must match the file it names:
 * the patient page turns it into "About 2 minutes", so a wrong number lies.
 * (Measured with ffprobe: 109.97s, 75.80s, 30.00s and 26.28s.)
 */
const SAMPLES = {
  /** The full Total Knee Replacement animation, 1080p with narration. */
  tkaFull: { videoUrl: CDN + "6a9b3ee8b6ec46348bcd5e45_knee-tka-full.mp4", durationSeconds: 110 },
  /** The website's hero reel: several procedures, 720p, silent. */
  heroReel: { videoUrl: CDN + "6a91edc05b3602fb5efca05a_hero-optimized.mp4", durationSeconds: 76 },
  /** A 30 second silent teaser cut of the knee animation. */
  tkaTeaser: { videoUrl: CDN + "6a4fc5dbbbce8d36065ff9b0_knee-tka-teaser-silent.mp4", durationSeconds: 30 },
  /** A 26 second header cut of the knee animation, with sound. */
  tkaHeader: { videoUrl: CDN + "6a4ed124d5c41de325c28578_knee-tka-header.mp4", durationSeconds: 26 },
} as const;

/**
 * Two per category. The samples are spread so that no category plays the
 * same clip twice and each clip is used three times across the twelve.
 */
const PLACEHOLDERS: { title: string; category: Category; sample: keyof typeof SAMPLES }[] = [
  { title: "Lumbar Discectomy", category: "SPINE", sample: "heroReel" },
  { title: "Lumbar Spinal Fusion", category: "SPINE", sample: "tkaFull" },
  { title: "Pedicle Subtraction Osteotomy (L3)", category: "COMPLEX_SPINE", sample: "tkaFull" },
  { title: "Adult Scoliosis Correction", category: "COMPLEX_SPINE", sample: "tkaTeaser" },
  { title: "Partial Knee Replacement", category: "KNEE", sample: "tkaHeader" },
  { title: "ACL Reconstruction", category: "KNEE", sample: "heroReel" },
  { title: "Arthroscopic Rotator Cuff Repair", category: "SHOULDER", sample: "tkaTeaser" },
  { title: "Reverse Total Shoulder Arthroplasty", category: "SHOULDER", sample: "tkaFull" },
  { title: "Total Hip Replacement", category: "HIP", sample: "heroReel" },
  { title: "Hip Arthroscopy (FAI)", category: "HIP", sample: "tkaHeader" },
  { title: "Bunion Correction", category: "FOOT_ANKLE", sample: "tkaTeaser" },
  { title: "Achilles Tendon Repair", category: "FOOT_ANKLE", sample: "tkaHeader" },
];

async function main() {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const placeholder of PLACEHOLDERS) {
    const sample = SAMPLES[placeholder.sample];
    const data = {
      videoUrl: sample.videoUrl,
      durationSeconds: sample.durationSeconds,
      isPublished: true,
      isPlaceholder: true,
    };

    const existing = await prisma.video.findFirst({
      where: { title: placeholder.title, category: placeholder.category },
    });

    if (existing && !existing.isPlaceholder) {
      // A real animation now has this title. Never overwrite it with a sample.
      skipped++;
      console.log(`Skipped  ${placeholder.title} (a real video has this title, left alone)`);
      continue;
    }

    if (existing) {
      await prisma.video.update({ where: { id: existing.id }, data });
      updated++;
      console.log(`Updated  ${placeholder.title} (${placeholder.category}, ${placeholder.sample}, ${sample.durationSeconds}s)`);
      continue;
    }

    await prisma.video.create({
      data: { title: placeholder.title, category: placeholder.category, ...data },
    });
    created++;
    console.log(`Created  ${placeholder.title} (${placeholder.category}, ${placeholder.sample}, ${sample.durationSeconds}s)`);
  }

  console.log(`Placeholders: ${created} created, ${updated} updated, ${skipped} skipped, ${PLACEHOLDERS.length} in this file.`);

  // A check that the real library came through untouched.
  const real = await prisma.video.findMany({ where: { isPlaceholder: false }, select: { title: true } });
  console.log(`Real videos, not placeholders: ${real.length} (${real.map((v) => v.title).join(", ") || "none"}).`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
