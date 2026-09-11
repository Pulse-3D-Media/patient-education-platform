import { clerkClient } from "@clerk/nextjs/server";

/**
 * The Clerk organization behind a clinic, written to from the Pulse side.
 *
 * A clinic's name is copied from its Clerk organization on every sign-in
 * (lib/clinic.ts), so a name changed only in our database would be put
 * back the next time anyone from the clinic signed in. When Pulse staff
 * rename a clinic on /pulse, the organization is renamed too, so the two
 * stay in step. Takes a Clerk organization id; never a clinic id.
 */
export async function renameClerkOrganization(clerkOrgId: string, name: string) {
  const client = await clerkClient();
  await client.organizations.updateOrganization(clerkOrgId, { name });
}
