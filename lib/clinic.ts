import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clinicIsOpen } from "./clinic-status";
import { getClinicByClerkOrgId, upsertClinicForClerkOrg } from "./db/clinics";
import { ADMIN_ROLE, kindFromMetadata, type Kind } from "./roles";
import type { ClinicStatus } from "@prisma/client";

/**
 * Which clinic is using the app right now, and who in it.
 *
 * The signed-in user's active Clerk organization is the clinic. This file
 * is the only place the signed-in user meets the database: every lib/db
 * function that touches clinic data takes the clinic id these functions
 * return, and a Clerk organization id (org_...) never leaves this file.
 */

/** The clinic behind the current request, plus the signed-in person's place in it. */
export type CurrentClinic = {
  id: string;
  name: string;
  status: ClinicStatus;
  logoUrl: string | null;
  /** Surgeon or staff, or null if this person has not been asked yet. See lib/roles.ts. */
  kind: Kind | null;
  /** Is this person an org:admin of the clinic? */
  isAdmin: boolean;
};

/**
 * The clinic for the signed-in user's active organization, creating it on
 * first use and keeping its name and logo in step with Clerk.
 *
 * One call to Clerk per request: the user's membership in the organization,
 * which carries the organization (name, logo), the role, and the public
 * metadata where kind lives. Then one upsert (see lib/db/clinics.ts), which
 * writes nothing when nothing has changed. Wrapped in React's cache() so a
 * page that asks twice in one request pays once.
 *
 * Returns null, never throws, when nobody is signed in, when the session is
 * still "pending" (Clerk treats a session with an unfinished task, such as
 * choosing an organization, as signed out), when no organization is active,
 * or when the user is no longer a member of the active one. The caller
 * decides what to show; pages send those people to /onboarding.
 */
export const getCurrentClinic = cache(async (): Promise<CurrentClinic | null> => {
  const { userId, orgId, has } = await auth();
  if (!userId || !orgId) return null;

  const client = await clerkClient();
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    userId: [userId],
    limit: 1,
  });
  const membership = memberships.data[0];
  if (!membership) return null;

  const organization = membership.organization;
  const clinic = await upsertClinicForClerkOrg(orgId, {
    name: organization.name,
    // Clerk gives every organization an image address; hasImage says whether
    // it is a real uploaded logo or the generated initials. Only a real logo
    // is kept.
    logoUrl: organization.hasImage ? organization.imageUrl : null,
  });

  return {
    id: clinic.id,
    name: clinic.name,
    status: clinic.status,
    logoUrl: clinic.logoUrl,
    kind: kindFromMetadata(membership.publicMetadata),
    isAdmin: has({ role: ADMIN_ROLE }),
  };
});

/**
 * The id of the current clinic, for Server Actions and Route Handlers, but
 * only when that clinic is open (see clinicIsOpen). Null means: signed out,
 * no active organization, or a clinic that may not use the library right
 * now. Callers return a plain message on null; they never crash.
 *
 * Cheaper than getCurrentClinic(): a database lookup and no call to Clerk,
 * because an action never needs the name or logo. If the row does not exist
 * yet (the person's very first request happens to be an action) it falls
 * back to getCurrentClinic(), which creates it.
 */
export async function getCurrentClinicId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;

  const clinic = (await getClinicByClerkOrgId(orgId)) ?? (await getCurrentClinic());
  if (!clinic || !clinicIsOpen(clinic.status)) return null;
  return clinic.id;
}

/**
 * What every staff page calls first. Makes sure someone is signed in, has a
 * clinic, and has answered the surgeon-or-staff question, sending them to
 * the right step if not:
 *
 *   signed out            -> /sign-in (and back here afterwards)
 *   no clinic yet         -> /onboarding, to create or choose one
 *   kind not answered     -> /onboarding/kind, asked once
 *
 * Returns the clinic otherwise. It does NOT check that the clinic is open:
 * a PENDING clinic reaches the page and the page shows it the "choose a
 * plan" screen, so each page decides that with clinicIsOpen(). It does not
 * check permission either; admin pages call isClinicAdmin() themselves.
 */
export async function requireClinicPage(): Promise<CurrentClinic> {
  await auth.protect();

  const clinic = await getCurrentClinic();
  if (!clinic) redirect("/onboarding");
  if (!clinic.kind) redirect("/onboarding/kind");

  return clinic;
}
