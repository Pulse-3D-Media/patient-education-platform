import { auth } from "@clerk/nextjs/server";
import { getClinicByClerkOrgId } from "./db/clinics";

/**
 * Which clinic is using the app right now.
 *
 * The signed-in user's active Clerk organization is looked up on the server
 * with auth(), and the Clinic whose clerkOrgId matches it is the answer.
 * Every lib/db function that touches clinic data takes the id this returns,
 * so this one function is the only place the signed-in user meets the
 * database.
 *
 * Returns null, never throws, in each of these cases:
 *   - nobody is signed in (or the session is still "pending", which Clerk
 *     treats as signed out until the user picks an organization)
 *   - the user is signed in but has no active organization
 *   - no Clinic row is linked to that organization yet
 * The caller decides what to show: the pages show a calm "not linked yet"
 * page, the actions return a message.
 *
 * A Clerk organization id (org_...) is not a clinic id and must never be
 * passed to a lib/db function that expects one. It does not leave this file.
 */
export async function getCurrentClinicId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;

  const clinic = await getClinicByClerkOrgId(orgId);
  return clinic?.id ?? null;
}
