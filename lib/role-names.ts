/**
 * The two roles, their Clerk keys and their words. Pure and safe for the
 * browser, so the People page's buttons can use the same words as the
 * server. The server check itself, isClinicAdmin(), is in lib/roles.ts,
 * which the browser must never import.
 */

/** Clerk's role key for an admin. */
export const ADMIN_ROLE = "org:admin";

/** Clerk's role key for a member without admin. */
export const MEMBER_ROLE = "org:member";

export type Role = "admin" | "member";

/** Clerk's role key for one of our two roles. */
export function clerkRole(role: Role): string {
  return role === "admin" ? ADMIN_ROLE : MEMBER_ROLE;
}

/** Turn a value from a form or a button into a Role, or null if it is not one. */
export function parseRole(value: unknown): Role | null {
  return value === "admin" || value === "member" ? value : null;
}

/** The words the People page uses for each role. */
export const ROLE_WORDS: Record<Role, string> = {
  admin: "Member with admin",
  member: "Member",
};
