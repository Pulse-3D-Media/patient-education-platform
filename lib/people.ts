import { auth, clerkClient } from "@clerk/nextjs/server";
import { ADMIN_ROLE, kindFromMetadata, type Kind } from "./roles";

/**
 * The people in a clinic, read from and written to Clerk. Membership, role
 * and kind all live in Clerk, not in our database (rule 2 also keeps our
 * database free of anything about people), so this file talks to Clerk's
 * backend API and nothing here goes through lib/db.
 *
 * Takes a Clerk organization id, which only lib/clinic.ts and the admin
 * People page should be holding. Never confuse it with a clinic id.
 */

/** One person in the clinic, as the People section shows them. */
export type Person = {
  userId: string;
  /** "Jane Smith", or the email when no name is set. */
  name: string;
  email: string;
  imageUrl: string;
  role: "admin" | "member";
  kind: Kind | null;
};

/**
 * Everyone in the organization, admins first, then by name. Clerk pages the
 * list; a clinic is at most 20 people on Clerk's free plan, so one page of
 * 100 is every page there is, but the loop is here in case that changes.
 */
export async function listPeople(clerkOrgId: string): Promise<Person[]> {
  const client = await clerkClient();
  const people: Person[] = [];

  for (let offset = 0; ; offset += 100) {
    const page = await client.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
      limit: 100,
      offset,
    });

    for (const membership of page.data) {
      const user = membership.publicUserData;
      if (!user) continue;
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
      people.push({
        userId: user.userId,
        name: fullName || user.identifier,
        email: user.identifier,
        imageUrl: user.imageUrl,
        role: membership.role === ADMIN_ROLE ? "admin" : "member",
        kind: kindFromMetadata(membership.publicMetadata),
      });
    }

    if (offset + page.data.length >= page.totalCount || page.data.length === 0) break;
  }

  return people.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Record whether one person is a surgeon or staff, on their membership's
 * public metadata. Clerk merges the metadata, so any other keys (none
 * today) are left alone. Throws if the person is not in the organization.
 */
export async function setPersonKind(clerkOrgId: string, userId: string, kind: Kind) {
  const client = await clerkClient();
  await client.organizations.updateOrganizationMembershipMetadata({
    organizationId: clerkOrgId,
    userId,
    publicMetadata: { kind },
  });
}

/**
 * The signed-in person's name, for the clinic log: "Jane Smith", or their
 * email when no name is set, or null when nobody is signed in. Read from
 * Clerk on the server; never taken from anything the browser sent. It goes
 * into the log Pulse staff read, which is about staff, never patients.
 */
export async function getSignedInName(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.emailAddresses[0]?.emailAddress || userId;
}
