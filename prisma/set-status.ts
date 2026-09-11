/**
 * Change one clinic's status by hand. Run with:
 *
 *   npm run db:set-status -- <clinicId> <STATUS>
 *
 * STATUS is one of PENDING, ACTIVE, PAUSED, PAST_DUE or CANCELED (the
 * ClinicStatus enum in prisma/schema.prisma). Only ACTIVE clinics can use
 * the library; see clinicIsOpen() in lib/clinic-status.ts.
 *
 * Until billing exists this is how a clinic that has agreed a plan gets
 * switched on. It is the only sanctioned way to change a status by hand
 * (never in the Neon console). It prints what it changed, and refuses to
 * run with missing or unknown arguments.
 */
import { ClinicStatus } from "@prisma/client";
import { prisma } from "../lib/db/client";
import { setClinicStatus } from "../lib/db/clinics";

const STATUSES = Object.values(ClinicStatus);

function isStatus(value: string): value is ClinicStatus {
  return (STATUSES as string[]).includes(value);
}

async function main() {
  // npm passes everything after "--" through to this script.
  const [clinicId, rawStatus] = process.argv.slice(2).map((value) => value.trim());
  const status = rawStatus?.toUpperCase();

  if (!clinicId || !status) {
    console.error("Usage: npm run db:set-status -- <clinicId> <STATUS>");
    console.error(`STATUS is one of: ${STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (!isStatus(status)) {
    console.error(`"${rawStatus}" is not a clinic status. Use one of: ${STATUSES.join(", ")}`);
    process.exit(1);
  }

  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, status: true },
  });
  if (!before) {
    console.error(`No clinic has the id "${clinicId}".`);
    process.exit(1);
  }

  if (before.status === status) {
    console.log(`Clinic "${before.name}" (${before.id}) is already ${status}. Nothing changed.`);
    return;
  }

  const after = await setClinicStatus(clinicId, status);

  console.log(`Clinic "${after.name}" (${after.id})`);
  console.log(`  status: ${before.status} -> ${after.status}`);
}

main()
  .catch((error) => {
    console.error("Set status failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
