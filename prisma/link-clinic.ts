/**
 * Link one Clinic row to one Clerk organization. Run with:
 *
 *   npm run db:link-clinic -- <clinicId> <orgId>
 *
 * The clinic id is the cuid printed by npm run db:seed. The organization id
 * is the one Clerk shows for the organization (it starts with "org_").
 * Afterwards, anyone signed in with that organization active is that clinic.
 *
 * A clinic that is already linked to a different organization is refused:
 * re-pointing it hands the clinic, its plan, its seats and its links to
 * whoever signs in with the other organization. To do it on purpose, add
 * --relink. Either way the change goes in the clinic's log on /pulse.
 *
 * Against production it also needs --production (see prisma/preflight.ts).
 *
 * This is the only sanctioned way to change clerkOrgId by hand (never in the
 * Neon console). It prints what it changed, and refuses to run with missing
 * or odd-looking arguments.
 */
import { prisma } from "../lib/db/client";
import { ClinicLinkRefusedError, linkClinicToClerkOrg } from "../lib/db/clinics";
import { errorKind } from "../lib/error-kind";
import { preflight } from "./preflight";

const RELINK_FLAG = "--relink";

async function main() {
  // npm passes everything after "--" through to this script; preflight takes --production out.
  const args = preflight();
  const relink = args.includes(RELINK_FLAG);
  const [clinicId, orgId] = args.filter((arg) => arg !== RELINK_FLAG).map((value) => value.trim());

  if (!clinicId || !orgId) {
    console.error("Usage: npm run db:link-clinic -- <clinicId> <orgId> [--relink] [--production]");
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

  // The check for an existing link is made again inside, under the clinic's row lock.
  const { clinic: after, logged } = await linkClinicToClerkOrg(clinicId, orgId, "npm run db:link-clinic", { relink });

  console.log(`Clinic "${after.name}" (${after.id})`);
  if (!logged) {
    console.log(`  already linked to ${orgId}. Nothing changed, nothing logged.`);
    return;
  }
  console.log(`  clerkOrgId: ${before.clerkOrgId ?? "(none)"} -> ${after.clerkOrgId}`);
  console.log(`  logged: ${logged}`);
}

main()
  .catch((error) => {
    // Our own refusals are plain sentences. Anything else is named by its kind only, never its message (lib/error-kind.ts).
    if (error instanceof ClinicLinkRefusedError) console.error(error.message);
    else if (errorKind(error) === "Prisma P2002") console.error("That organization is already linked to a different clinic. Nothing was changed.");
    else console.error("Link failed:", errorKind(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
