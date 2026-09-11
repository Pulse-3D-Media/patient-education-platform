/**
 * Set one clinic's plan by hand: which categories it has and how many
 * surgeon seats it pays for. Run with:
 *
 *   npm run db:set-plan -- <clinicId> --categories all --seats 10
 *   npm run db:set-plan -- <clinicId> --categories KNEE,HIP --seats 3
 *   npm run db:set-plan -- <clinicId> --categories none --seats 0
 *
 * Categories are the enum values in prisma/schema.prisma (SPINE,
 * COMPLEX_SPINE, KNEE, SHOULDER, HIP, FOOT_ANKLE), or "all", or "none".
 * Seats is a whole number, 0 or more.
 *
 * The same change can be made on /pulse. This script exists for the test
 * clinic and for a clinic set up before /pulse existed. It is the only
 * sanctioned way to change a plan by hand (never in the Neon console). It
 * prints what it changed and refuses to run with missing or odd arguments.
 */
import { Category } from "@prisma/client";
import { prisma } from "../lib/db/client";
import { setClinicPlan } from "../lib/db/clinics";

const ALL_CATEGORIES = Object.values(Category);

function usage(): never {
  console.error("Usage: npm run db:set-plan -- <clinicId> --categories <all|none|A,B,C> --seats <number>");
  console.error(`Categories: ${ALL_CATEGORIES.join(", ")}`);
  process.exit(1);
}

/** Turn "all", "none" or "KNEE,HIP" into a list of categories, or print usage and stop. */
function parseCategories(value: string): Category[] {
  const text = value.trim().toUpperCase();
  if (text === "ALL") return ALL_CATEGORIES;
  if (text === "NONE" || text === "") return [];

  const names = text.split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !(ALL_CATEGORIES as string[]).includes(name));
  if (unknown.length > 0) {
    console.error(`Not a category: ${unknown.join(", ")}`);
    usage();
  }
  return names as Category[];
}

/** A whole number, 0 or more, or print usage and stop. */
function parseSeats(value: string): number {
  const seats = Number(value.trim());
  if (!Number.isInteger(seats) || seats < 0) {
    console.error(`Seats must be a whole number, 0 or more. Got "${value}".`);
    usage();
  }
  return seats;
}

async function main() {
  // npm passes everything after "--" through to this script.
  const args = process.argv.slice(2);
  const clinicId = args[0]?.trim();
  const categoriesIndex = args.indexOf("--categories");
  const seatsIndex = args.indexOf("--seats");

  if (!clinicId || clinicId.startsWith("--") || categoriesIndex === -1 || seatsIndex === -1) usage();

  const categoriesValue = args[categoriesIndex + 1];
  const seatsValue = args[seatsIndex + 1];
  if (categoriesValue == null || seatsValue == null) usage();

  const categories = parseCategories(categoriesValue);
  const seats = parseSeats(seatsValue);

  const before = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, categories: true, surgeonSeats: true },
  });
  if (!before) {
    console.error(`No clinic has the id "${clinicId}".`);
    process.exit(1);
  }

  // The change goes in the clinic's log on /pulse like any other, under this script's name.
  const { clinic: after, logged } = await setClinicPlan(clinicId, categories, seats, "npm run db:set-plan");

  console.log(`Clinic "${after.name}" (${after.id})`);
  console.log(`  categories: ${before.categories.join(", ") || "(none)"} -> ${after.categories.join(", ") || "(none)"}`);
  console.log(`  surgeon seats: ${before.surgeonSeats} -> ${after.surgeonSeats}`);
  console.log(logged ? `  logged: ${logged}` : "  nothing changed, nothing logged");
}

main()
  .catch((error) => {
    console.error("Set plan failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
