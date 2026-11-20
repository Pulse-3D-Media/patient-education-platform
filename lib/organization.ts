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
 *
 * NO UPLOADER IS NAMED (fixed 2026-11-19). Clerk's call takes an optional
 * uploaderUserId, and with one Clerk checks that person's organization
 * permissions itself: on our Clerk instance it refused with 403
 * "missing_organization_permission" even for the admin who created the
 * organization, so every logo upload failed (tried against Clerk's
 * development instance with a made-up organization; without the uploader the
 * same upload succeeded). Who may upload is decided here, not by Clerk: the
 * action has already asked Clerk, live, that the person is an admin of this
 * clinic (confirmAdminWithClerk), and the upload is logged under their name.
 */
export async function uploadClerkOrganizationLogo(clerkOrgId: string, logo: { bytes: Uint8Array; kind: LogoKind }): Promise<{ logoUrl: string | null }> {
  const { mimeType, extension } = LOGO_KINDS[logo.kind];
  const file = new File([logo.bytes as Uint8Array<ArrayBuffer>], `logo.${extension}`, { type: mimeType });
  const client = await clerkClient();
  const organization = await askClerk(
    client.organizations.updateOrganizationLogo(clerkOrgId, { file }),
    "uploading the clinic logo",
    // An upload takes longer than a question.
    20_000,
  );
  return { logoUrl: organization.hasImage ? organization.imageUrl : null };
}
