/**
 * Link one Clinic row to one Clerk organization. Run with:
 *
 *   npm run db:link-clinic -- <clinicId> <orgId>
 *
 * The clinic id is the cuid printed by npm run db:seed. The organization id
 * is the one Clerk shows for the organization (it starts with "org_").
 * Afterwards, anyone signed in with that organization active is that clinic.
 *
 * This is the only sanctioned way to change clerkOrgId by hand (never in the
 * Neon console). It prints what it changed, and refuses to run with missing
 * or odd-looking arguments.
 */
import { prisma } from "../lib/db/client";
import { linkClinicToClerkOrg } from "../lib/db/clinics";

async function main() {
  // npm passes everything after "--" through to this script.
  const [clinicId, orgId] = process.argv.slice(2).map((value) => value.trim());

  if (!clinicId || !orgId) {
    console.error("Usage: npm run db:link-clinic -- <clinicId> <orgId>");
    process.exit(1);
  }
  if (!orgId.startsWith("org_")) {
    console.error(`"${orgId}" does not look like a Clerk organization id (they start with "org_").`);
    process.exit(1);
  }

  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, clerkOrgId: true },
  });
  if (!before) {
    console.error(`No clinic has the id "${clinicId}".`);
    process.exit(1);
  }

  if (before.clerkOrgId === orgId) {
    console.log(`Clinic "${before.name}" (${before.id}) is already linked to ${orgId}. Nothing changed.`);
    return;
  }

  const after = await linkClinicToClerkOrg(clinicId, orgId);

  console.log(`Clinic "${after.name}" (${after.id})`);
  console.log(`  clerkOrgId: ${before.clerkOrgId ?? "(none)"} -> ${after.clerkOrgId}`);
}

main()
  .catch((error) => {
    console.error("Link failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
