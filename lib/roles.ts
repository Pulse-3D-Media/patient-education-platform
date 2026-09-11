import { auth } from "@clerk/nextjs/server";

/**
 * Permission and kind. Two separate things, and they stay separate.
 *
 * PERMISSION is the Clerk organization role. Clerk's free plan has exactly
 * two roles, and we use only those (custom roles are a paid add-on):
 *
 *   org:admin   the office admin. /admin, people, branding, QR codes,
 *               billing, cancelling any link. Also everything a member can do.
 *   org:member  a surgeon or anyone else on the team. /library, and sending
 *               links to patients.
 *
 * The person who creates the clinic is its first admin; admins invite the
 * rest and choose each person's role in the People section.
 *
 * KIND says what a person is for billing: a "surgeon" is a seat the clinic
 * pays for, "staff" are free. It lives on the Clerk membership's public
 * metadata as { kind: "surgeon" | "staff" }, and it never grants a
 * permission. An admin can be a surgeon; a member can be staff.
 *
 * Every page and action checks permission on the server with these
 * helpers. Hiding a button is never the check.
 */

/** Clerk's role key for the office admin. */
export const ADMIN_ROLE = "org:admin";

export type Kind = "surgeon" | "staff";

export const KINDS: Kind[] = ["surgeon", "staff"];

/** Read a kind out of a membership's public metadata. Anything else, or nothing set yet, is null. */
export function kindFromMetadata(metadata: Record<string, unknown> | null | undefined): Kind | null {
  const value = metadata?.kind;
  return value === "surgeon" || value === "staff" ? value : null;
}

/** Turn a value from a form or a button into a Kind, or null if it is not one. */
export function parseKind(value: unknown): Kind | null {
  return value === "surgeon" || value === "staff" ? value : null;
}

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
