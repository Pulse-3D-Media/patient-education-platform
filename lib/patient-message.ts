/**
 * The ready-made message staff copy or share with a new patient link
 * (decided by Evan on 2026-11-20), and the rules for which ways of sending
 * it a device is offered. Pure, with no React and no server code, so the
 * library's Send panel, the admin's Temporary patient link tab and the tests
 * all read the same words.
 *
 * THE WORDS LIVE HERE AND NOWHERE ELSE. To change the message, change
 * patientMessage() below (and its test); every button picks it up.
 *
 * Why these words: "Here is a short video about your procedure from Dr.
 * Jane Smith, DO: <link>" is true whoever pastes it (a nurse or the front
 * desk, not only the doctor), and whenever it is sent (before the visit as
 * well as after), because the link really is from that doctor: the patient
 * page names them. It does not name the procedure, because a text message
 * often shows on a locked phone's screen, and the link opens the procedure
 * anyway. It claims nothing about understanding, never mentions consent,
 * and has no "for education only" line: the patient page asks the patient
 * to tick that box before the video plays, so the message stays short
 * enough for one text.
 *
 * RULE 2: the message is put together in the browser from what the page
 * already has (the link, the name on it, the clinic's name). There is no
 * box for a patient's name, number or email, and nothing about a copy or a
 * share is sent to our server. A text or an email opens the device's own
 * app with the message filled in and NO recipient: the person sending picks
 * the patient there, and the number or address never reaches us.
 */

/**
 * The message, with the link at the end so it is never cut off mid-address.
 * `senderName` is the name on the link exactly as patients see it ("Dr. Jane
 * Smith, DO"), or null when the link names only the clinic.
 */
export function patientMessage({ link, senderName, clinicName }: { link: string; senderName: string | null; clinicName: string }): string {
  const from = tidy(senderName) || tidy(clinicName) || "your clinic";
  return `Here is a short video about your procedure from ${from}: ${link}`;
}

/** The subject line when the message goes into an email. No procedure, no name: the same reasons as the message. */
export const PATIENT_MESSAGE_SUBJECT = "A short video about your procedure";

/** One line, single spaces: a name never carries a line break into a text message. */
function tidy(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The address that opens the device's own texting app with the message
 * filled in and no number. "sms:?&body=" is the form both iPhones and
 * Android phones read.
 */
export function smsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

/** The address that opens the device's own email app with the subject and message filled in and no recipient. */
export function mailtoHref(message: string): string {
  return `mailto:?subject=${encodeURIComponent(PATIENT_MESSAGE_SUBJECT)}&body=${encodeURIComponent(message)}`;
}

/**
 * Which buttons a device gets beside Copy message (always there), decided by
 * what the device can do, never by the width of the screen:
 *
 *   - "share": the browser has its own share sheet (navigator.share: every
 *     phone and tablet, and some computers). One Share button; the sheet
 *     already holds Messages, Mail and the rest.
 *   - "text-and-email": no share sheet, on a touch-first device (no mouse to
 *     hover with): Text message and Email.
 *   - "email": no share sheet on a computer: Email only. A computer usually
 *     has no texting app, and a Text message button there would do nothing.
 *   - "none": drawn on the server, before the browser has been asked.
 */
export type SendWays = "share" | "text-and-email" | "email" | "none";

/** The parts of the browser this asks, handed in so a test can stand in for them. */
export type DeviceTools = {
  share?: unknown;
  canShare?: (data: { text?: string }) => boolean;
  /** True on a phone or tablet: the main pointer is a finger and nothing hovers. */
  touchFirst: boolean;
};

export function sendWaysFor(tools: DeviceTools): SendWays {
  const hasSheet = typeof tools.share === "function" && (typeof tools.canShare !== "function" || safeCanShare(tools.canShare));
  if (hasSheet) return "share";
  return tools.touchFirst ? "text-and-email" : "email";
}

/** Some browsers throw rather than answer; a throw counts as no. */
function safeCanShare(canShare: (data: { text?: string }) => boolean): boolean {
  try {
    return canShare({ text: "test" });
  } catch {
    return false;
  }
}

/** The parts of `navigator` the Copy message and Share buttons use. */
export type MessageTools = {
  share?: (data: { text?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

/** What became of a press of Copy message. */
export type CopyOutcome = "copied" | "refused";

export async function copyMessage(tools: MessageTools, message: string): Promise<CopyOutcome> {
  if (typeof tools.clipboard?.writeText !== "function") return "refused";
  try {
    await tools.clipboard.writeText(message);
    return "copied";
  } catch {
    return "refused";
  }
}

/** What became of a press of Share: the sheet was used, the person closed it, or it would not open. */
export type ShareOutcome = "shared" | "closed" | "refused";

export async function shareMessage(tools: MessageTools, message: string): Promise<ShareOutcome> {
  if (typeof tools.share !== "function") return "refused";
  try {
    // The text alone, with the link inside it: given a separate url too, some apps paste the link twice.
    await tools.share({ text: message });
    return "shared";
  } catch (error) {
    // The person closed the sheet: nothing more to do or say.
    if ((error as { name?: string } | null)?.name === "AbortError") return "closed";
    return "refused";
  }
}

/**
 * The words under the buttons after a press (a screen reader hears them).
 * Nothing after a share or a closed sheet: the device's own sheet was the
 * answer. After a refusal the message is shown in a box to copy by hand.
 */
export function messageNotice(action: "copy" | "share", outcome: CopyOutcome | ShareOutcome): string {
  if (outcome === "copied") return "Message copied. Paste it into a text, an email or your patient portal.";
  if (outcome !== "refused") return "";
  return action === "copy"
    ? "This browser would not copy it. The message is below: select it and copy it by hand."
    : "The share menu did not open. The message is below: select it and copy it by hand.";
}
