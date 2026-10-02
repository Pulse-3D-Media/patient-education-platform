/**
 * The small rules of the "add a note" box on a clinic's /pulse page.
 *
 * Pure, with no server imports, so the box (which runs in the browser) and
 * the Server Action that saves the note (app/pulse/actions.ts) use the same
 * limit and the same way of measuring a note.
 */

/** The longest one note may be, in characters. The box stops typing here and the server refuses anything longer. */
export const NOTE_MAX_LENGTH = 2000;

/**
 * A note as it is measured and stored: line breaks as one character each, no
 * blank space at either end.
 *
 * A browser counts a line break as one character while typing, but sends it
 * as two (a carriage return and a line feed). Without this, a note the box
 * showed as exactly at the limit would be refused by the server for being
 * over it.
 */
export function cleanNote(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/** What the save answers with: a line to show on success, or what went wrong. Null before anything was sent. */
export type NoteOutcome = { ok?: string; error?: string } | null;

/**
 * What the box should hold after a save was tried. Only a save the server
 * confirmed empties it. A refusal (too long, empty, the clinic gone) or a
 * failure (no connection, a server fault) leaves every character where it
 * was, so the note can be fixed or sent again.
 */
export function draftAfterSave(draft: string, outcome: NoteOutcome): string {
  return outcome?.ok ? "" : draft;
}

/** Shown under the box when the save could not be reached or failed without an answer. */
export const NOTE_NOT_SAVED = "The note could not be saved just now. It is still in the box: try again.";

/**
 * Send a note with `save` and say what the box should hold afterwards.
 * A save that fails outright (a lost connection, a server fault) comes back
 * as a plain message with the draft kept, instead of an error page that
 * would take the typed note with it.
 *
 * `passOn` is given every failure first and may throw it again. The form
 * hands in Next.js's own helper for that, so Next.js's signals (a redirect
 * to sign-in, a not-found) still do their job and only real failures are
 * turned into the message.
 */
export async function saveNoteDraft(
  draft: string,
  save: () => Promise<NoteOutcome>,
  passOn: (error: unknown) => void = () => {},
): Promise<{ outcome: NoteOutcome; draft: string }> {
  let outcome: NoteOutcome;
  try {
    outcome = await save();
  } catch (error) {
    passOn(error);
    outcome = { error: NOTE_NOT_SAVED };
  }
  return { outcome, draft: draftAfterSave(draft, outcome) };
}
