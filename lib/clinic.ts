import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { readBranding, type Branding } from "./branding";
import { askClerk } from "./clerk-timeout";
import { clinicIsOpen } from "./clinic-status";
import { getClinicByClerkOrgId, upsertClinicForClerkOrg } from "./db/clinics";
import { getSeatClinic } from "./db/seats";
import { getMember } from "./people";
import { ADMIN_ROLE, isClinicAdmin } from "./roles";
import { defaultSenderName } from "./sender-name";
import type { ClinicStatus, PracticeType } from "@prisma/client";
import type { Category } from "./categories";
import { DEFAULT_CATEGORY_LIST } from "./categories";
import { getCategoryList } from "./db/category-config";
import { errorKind } from "./error-kind";

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
  /**
   * "Dr. First Last" for the signed-in person, from the name Clerk already sent with their membership (no
   * extra call), or null when Clerk has none. What patients see on their links when nobody has chosen a name
   * for them; the library's player shows it on the strip (lib/sender-name.ts).
   */
  defaultPatientName: string | null;
  /**
   * The categories on the clinic's plan, in list order with their current names and addresses (Pulse staff can
   * change them on /pulse/videos), for the sidebar and the drawer (navigation only, so a courtesy: what a page may
   * show is always decided from getClinicAccess() and the access rule).
   */
  planCategories: { value: Category; label: string; slug: string }[];
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
 *
 * The one thing it does throw: SignInUnavailableError (lib/clerk-timeout.ts)
 * when Clerk does not answer within its time limit, or answers with a
 * failure. The error pages recognise that and show "We could not reach
 * sign-in just now" with a Try again button, so a slow Clerk never leaves
 * a staff page loading forever. React's cache() remembers the failure too,
 * so a layout and its page asking in the same request wait once, not twice.
 */
export const getCurrentClinic = cache(async (): Promise<CurrentClinic | null> => {
  const { userId, orgId, has } = await auth();
  if (!userId || !orgId) return null;

  const client = await clerkClient();
  const memberships = await askClerk(
    client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      userId: [userId],
      limit: 1,
    }),
    "the clinic membership",
  );
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

  // The names for the navigation. If they cannot be read, the starting names stand in: the shell must still be drawn.
  const list = await getCategoryList().catch((error: unknown) => {
    console.error("Category list for the shell could not be read", errorKind(error));
    return DEFAULT_CATEGORY_LIST;
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
    defaultPatientName: defaultSenderName(membership.publicUserData?.firstName, membership.publicUserData?.lastName),
    planCategories: list
      .filter((category) => clinic.categories.includes(category.value))
      .map((category) => ({ value: category.value, label: category.label, slug: category.slug })),
  };
});

/**
 * The clinic for the app shell (the layouts of /library and /admin), or
 * null when it cannot be read right now: sign-in did not answer, or the
 * database did not. A layout must not fail on that, or the person would
 * get a bare page with no banner and no way back. So the layout draws the
 * plain Pulse shell instead, and the page inside asks getCurrentClinic()
 * again: the answer is cached for the request, so the page fails the same
 * way at once, and its own error page (error.tsx next to it) says what
 * happened, inside the shell, with Try again.
 *
 * Only for a layout's looks. Never for deciding what a person may do.
 */
export async function getClinicForShell(): Promise<CurrentClinic | null> {
  try {
    return await getCurrentClinic();
  } catch (error) {
    // Next.js signals a redirect, a not-found and "this needs the request"
    // by throwing errors of its own. Those are not failures and must reach
    // Next.js; this hands them back before treating anything else as one.
    unstable_rethrow(error);
    return null;
  }
}

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

/** What confirmAdminWithClerk() answers. `name` is the person's name as Clerk has it now, for the clinic log. */
export type LiveAdminCheck = { ok: true; userId: string; name: string } | { ok: false; reason: "not-admin" | "unreachable" };

/** The sentence an action shows when Clerk could not be asked. Nothing was changed. */
export const ADMIN_CHECK_UNREACHABLE =
  "We could not reach sign-in just now to confirm you are still an office admin, so nothing was changed. Try again in a moment.";

/**
 * Ask Clerk, live, whether the signed-in person is STILL an admin of this
 * clinic's organization. Used right before the highest-impact changes only:
 * people changes, billing changes, retiring or replacing a printed QR code,
 * and turning a paused link back on.
 *
 * Why it is needed: isClinicAdmin() and the clinic come from Clerk's session
 * token, which the browser refreshes about once a minute. An admin who has
 * just been switched to a plain member, or removed from the clinic, keeps a
 * token that still says "admin" until it refreshes. For most things that
 * minute does not matter; for these it might. So these actions ask Clerk
 * itself (one membership lookup of this person in this clinic's own
 * organization, read from the clinic's row, never from the browser).
 *
 * The cost is one extra round trip to Clerk, usually well under half a
 * second, with the usual five-second limit (askClerk). Where an action
 * already asked Clerk for the person's name, this answer carries the name
 * instead, so that action makes no extra call at all. It is never used on
 * the exam room's Send path (the speed rule).
 *
 * Fails closed: Clerk slow or failing is "unreachable", and the action
 * changes nothing and says ADMIN_CHECK_UNREACHABLE.
 */
export async function confirmAdminWithClerk(clinicId: string): Promise<LiveAdminCheck> {
  const { userId } = await auth();
  if (!userId) return { ok: false, reason: "not-admin" };
  const clinic = await getSeatClinic(clinicId);
  if (!clinic?.clerkOrgId) return { ok: false, reason: "not-admin" };
  try {
    const member = await getMember(clinic.clerkOrgId, userId);
    if (!member || member.role !== "admin") return { ok: false, reason: "not-admin" };
    return { ok: true, userId, name: member.name };
  } catch (error) {
    // getMember's call has the time limit; a timeout or a failure arrives here. The kind only, for the log.
    console.error("The live admin check could not reach Clerk", errorKind(error));
    return { ok: false, reason: "unreachable" };
  }
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
