import { clerkClient } from "@clerk/nextjs/server";
import { askClerk } from "./clerk-timeout";
import { LOGO_KINDS, type LogoKind } from "./clinic-identity";

/**
 * The Clerk organization behind a clinic, written to from our own screens.
 *
 * A clinic's name and logo are copied from its Clerk organization on every
 * signed-in request (lib/clinic.ts), so a name or logo changed only in our
 * database would be put back on the next one. When Pulse staff rename a
 * clinic on /pulse, or an office admin renames it or uploads a logo on
 * /admin/branding, the organization is changed first, so the two stay in
 * step. Each takes a Clerk organization id, read from the clinic's own row;
 * never a clinic id, and never an id the browser sent.
 *
 * Each call has the same time limit as every other question asked of Clerk
 * (askClerk), so a slow Clerk is a plain sentence, not a form that hangs.
 */
export async function renameClerkOrganization(clerkOrgId: string, name: string) {
  const client = await clerkClient();
  await askClerk(client.organizations.updateOrganization(clerkOrgId, { name }), "renaming the clinic");
}

/**
 * Upload a logo to the organization, replacing the one it had, and return
 * the address Clerk now serves it from (or null if Clerk says the
 * organization still has no picture of its own, which would be odd).
 * The bytes have already been checked (checkLogoBytes in
 * lib/clinic-identity.ts); Clerk is told the kind those bytes are, never what
 * the browser claimed. The file goes to Clerk and nowhere else.
 */
export async function uploadClerkOrganizationLogo(
  clerkOrgId: string,
  logo: { bytes: Uint8Array; kind: LogoKind },
  uploaderUserId: string,
): Promise<{ logoUrl: string | null }> {
  const { mimeType, extension } = LOGO_KINDS[logo.kind];
  const file = new File([logo.bytes as Uint8Array<ArrayBuffer>], `logo.${extension}`, { type: mimeType });
  const client = await clerkClient();
  const organization = await askClerk(
    client.organizations.updateOrganizationLogo(clerkOrgId, { file, uploaderUserId }),
    "uploading the clinic logo",
    // An upload takes longer than a question.
    20_000,
  );
  return { logoUrl: organization.hasImage ? organization.imageUrl : null };
}
