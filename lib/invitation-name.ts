/**
 * The clinic's name on an invited person's sign-up page (Evan, 2026-11-20:
 * "can we have this say accept your invitation to join (said clinic) so they
 * don't get confused?"). Pure: no database, no Clerk, safe for the browser.
 *
 * HOW THE PAGE KNOWS THE NAME: when the server sends an invitation, it puts
 * the clinic's name in the invitation's own accept address
 * (/sign-up?clinic=<name>), which Clerk sends the person back to with the
 * invitation's ticket added. The sign-up page reads it back and shows it in
 * the heading, "Accept your invitation to join <name>."
 *
 * DISPLAY TEXT ONLY, NEVER AN IDENTITY. Anyone can type an address, so the
 * name decides nothing: which clinic the person joins is the invitation
 * ticket's, checked by Clerk. The page shows it only when the visit also
 * carries an invitation, cleans it (no control characters, spaces tidied, at
 * most 80 characters), and React writes it as text. When there is no name,
 * or it is not usable, the heading is simply "Accept your invitation."
 */

/** The name of the address parameter that carries the clinic's name. */
export const INVITED_CLINIC_PARAM = "clinic";

/** The longest name the heading shows. Longer is not shown at all (the plain heading instead). */
export const INVITED_CLINIC_MAX = 80;

/** The accept address for one invitation: the deployment's /sign-up with the clinic's name added. `signUpUrl` is chosen by the server, never by the browser. */
export function invitationAcceptUrl(signUpUrl: string, clinicName: string | null | undefined): string {
  const name = readInvitedClinicName(clinicName);
  if (!name) return signUpUrl;
  const url = new URL(signUpUrl);
  url.searchParams.set(INVITED_CLINIC_PARAM, name);
  return url.toString();
}

/** The clinic's name from an address, cleaned, or null when there is none or it is not usable. */
export function readInvitedClinicName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters out, runs of spaces (and line breaks) made one space.
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > INVITED_CLINIC_MAX) return null;
  return name;
}

/** The heading over an invited person's sign-up box. */
export function invitationHeading(clinicName: string | null): string {
  return clinicName ? `Accept your invitation to join ${clinicName}.` : "Accept your invitation.";
}
