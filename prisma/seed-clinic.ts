/**
 * How `npm run db:seed` finds the test clinic, kept out of prisma/seed.ts so
 * it can be tested (prisma/seed.ts runs as soon as it is loaded).
 *
 * The seed looks the test clinic up by its name, but a clinic's name is
 * copied from its Clerk organization, and whoever makes an organization
 * chooses its name. So a row with the test clinic's name may be somebody
 * else's clinic. The name alone can never settle that, so the seed:
 * - prints which Clerk organization the row it found belongs to (or that it
 *   belongs to none), so the person running it can see whose it is before
 *   using the id anywhere;
 * - refuses, listing every row and its organization, when more than one row
 *   has the name, rather than picking one.
 */
import { listClinicsNamed, type NamedClinic } from "../lib/db/clinics";

export type SeedClinicLookup =
  | { kind: "none" }
  | { kind: "one"; clinic: NamedClinic }
  | { kind: "several"; clinics: NamedClinic[] };

/** What the rows with the test clinic's name mean for the seed. Pure. */
export function decideSeedClinic(rows: NamedClinic[]): SeedClinicLookup {
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "one", clinic: rows[0] };
  return { kind: "several", clinics: rows };
}

/** Look up the rows named exactly `name` and decide. A handful at most is read: two is already a refusal. */
export async function findSeedClinic(name: string): Promise<SeedClinicLookup> {
  return decideSeedClinic(await listClinicsNamed(name, 20));
}

function organizationWords(clerkOrgId: string | null) {
  return clerkOrgId ? `linked to Clerk organization ${clerkOrgId}` : "not linked to any organization";
}

/** The lines the seed prints for a clinic it found, or for the rows it refuses to choose between. */
export function seedClinicLines(name: string, lookup: Exclude<SeedClinicLookup, { kind: "none" }>): string[] {
  if (lookup.kind === "one") {
    return [
      `Clinic "${name}" already exists.`,
      `Clinic id: ${lookup.clinic.id}`,
      `It is ${organizationWords(lookup.clinic.clerkOrgId)}. Check that is the organization you expect before using the id.`,
    ];
  }
  return [
    `${lookup.clinics.length} clinics are named "${name}", so the seed cannot tell which is the test clinic. Nothing was changed.`,
    ...lookup.clinics.map((clinic) => `  ${clinic.id}: ${organizationWords(clinic.clerkOrgId)}`),
    "Find the right one on /pulse before using any of these ids.",
  ];
}
