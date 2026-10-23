/**
 * The address /sign-up hands a person to when Clerk says their invitation
 * belongs to an account they already have (__clerk_status=sign_in). Pure.
 *
 * Only Clerk's two invitation parameters travel on to /sign-in, unchanged:
 * the status and the ticket. Anything else in the address (a redirect_url
 * someone added, junk, a repeated parameter) is left behind, so the link in
 * an invitation email cannot be dressed up to carry something else across.
 */
const FORWARDED = ["__clerk_status", "__clerk_ticket"] as const;

export function signInHandoffHref(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = params[key];
    if (typeof value === "string") query.set(key, value);
  }
  return `/sign-in?${query.toString()}`;
}
