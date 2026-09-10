/**
 * Seed script. Run with: npm run db:seed
 *
 * Creates the one Clinic row Phase 1 needs and prints its id. To connect it to
 * the Clerk organization its staff sign in with, run:
 *   npm run db:link-clinic -- <that id> <the organization id>
 *
 * Safe to run more than once: if the clinic already exists it just prints the
 * existing id instead of creating a duplicate.
 */
import { prisma } from "../lib/db/client";

const CLINIC_NAME = "Pulse 3D Test Clinic";

async function main() {
  const existing = await prisma.clinic.findFirst({
    where: { name: CLINIC_NAME },
  });

  if (existing) {
    console.log(`Clinic "${CLINIC_NAME}" already exists.`);
    console.log(`Clinic id: ${existing.id}`);
    return;
  }

  const clinic = await prisma.clinic.create({
    data: { name: CLINIC_NAME },
  });

  console.log(`Created clinic "${CLINIC_NAME}".`);
  console.log(`Clinic id: ${clinic.id}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
