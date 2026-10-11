/**
 * Set one clinic's access by hand. Run with:
 *
 *   npm run db:set-status -- <clinicId> <SETTING> [reason in quotes]
 *
 * SETTING is one of:
 *
 *   ACTIVE    open the clinic by hand (the same as "Open" on /pulse)
 *   PAUSED    close it for now
 *   CANCELED  close it, ended
 *   FOLLOW    remove the hand setting, so the clinic follows its billing
 *             (a clinic with no card subscription then goes back to PENDING)
 *
 * This is the same change the Status form on /pulse makes, through the same
 * function, so it is logged in the clinic's log and the status is worked out
 * by the same rule (lib/billing-state.ts). A hand setting wins over billing.
 * PENDING and PAST_DUE cannot be set: they are what the rule works out.
 *
 * PAUSED and CANCELED do NOT cancel a card subscription in Stripe.
 *
 * Against production it also needs --production (see prisma/preflight.ts).
 *
 * Never change a status by hand in the Neon console. It prints what it
 * changed, and refuses to run with missing or unknown arguments.
 */
import type { StaffAccess } from "@prisma/client";
import { prisma } from "../lib/db/client";
import { setClinicStatusByStaff } from "../lib/db/clinics";
import { errorKind } from "../lib/error-kind";
import { preflight } from "./preflight";

const SETTINGS: Record<string, StaffAccess | null> = { ACTIVE: "OPEN", OPEN: "OPEN", PAUSED: "PAUSED", CANCELED: "CANCELED", FOLLOW: null };

const WHO = "npm run db:set-status";

async function main() {
  // npm passes everything after "--" through to this script; preflight takes --production out.
  const [clinicId, rawSetting, ...reasonWords] = preflight().map((value) => value.trim());
  const setting = rawSetting?.toUpperCase();

  if (!clinicId || !setting) {
    console.error('Usage: npm run db:set-status -- <clinicId> <SETTING> ["reason"] [--production]');
    console.error("SETTING is one of: ACTIVE, PAUSED, CANCELED, FOLLOW");
    process.exit(1);
  }
  if (!Object.hasOwn(SETTINGS, setting)) {
    console.error(`"${rawSetting}" cannot be set by hand. Use one of: ACTIVE, PAUSED, CANCELED, FOLLOW`);
    process.exit(1);
  }
  const staffAccess = SETTINGS[setting];
  const reason = reasonWords.join(" ").trim() || "Set from the command line.";

  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, status: true, staffAccess: true },
  });
  if (!before) {
    console.error(`No clinic has the id "${clinicId}".`);
    process.exit(1);
  }

  const { clinic, stillCharging } = await setClinicStatusByStaff(clinicId, staffAccess, reason, WHO);

  console.log(`Clinic "${clinic.name}" (${clinic.id})`);
  console.log(`  set by hand: ${before.staffAccess ?? "nothing"} -> ${clinic.staffAccess ?? "nothing (follows billing)"}`);
  console.log(`  status:      ${before.status} -> ${clinic.status}`);
  if (stillCharging) {
    console.log("  NOTE: this clinic has a card subscription in Stripe. This did not cancel it; cancel it in Stripe or the card keeps being charged.");
  }
}

main()
  .catch((error) => {
    // The kind of failure only, never its message (lib/error-kind.ts).
    console.error("Set status failed:", errorKind(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
