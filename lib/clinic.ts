import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readBranding, type Branding } from "./branding";
import { clinicIsOpen } from "./clinic-status";
import { getClinicByClerkOrgId, upsertClinicForClerkOrg } from "./db/clinics";
import { ADMIN_ROLE, isClinicAdmin } from "./roles";
import type { ClinicStatus, PracticeType } from "@prisma/client";

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
  /** When a PAST_DUE clinic's grace period ends; null otherwise. Read by clinicIsOpen(). */
  graceEndsAt: Date | null;
  /** What kind of practice this is, for billing. UNKNOWN until the clinic's admin answers on /admin/billing. */
  practiceType: PracticeType;
  logoUrl: string | null;
  /** A line Pulse staff want shown at the top of this clinic's admin console, or null. */
  noticeText: string | null;
  /** False when Pulse staff have hidden placeholder videos from this clinic's library. */
  showPlaceholders: boolean;
  /** The clinic's phone as ten digits, or null. Shown to patients as a tap-to-call link. */
  phone: string | null;
  /** The clinic's brand colour and font, already checked (lib/branding.ts). A clinic that set nothing has the Pulse look. */
  branding: Branding;
  /** True when the logo is the one uploaded to the clinic's Clerk organization, false when Pulse staff set it (or there is none). */
  logoIsFromClerk: boolean;
  /** Is this person the clinic's account owner (Clinic.ownerClerkUserId)? See lib/seats.ts. */
  isOwner: boolean;
  /** Is this person an org:admin of the clinic? */
  isAdmin: boolean;
};

/**
 * Who created a Clerk organization, to record as the new clinic's account
 * owner. Clerk's organization carries its creator; when that is missing, the
 * person signed in counts only if they are an admin of an organization with
 * nobody else in it yet, which is exactly the moment after they created it.
 * Otherwise nobody, and Pulse staff set the owner on /pulse.
 */
function creatorOf(organization: { createdBy?: string | null; membersCount?: number | null }, userId: string, isAdmin: boolean): string | null {
  if (organization.createdBy) return organization.createdBy;
  return isAdmin && organization.membersCount === 1 ? userId : null;
}

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
  const isAdmin = has({ role: ADMIN_ROLE });
  const clinic = await upsertClinicForClerkOrg(orgId, {
    name: organization.name,
    // Clerk gives every organization an image address; hasImage says whether
    // it is a real uploaded logo or the generated initials. Only a real logo
    // is kept.
    logoUrl: organization.hasImage ? organization.imageUrl : null,
    // Only used if this visit creates the clinic.
    creatorClerkUserId: creatorOf(organization, userId, isAdmin),
  });

  return {
    id: clinic.id,
    name: clinic.name,
    status: clinic.status,
    graceEndsAt: clinic.graceEndsAt,
    practiceType: clinic.practiceType,
    logoUrl: clinic.logoUrl,
    noticeText: clinic.noticeText,
    showPlaceholders: clinic.showPlaceholders,
    phone: clinic.phone,
    branding: readBranding(clinic),
    logoIsFromClerk: organization.hasImage,
    isOwner: clinic.ownerClerkUserId === userId,
    isAdmin,
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
  if (!clinic || !clinicIsOpen(clinic)) return null;
  return clinic.id;
}

/**
 * The id of the current clinic for a BILLING action, which has to work for
 * a clinic that is not open: Billing is the page a closed clinic's admin
 * comes to in order to fix things. So this checks that the person is an
 * office admin and deliberately does NOT check clinicIsOpen(). Nothing but
 * the actions under app/admin/billing may use it; everything else uses
 * getCurrentClinicId() above, which stays as strict as it was.
 *
 * Null means: signed out, no active organization, or not an admin.
 */
export async function getBillingClinicId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  if (!(await isClinicAdmin())) return null;

  const clinic = (await getClinicByClerkOrgId(orgId)) ?? (await getCurrentClinic());
  return clinic?.id ?? null;
}

/**
 * What every staff page calls first. Makes sure someone is signed in and has
 * a clinic, sending them to the right step if not:
 *
 *   signed out            -> /sign-in (and back here afterwards)
 *   no clinic yet         -> /onboarding, to create or choose one
 *
 * (There is no surgeon-or-staff question any more: everyone but the account
 * owner holds a seat. See lib/seats.ts.)
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

  return clinic;
}
