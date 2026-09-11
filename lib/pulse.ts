import { auth, clerkClient } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { cache } from "react";

/**
 * Who may open /pulse, the Pulse 3D master dashboard.
 *
 * This is the one gate. A person is Pulse staff when their Clerk user has
 * `pulseStaff: true` in its public metadata, which is set by hand in the
 * Clerk dashboard (Users, pick the user, Metadata, Public) and nowhere else.
 * There is no way to grant it from inside the app, on purpose.
 *
 * It is read on the server from Clerk's backend API, never from anything
 * the browser sends, and never from the session token alone: the token is
 * only refreshed every so often, and a change made in the Clerk dashboard
 * should take effect on the next request, not the next sign-in.
 *
 * Every page and every Server Action under app/pulse calls one of these
 * first. Anyone else gets not-found, the same page a wrong address gets, so
 * the dashboard's existence is not confirmed to people who cannot use it.
 */

/** The signed-in staff member, for recording who did something. */
export type PulseStaffUser = {
  userId: string;
  /** "Evan Miller", or the email when no name is set, or the user id as a last resort. */
  name: string;
};

/** Is this metadata a Pulse staff mark? Only the exact boolean true counts. */
export function pulseStaffFromMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.pulseStaff === true;
}

/**
 * The signed-in user if they are Pulse staff, otherwise null. Never throws
 * for a signed-out or ordinary user. Cached for the length of one request,
 * so a page that asks and then its actions ask again pay for one Clerk call.
 */
export const getPulseStaffUser = cache(async (): Promise<PulseStaffUser | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (!pulseStaffFromMetadata(user.publicMetadata)) return null;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const email = user.emailAddresses[0]?.emailAddress;
  return { userId, name: fullName || email || userId };
});

/** True only for a signed-in user whose Clerk public metadata has pulseStaff: true. */
export async function isPulseStaff(): Promise<boolean> {
  return (await getPulseStaffUser()) !== null;
}

/**
 * What every page and action under /pulse calls first. Returns the staff
 * user, or ends the request with not-found for anyone else. Not a redirect
 * and not a message: someone who is not staff learns nothing.
 */
export async function requirePulseStaff(): Promise<PulseStaffUser> {
  const staff = await getPulseStaffUser();
  if (!staff) notFound();
  return staff;
}
