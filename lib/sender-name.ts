/**
 * The name a patient sees on a link: "Sent by Dr. Jane Smith, DO, Summit
 * Orthopedics". Pure: no database, no Clerk, safe for the browser, so the
 * name editor (on People, and in the library's Send panel) and the server
 * that saves it check names the same way.
 *
 * WHERE THE NAME COMES FROM, first match wins:
 *   1. the name chosen for that person (stored on their seat,
 *      SeatAllocation.displayName), set by an office admin on /admin/people
 *      or by the person themselves from the library's Send panel;
 *   2. "Dr. " and their first and last name from Clerk, for someone nobody
 *      has chosen a name for yet;
 *   3. nothing, when Clerk has no name for them either. The link then says
 *      only which clinic sent it, as links always did. Their email address
 *      is never used: it is not a name, and patients have no need of it.
 *
 * HOW A CHOSEN NAME IS MADE (decided by Evan on 2026-10-02): a name box that
 * holds only the name, and a credential from a short list. MD, DO and DPM
 * also put "Dr." in front; the others do not:
 *
 *   MD, DO, DPM   "Dr. Jane Smith, DO"
 *   PA-C, NP      "Jane Smith, PA-C"
 *   Other         "Jane Smith, LAc"   (a short credential typed in, no "Dr.")
 *   None          "Jane Smith"
 *
 * The finished words are what is stored, so nothing in the database changed
 * for this. readSenderName() turns stored words back into the choice that
 * made them, so the editor opens on what was saved. Because the name box
 * refuses a comma and a leading "Dr", the "Dr." and the credential can only
 * come from the list, never be typed twice, and reading back always finds
 * the same choice (lib/sender-name.test.ts checks every kind).
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
  /** What patients will see: the name chosen for them, else "Dr. First Last", else null (the link then names only the clinic). */
  patientName: string | null;
};

/** The longest finished name. Long enough for "Dr. Maria de los Angeles Fernandez-Castillo, DPM". */
export const MAX_DISPLAY_NAME = 80;

/** The longest credential that can be typed under Other ("APRN-CNP" is 8). */
export const MAX_OTHER_CREDENTIAL = 12;

/** The credentials in the list, in the order the dropdown shows them. */
export const CREDENTIALS = ["MD", "DO", "DPM", "PA-C", "NP"] as const;
export type Credential = (typeof CREDENTIALS)[number];

/** What the dropdown can hold: a listed credential, Other, None, or "" for nothing chosen yet. */
export type CredentialPick = Credential | "other" | "none" | "";

/** The three that put "Dr." in front of the name. */
const DOCTOR_CREDENTIALS: readonly string[] = ["MD", "DO", "DPM"];

/** The dropdown's choices and their words. "" is the "Choose..." line, so nothing is picked for anyone in advance. */
export const CREDENTIAL_CHOICES: { value: Exclude<CredentialPick, "">; label: string }[] = [
  { value: "MD", label: "MD (adds Dr.)" },
  { value: "DO", label: "DO (adds Dr.)" },
  { value: "DPM", label: "DPM (adds Dr.)" },
  { value: "PA-C", label: "PA-C" },
  { value: "NP", label: "NP" },
  { value: "other", label: "Other (type it)" },
  { value: "none", label: "None" },
];

/** A name and a credential, as the editor holds them. `other` is the typed credential, used only when `credential` is "other". */
export type NameChoice = { name: string; credential: CredentialPick; other: string };

/** Does this credential put "Dr." in front of the name? */
export function addsDoctor(credential: CredentialPick): boolean {
  return DOCTOR_CREDENTIALS.includes(credential);
}

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
 * The finished words for a choice: "Dr. Jane Smith, DO". Assumes the choice
 * has been checked (parseNameChoice); it only puts the pieces together.
 */
export function buildSenderName(choice: NameChoice): string {
  const name = tidy(choice.name);
  const suffix = choice.credential === "other" ? tidy(choice.other) : choice.credential === "none" || choice.credential === "" ? "" : choice.credential;
  return `${addsDoctor(choice.credential) ? "Dr. " : ""}${name}${suffix ? `, ${suffix}` : ""}`;
}

/**
 * What was sent from the name editor, checked, and the words it makes.
 *   { ok: true, choice, words: "Dr. Jane Smith, DO" }  to store
 *   { ok: false, message }                            refused, with the sentence to show
 * The server runs this on whatever the browser sent; the editor runs it too,
 * but only to show the words before saving.
 */
