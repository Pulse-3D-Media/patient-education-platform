/**
 * Clear the clinics that sales demos leave behind on the DEMO SITE, keeping
 * the showroom clinic. Run from the main checkout with:
 *
 *   npm run db:clear-demo-clinics -- --keep <showroom clinic id>
 *   npm run db:clear-demo-clinics -- --keep <showroom clinic id> --confirm
 *
 * The first is a dry run: it lists what it would clear and changes nothing.
 * Only the second deletes. Other options: --hours <number> keeps clinics made
 * in that many hours (24 unless told), and several clinics can be kept with
 * --keep id1,id2 or DEMO_KEEP_CLINIC_IDS.
 *
 * It reads .env.demo, never .env (the main checkout's .env is production):
 * the demo site's database (the Neon testing branch), its Stripe test key, its
 * Clerk test-instance secret key, PRODUCTION_DATABASE_HOST and
 * DEMO_DATABASE_HOST (it must not be the first and must be the second), and
 * DEMO_STRIPE_ACCOUNT_ID (the Stripe key must belong to that account). It
 * refuses production outright, with no --production override, refuses a live
 * Stripe or Clerk key, and touches no Stripe record that does not carry the
 * clinic's own id. The rules
 * and the order of the work are in lib/demo-cleanup.ts.
 */
import { prisma } from "../lib/db/client";
import { checkCleanupStart, runDemoCleanup } from "../lib/demo-cleanup";
import { errorKind } from "../lib/error-kind";
import { demoCleanupClerk } from "../lib/clerk-demo-cleanup";
import { demoCleanupStripe } from "../lib/stripe";
import { PRODUCTION_FLAG, preflight } from "./preflight";

async function main() {
  // This script has no production override at all: refused before the
  // database check could take the flag as a yes.
  if (process.argv.includes(PRODUCTION_FLAG)) {
    console.error(`Refusing to run: the demo clean-up never runs against production, so ${PRODUCTION_FLAG} is not accepted. Nothing was changed.`);
    process.exit(1);
  }

  // Everything this script needs: not production, test keys only, a keep list, arguments it understands.
  const start = checkCleanupStart(process.env, process.argv.slice(2));
  if (!start.ok) {
    console.error(start.reason);
    process.exit(1);
  }

  // And the check every operator script makes, as a second lock. Without --production it refuses production.
  preflight();

  const result = await runDemoCleanup({
    confirm: start.confirm,
    keepClinicIds: start.keepClinicIds,
    keepHours: start.keepHours,
    stripeAccountId: start.stripeAccountId,
    stripe: demoCleanupStripe,
    clerk: demoCleanupClerk,
    now: new Date(),
    log: (line) => console.log(line),
  });
  process.exitCode = result.exitCode;
}

main()
  .catch((error) => {
    // The kind of failure only, never its message (lib/error-kind.ts).
    console.error("The demo clean-up failed:", errorKind(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
