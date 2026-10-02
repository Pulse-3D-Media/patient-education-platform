/**
 * The name a patient sees on a link: "Sent by Dr. Jane Smith, Summit
 * Orthopedics". Pure: no database, no Clerk, safe for the browser, so the
 * People page's form and the server that saves it check names the same way.
 *
 * WHERE THE NAME COMES FROM, first match wins:
 *   1. the name an admin typed for that person on /admin/people (stored on
 *      their seat, SeatAllocation.displayName), for a PA, an NP, or a
 *      preferred name;
 *   2. "Dr. " and their first and last name from Clerk;
 *   3. nothing, when Clerk has no name for them either. The link then says
 *      only which clinic sent it, as links always did. Their email address
 *      is never used: it is not a name, and patients have no need of it.
 *
 * The name is copied onto the link when the link is made (Share.senderName),
 * so a later change, or the surgeon leaving, never changes a link already
 * sent. It is staff data, not patient data: rule 2 allows it.
 */

/** One person a link can be from, as the Shared links picker shows them (lib/senders.ts builds the list on the server). */
export type Sender = {
  userId: string;
  /** Their name for the office: "Jane Smith", or their email when Clerk has no name. Never shown to patients. */
  name: string;
  /** What patients will see: the name typed for them on People, else "Dr. First Last", else null (the link then names only the clinic). */
  patientName: string | null;
};

/** The longest name that can be typed. Long enough for "Dr. Maria de los Angeles Fernandez-Castillo, DNP, APRN". */
export const MAX_DISPLAY_NAME = 80;

/**
 * "Dr. Jane Smith" from a first and a last name, or null when both are empty.
 * A first name that already starts with "Dr" is not given a second one.
 */
export function defaultSenderName(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  const full = [firstName, lastName]
    .map((part) => (typeof part === "string" ? tidy(part) : ""))
    .filter(Boolean)
    .join(" ");
  if (!full) return null;
  const name = /^dr\.?(\s|$)/i.test(full) ? full : `Dr. ${full}`;
  return name.slice(0, MAX_DISPLAY_NAME);
}

/**
 * What an admin typed as a person's name for patients, checked.
 *   { ok: true, name: "Jane Smith, PA-C" }  a name to store
 *   { ok: true, name: null }                 the box was left empty: go back to the default
 *   { ok: false, message }                   refused, with the sentence to show
 */
export function parseDisplayName(value: unknown): { ok: true; name: string | null } | { ok: false; message: string } {
  if (value === null || value === undefined) return { ok: true, name: null };
  if (typeof value !== "string") return { ok: false, message: "Type the name as patients should see it." };
  const name = tidy(value);
  if (!name) return { ok: true, name: null };
  if (name.length > MAX_DISPLAY_NAME) return { ok: false, message: `Keep the name to ${MAX_DISPLAY_NAME} characters or fewer.` };
  // Letters of any language, spaces, and the punctuation names and titles use. No angle brackets, links or symbols.
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .,'’()-]*$/u.test(name)) {
    return { ok: false, message: "Use letters, spaces and . , ' - ( ) only, starting with a letter. For example: Jane Smith, PA-C" };
  }
  return { ok: true, name };
}

/** The name shown for a seated person: the one typed for them, else the default, else null. */
export function effectiveSenderName(displayName: string | null | undefined, defaultName: string | null | undefined): string | null {
  return displayName || defaultName || null;
}

/**
 * The line near the top of the patient page and on the pamphlet:
 * "Sent by Dr. Jane Smith, Summit Orthopedics", or "From Summit
 * Orthopedics" for a link with no name on it (every link made before
 * surgeons were recorded).
 */
export function sentByLine(senderName: string | null | undefined, clinicName: string): string {
  return senderName ? `Sent by ${senderName}, ${clinicName}` : `From ${clinicName}`;
}

/** Trim, and turn runs of spaces, tabs and line breaks into single spaces. Control characters go too. */
function tidy(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
