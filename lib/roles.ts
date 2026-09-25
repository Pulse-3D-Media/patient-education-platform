import { auth } from "@clerk/nextjs/server";
import { ADMIN_ROLE } from "./role-names";

export { ADMIN_ROLE, MEMBER_ROLE, ROLE_WORDS, clerkRole, parseRole, type Role } from "./role-names";

/**
 * Permission. What a person may DO in their clinic is their Clerk
 * organization role. Clerk's free plan has exactly two roles, and we use only
 * those (custom roles are a paid add-on):
 *
 *   org:admin   "Member with admin". The library, plus /admin: people,
 *               branding, QR codes, billing, cancelling any link.
 *   org:member  "Member". The library, and sending links to patients.
 *
 * Seats are a separate thing and never grant a permission: everyone but the
 * account owner holds one of the seats the clinic pays for (lib/seats.ts),
 * whichever role they have, and switching admin on or off never changes the
 * seat count. The account owner (Clinic.ownerClerkUserId) is always an admin.
 *
 * Every page and action checks permission on the server with isClinicAdmin().
 * Hiding a button is never the check. Server only: the role names the
 * browser needs are in lib/role-names.ts.
 */

/**
 * Is the signed-in user an admin of their active organization?
 * False when signed out, when no organization is active, or when they are a
 * plain member. Reads the session on the server; nothing from the browser
 * is trusted.
 */
export async function isClinicAdmin(): Promise<boolean> {
  const { orgId, has } = await auth();
  return Boolean(orgId) && has({ role: ADMIN_ROLE });
}
