/**
 * The clinic's name and logo, as an office admin changes them on
 * /admin/branding. The plain rules both sides share, safe for the browser:
 * the form checks a file and a name with these before sending, and the
 * server checks again with the same ones (rule 8), because what the browser
 * says about a file is only a claim.
 *
 * WHERE THEY LIVE. The name and the logo belong to the clinic's Clerk
 * organization, and our database keeps a copy (Clinic.name, Clinic.logoUrl)
 * that lib/clinic.ts refreshes on every signed-in request. So a new name is
 * written to Clerk (renameClerkOrganization in lib/organization.ts) and a
 * new logo is uploaded to Clerk (uploadClerkOrganizationLogo), and only then
 * copied onto our row with a log entry. There is no file storage of our
 * own: Clerk is the one logo store.
 *
 * Pure: no database, no Clerk.
 */

/** The largest logo accepted: 1 MB. It also keeps the upload under the 1 MiB a Server Action may receive. */
export const LOGO_MAX_BYTES = 1_000_000;

/** "1 MB", for the sentences. */
export const LOGO_MAX_WORDS = "1 MB";

/** The three kinds of picture accepted, with what Clerk is told the file is. */
export const LOGO_KINDS = {
  png: { mimeType: "image/png", extension: "png", words: "PNG" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg", words: "JPG" },
  webp: { mimeType: "image/webp", extension: "webp", words: "WebP" },
} as const;

export type LogoKind = keyof typeof LOGO_KINDS;

/** What the file box offers to choose from. A courtesy: the server reads the bytes. */
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

/** The longest clinic name accepted. It shows on the banner, the patient page and the video. */
export const CLINIC_NAME_MAX = 100;

/**
 * What kind of picture these bytes are, by their first few bytes (every PNG,
 * JPG and WebP file starts with a fixed signature), or null for anything
 * else. The file's name and the type the browser claims are never trusted:
 * a text file renamed "logo.png" is still a text file.
 */
export function sniffLogoKind(bytes: Uint8Array): LogoKind | null {
  const starts = (signature: number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);

  // PNG: 89 "PNG" CR LF 1A LF.
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // JPG: FF D8 FF.
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  // WebP: "RIFF", four bytes of length, then "WEBP".
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

/** The sentence for a file that is too big. */
export const LOGO_TOO_LARGE = `That picture is too big. Choose one of ${LOGO_MAX_WORDS} or less.`;

/** The sentence for a file that is not one of the three kinds. */
export const LOGO_WRONG_KIND = "That file is not a PNG, JPG or WebP picture. Choose one of those.";

/** The sentence for no file at all. */
export const LOGO_MISSING = "Choose a picture first.";

/**
 * A logo file's size checked before anything is read: the browser asks this
 * before sending, and the server before reading the bytes.
 */
export function checkLogoSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return LOGO_MISSING;
  if (size > LOGO_MAX_BYTES) return LOGO_TOO_LARGE;
  return null;
}

/** A logo's bytes checked: the right size and one of the three kinds. */
export function checkLogoBytes(bytes: Uint8Array): { kind: LogoKind } | { error: string } {
  const sizeProblem = checkLogoSize(bytes.byteLength);
  if (sizeProblem) return { error: sizeProblem };
  const kind = sniffLogoKind(bytes);
  if (!kind) return { error: LOGO_WRONG_KIND };
  return { kind };
}

/**
 * A clinic name as typed, tidied (spaces at the ends trimmed, runs of spaces
 * made one), or the sentence saying what to fix. Refuses an empty name, one
 * that is too long, and one with a line break, a tab or another control
 * character, which would break the banner and the log.
 */
export function readClinicName(text: string): { name: string } | { error: string } {
  if (/[\u0000-\u001f\u007f]/.test(text)) return { error: "Keep the clinic name on one line." };
  const name = text.trim().replace(/ {2,}/g, " ");
  if (!name) return { error: "The clinic needs a name." };
  if (name.length > CLINIC_NAME_MAX) return { error: `Keep the clinic name to ${CLINIC_NAME_MAX} characters or fewer.` };
  return { name };
}