export function parseNameChoice(value: unknown): { ok: true; choice: NameChoice; words: string } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null) return { ok: false, message: "Type the name and choose a credential." };
  const sent = value as Record<string, unknown>;

  if (typeof sent.name !== "string") return { ok: false, message: "Type the name as patients should see it." };
  const name = tidy(sent.name);
  if (!name) return { ok: false, message: "Type the name, for example Jane Smith." };
  if (/^dr\b/i.test(name)) return { ok: false, message: 'Leave "Dr." out of the name box. Choosing MD, DO or DPM adds it.' };
  if (name.includes(",")) return { ok: false, message: "Type only the name in the name box, with no comma. Choose the credential from the list." };
  // Letters of any language, spaces, and the punctuation names use. No angle brackets, links, digits or symbols.
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’()-]*$/u.test(name)) {
    return { ok: false, message: "Use letters, spaces and . ' - ( ) only in the name, starting with a letter. For example: Jane Smith" };
  }

  const credential = sent.credential;
  if (typeof credential !== "string" || !CREDENTIAL_CHOICES.some((choice) => choice.value === credential)) {
    return { ok: false, message: "Choose a credential, or None." };
  }

  let other = "";
  if (credential === "other") {
    other = typeof sent.other === "string" ? tidy(sent.other) : "";
    if (!other) return { ok: false, message: "Type the credential, for example LAc or APRN-CNP." };
    if (other.length > MAX_OTHER_CREDENTIAL) return { ok: false, message: `Keep the credential to ${MAX_OTHER_CREDENTIAL} characters or fewer.` };
    if (!OTHER_CREDENTIAL.test(other)) return { ok: false, message: "Use letters and hyphens only in the credential, starting with a letter. For example: LAc or APRN-CNP" };
    const listed = CREDENTIALS.find((listedOne) => listedOne.toLowerCase() === other.toLowerCase());
    if (listed) return { ok: false, message: `${listed} is in the list. Choose it there.` };
  }

  const choice: NameChoice = { name, credential: credential as CredentialPick, other };
  const words = buildSenderName(choice);
  if (words.length > MAX_DISPLAY_NAME) return { ok: false, message: `Keep the whole name to ${MAX_DISPLAY_NAME} characters or fewer.` };
  return { ok: true, choice, words };
}

/**
 * Stored words back into the choice that made them, for the editor to open
 * on. `exact` is true when saving that choice gives back exactly these words.
 * It is false for a name nobody has chosen yet (the "Dr. First Last"
 * default, which has no credential) and for a name typed before the
 * credential list existed; the editor then opens on its best reading, with
 * the credential left to choose where it cannot tell.
 */
export function readSenderName(words: string | null | undefined): { choice: NameChoice; exact: boolean } {
  const text = typeof words === "string" ? tidy(words) : "";
  if (!text) return { choice: { name: "", credential: "", other: "" }, exact: false };

  let rest = text;
  const doctor = /^dr\.?\s+/i.exec(rest);
  if (doctor) rest = rest.slice(doctor[0].length);

  let credential: CredentialPick;
  let other = "";
  const comma = rest.lastIndexOf(",");
  if (comma === -1) {
    // No credential after the name. With "Dr." in front it is the default, or an old typed name: which credential is not known.
    credential = doctor ? "" : "none";
  } else {
    const suffix = rest.slice(comma + 1).trim();
    rest = rest.slice(0, comma).trim();
    const listed = CREDENTIALS.find((listedOne) => listedOne === suffix);
    if (listed) credential = listed;
    else {
      // Anything else after the comma is read as Other; a value Other cannot hold is refused on save, with the reason.
      credential = "other";
      other = suffix;
    }
  }

  const choice: NameChoice = { name: rest, credential, other };
  const checked = parseNameChoice(choice);
  return { choice, exact: checked.ok && checked.words === text };
}

/** The name shown for a seated person: the one chosen for them, else the default, else null. */
export function effectiveSenderName(displayName: string | null | undefined, defaultName: string | null | undefined): string | null {
  return displayName || defaultName || null;
}

/**
 * The line near the top of the patient page and on the pamphlet:
 * "Sent by Dr. Jane Smith, DO, Summit Orthopedics", or "From Summit
 * Orthopedics" for a link with no name on it (every link made before
 * surgeons were recorded).
 */
export function sentByLine(senderName: string | null | undefined, clinicName: string): string {
  return senderName ? `Sent by ${senderName}, ${clinicName}` : `From ${clinicName}`;
}

/** A credential typed under Other: letters and hyphens, starting with a letter. */
const OTHER_CREDENTIAL = /^[A-Za-z][A-Za-z-]*$/;

/** Trim, and turn runs of spaces, tabs and line breaks into single spaces. Control characters go too. */
function tidy(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
