/**
 * THE CATALOGUE IS MANAGED AT /pulse/videos. This script is for a fresh
 * database only: it fills every category with sample animations so the app
 * can be tried before the finished ones exist.
 *
 * CREATE-ONLY. A video that already has one of these titles in its category,
 * placeholder or not, is reported and left exactly as it is: its address,
 * its length, and above all whether it is published. Unpublishing is the one
 * way to withdraw a video from every patient link, so a rerun must never
 * publish it again.
 *
 * Seed for the PLACEHOLDER library. Run with: npm run db:seed-placeholders
 * Against production it also needs --production (see prisma/preflight.ts).
 *
 * Twelve videos, two per category. Each carries a real procedure name from
 * the production tracker, but the animation that plays is a compressed copy
 * of a finished Pulse 3D client animation, not that procedure. They exist so
 * the library, the send flow and the patient page can be tested with
 * something in every category before the finished animations arrive.
 *
 * Every row is marked isPlaceholder (and isPublished, so it shows). The app
 * shows that mark everywhere the video can appear: the library card, the
 * player, the patient page and the admin list. Nobody, patient included,
 * should be able to mistake one for finished work.
 *
 * This file is deliberately separate from seed-video.ts, which holds the one
 * real animation and is never touched by this script. When a finished
 * animation arrives, it REPLACES the sample in the same row: edit the video
 * on /pulse/videos, put in the new file's address and untick "Placeholder".
 * Never delete a placeholder row or its share links, because every link and
 * QR code already sent points at that row and keeps working after the swap.
 *
 * Safe to run more than once: a video that already exists (same title and
 * category) is left alone and reported, never duplicated and never changed.
 */
import type { Category } from "../lib/categories";
import { prisma } from "../lib/db/client";
import { errorKind } from "../lib/error-kind";
import { preflight } from "./preflight";

const CDN = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/";

/**
 * Two per category, each playing a different animation. The files are 720p
 * compressed copies (4 to 15 MB each) of client work that is already public
 * on pulse3dmedia.com, uploaded to the Webflow CDN with a "ph-" prefix so
 * they are easy to find and remove later.
 *
 * Each was chosen to sit near the procedure it stands in for (an anterior
 * lumbar fusion for Lumbar Spinal Fusion, a deformity construct for
 * scoliosis, a printed acetabular cup for Total Hip Replacement), but none
 * of them IS that procedure, which is why every row is a placeholder. The
 * "shows" note says what actually plays.
 *
 * durationSeconds must match the file it names: the patient page turns it
 * into "About 2 minutes", so a wrong number lies. Each was measured with
 * ffprobe after encoding and rounded to the nearest second.
 */
const PLACEHOLDERS: { title: string; category: Category; file: string; durationSeconds: number; shows: string }[] = [
  { title: "Lumbar Discectomy", category: "SPINE", file: "6a9cd63ecb6d4022ce7481ed_ph-canyon-port.mp4", durationSeconds: 78, shows: "lateral lumbar access port" },
  { title: "Lumbar Spinal Fusion", category: "SPINE", file: "6a9cd63ece49ad1ffc877dea_ph-sigma-alif.mp4", durationSeconds: 124, shows: "anterior lumbar interbody fusion" },
  { title: "Pedicle Subtraction Osteotomy (L3)", category: "COMPLEX_SPINE", file: "6a9cd63e82aa537acd97e1ac_ph-corpectomy-retractor.mp4", durationSeconds: 63, shows: "corpectomy retractor and implant" },
  { title: "Adult Scoliosis Correction", category: "COMPLEX_SPINE", file: "6a9cd63e97bddf109c447bc9_ph-everest-deformity.mp4", durationSeconds: 404, shows: "long deformity pedicle screw construct" },
  { title: "Partial Knee Replacement", category: "KNEE", file: "6a9cd63e97bddf109c447be1_ph-meniscus-root-repair.mp4", durationSeconds: 223, shows: "meniscus root repair" },
  { title: "ACL Reconstruction", category: "KNEE", file: "6a9cd63f6f4d62ece154c248_ph-switchcut-acl.mp4", durationSeconds: 129, shows: "retrograde ACL tunnel reaming" },
  { title: "Arthroscopic Rotator Cuff Repair", category: "SHOULDER", file: "6a9cd63fa1f6d1014115c6be_ph-rotator-cuff-repair.mp4", durationSeconds: 198, shows: "rotator cuff suture repair" },
  { title: "Reverse Total Shoulder Arthroplasty", category: "SHOULDER", file: "6a9cd63f99bc97465038d36d_ph-humeris-reverse-shoulder.mp4", durationSeconds: 203, shows: "reverse shoulder humeral component" },
  { title: "Total Hip Replacement", category: "HIP", file: "6a9cd63ff7be1fa65cefc0e0_ph-osseoti-hip.mp4", durationSeconds: 113, shows: "printed acetabular cup" },
  { title: "Hip Arthroscopy (FAI)", category: "HIP", file: "6a9cd63febbb1197269e8684_ph-iconix-hip-labral.mp4", durationSeconds: 197, shows: "arthroscopic hip labral repair" },
  { title: "Bunion Correction", category: "FOOT_ANKLE", file: "6a9cd63f6dadb978a9f27b8d_ph-bunionplasty.mp4", durationSeconds: 192, shows: "bunion correction with sesamoid adjustment" },
  { title: "Achilles Tendon Repair", category: "FOOT_ANKLE", file: "6a9cd6403b90d1aec7450ddb_ph-achilles-repair.mp4", durationSeconds: 143, shows: "insertional Achilles repair with anchors" },
];

async function main() {
  preflight();

  let created = 0;
  let skipped = 0;

  for (const placeholder of PLACEHOLDERS) {
    const existing = await prisma.video.findFirst({
      where: { title: placeholder.title, category: placeholder.category },
      select: { isPlaceholder: true },
    });

    if (existing) {
      // Create-only: whatever is there now (a sample, or the finished animation that replaced it) is left exactly as it is,
      // published or not. Edit it on /pulse/videos.
      skipped++;
      console.log(`Exists   ${placeholder.title} (${existing.isPlaceholder ? "a placeholder" : "a real video"}, left alone)`);
      continue;
    }

    await prisma.video.create({
      data: {
        title: placeholder.title,
        category: placeholder.category,
        videoUrl: CDN + placeholder.file,
        durationSeconds: placeholder.durationSeconds,
        isPublished: true,
        isPlaceholder: true,
      },
    });
    created++;
    console.log(`Created  ${placeholder.title} (${placeholder.category}, ${placeholder.durationSeconds}s, shows ${placeholder.shows})`);
  }

  console.log(`Placeholders: ${created} created, ${skipped} already there and left alone, ${PLACEHOLDERS.length} in this file.`);

  // A check that the real library came through untouched.
  const real = await prisma.video.findMany({ where: { isPlaceholder: false }, select: { title: true } });
  console.log(`Real videos, not placeholders: ${real.length} (${real.map((v) => v.title).join(", ") || "none"}).`);
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
