/**
 * Seed script. Run with: npm run db:seed
 *
 * Creates the one Clinic row Phase 1 needs and prints its id. To connect it to
 * the Clerk organization its staff sign in with, run:
 *   npm run db:link-clinic -- <that id> <the organization id>
 *
 * Safe to run more than once: if the clinic already exists it prints the
 * existing id instead of creating a duplicate, together with the Clerk
 * organization that row is linked to. A clinic's name comes from its Clerk
 * organization, which anyone can name as they like, so a row with this name
 * may not be ours: check the organization before using the id. When more than
 * one row has the name, it refuses and lists them all (prisma/seed-clinic.ts).
 *
 * Against production it also needs --production (see prisma/preflight.ts).
 */
import { prisma } from "../lib/db/client";
import { errorKind } from "../lib/error-kind";
import { preflight } from "./preflight";
import { findSeedClinic, seedClinicLines } from "./seed-clinic";

const CLINIC_NAME = "Pulse 3D Test Clinic";

async function main() {
  preflight();

  const lookup = await findSeedClinic(CLINIC_NAME);
  if (lookup.kind === "several") {
    for (const line of seedClinicLines(CLINIC_NAME, lookup)) console.error(line);
    process.exitCode = 1;
    return;
  }
  if (lookup.kind === "one") {
    for (const line of seedClinicLines(CLINIC_NAME, lookup)) console.log(line);
    return;
  }

  const clinic = await prisma.clinic.create({
    data: { name: CLINIC_NAME },
  });

  console.log(`Created clinic "${CLINIC_NAME}".`);
  console.log(`Clinic id: ${clinic.id}`);
  console.log("It is not linked to any organization yet.");
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
