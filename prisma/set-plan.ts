/**
 * Set one clinic's plan by hand: which categories it has and how many
 * surgeon seats it pays for. Run with:
 *
 *   npm run db:set-plan -- <clinicId> --categories all --seats 10
 *   npm run db:set-plan -- <clinicId> --categories KNEE,HIP --seats 3
 *   npm run db:set-plan -- <clinicId> --categories none --seats 0
 *
 * Categories are their keys as /pulse/videos lists them (SPINE,
 * COMPLEX_SPINE, KNEE, SHOULDER, HIP, FOOT_ANKLE, and any added since),
 * comma separated, or "all", or "none". An empty value is refused: to take
 * every category away, write "none". Seats is a whole number written as
 * plain digits, 0 or more ("0x10" or "1e2" is refused). See prisma/plan-args.ts.
 *
 * Lowering the seats below the number of people who hold one is refused,
 * the same as on /pulse. To do it on purpose, add --allow-fewer-seats:
 *
 *   npm run db:set-plan -- <clinicId> --categories KNEE --seats 1 --allow-fewer-seats
 *
 * Nobody is relabelled and no seat is taken away; the clinic is simply over
 * its plan, the log says by how much, and nobody new can be given a seat
 * until that is settled.
 *
 * Against production it also needs --production (see prisma/preflight.ts).
 *
 * The same change can be made on /pulse. This script exists for the test
 * clinic and for a clinic set up before /pulse existed. It is the only
 * sanctioned way to change a plan by hand (never in the Neon console). It
 * prints what it changed and refuses to run with missing or odd arguments.
 */
import { getCategoryList } from "../lib/db/category-config";
import { prisma } from "../lib/db/client";
import { PlanSeatsRefusedError, setClinicPlan } from "../lib/db/clinics";
import { errorKind } from "../lib/error-kind";
import { readPlanCategories, readPlanSeats } from "./plan-args";
import { preflight } from "./preflight";

function usage(): never {
  console.error("Usage: npm run db:set-plan -- <clinicId> --categories <all|none|A,B,C> --seats <number> [--allow-fewer-seats] [--production]");
  console.error("Categories: their keys as /pulse/videos lists them (KNEE, FOOT_ANKLE ...), comma separated, or all, or none.");
  process.exit(1);
}

async function main() {
  // npm passes everything after "--" through to this script; preflight takes --production out.
  const args = preflight();
  const clinicId = args[0]?.trim();
  const categoriesIndex = args.indexOf("--categories");
  const seatsIndex = args.indexOf("--seats");

  if (!clinicId || clinicId.startsWith("--") || categoriesIndex === -1 || seatsIndex === -1) usage();

  const categoriesValue = args[categoriesIndex + 1];
  const seatsValue = args[seatsIndex + 1];
  if (categoriesValue == null || seatsValue == null) usage();

  // The categories that exist are the CategoryConfig rows (since K2 a category is text, so it is checked here).
  const known = (await getCategoryList()).map((entry) => entry.value);
  const categoriesRead = readPlanCategories(categoriesValue, known);
  if (!categoriesRead.ok) {
    console.error(categoriesRead.reason);
    usage();
  }
  const seatsRead = readPlanSeats(seatsValue);
  if (!seatsRead.ok) {
    console.error(seatsRead.reason);
    usage();
  }
  const categories = categoriesRead.categories;
  const seats = seatsRead.seats;

  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, categories: true, surgeonSeats: true },
  });
  if (!before) {
    console.error(`No clinic has the id "${clinicId}".`);
    process.exit(1);
  }

  // The change goes in the clinic's log on /pulse like any other, under this script's name.
  // A refusal (fewer seats than are in use, without the flag) is a plain sentence, printed by the catch below.
  const allowFewerSeatsThanInUse = args.includes("--allow-fewer-seats");
  const { clinic: after, logged } = await setClinicPlan(clinicId, categories, seats, "npm run db:set-plan", { allowFewerSeatsThanInUse });

  console.log(`Clinic "${after.name}" (${after.id})`);
  console.log(`  categories: ${before.categories.join(", ") || "(none)"} -> ${after.categories.join(", ") || "(none)"}`);
  console.log(`  surgeon seats: ${before.surgeonSeats} -> ${after.surgeonSeats}`);
  console.log(logged ? `  logged: ${logged}` : "  nothing changed, nothing logged");
}

main()
  .catch((error) => {
    // The seat refusal is our own plain sentence. Anything else is named by its kind only, never its message (lib/error-kind.ts).
    if (error instanceof PlanSeatsRefusedError) console.error(error.message);
    else console.error("Set plan failed:", errorKind(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
