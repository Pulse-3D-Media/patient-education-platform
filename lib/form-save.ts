/**
 * One small rule every form on /pulse shares: a save that fails outright
 * (a lost connection, a server fault) is answered with a plain sentence,
 * never an error page, so what was typed is still on screen to send again.
 *
 * Pure, with no server imports, so the forms (which run in the browser) can
 * use it. The other half of "a form keeps what was typed" is in
 * app/pulse/FormBits.tsx (useKeptForm), which stops React emptying the boxes.
 */

/** What a form's save answers with: a line to show on success, or what went wrong. Null before anything was sent. */
export type SaveOutcome = { ok?: string; error?: string } | null;

/**
 * Shown when a save could not be reached or failed without an answer. It
 * says "could not confirm" on purpose: the answer can be lost after the
 * server has already saved, so the form never claims nothing was written.
 */
export const SAVE_NOT_CONFIRMED = "We could not confirm the save. Your entries are still here. Try again.";

/**
 * Run a save and always come back with an answer. A refusal from the server
 * is passed along as it is. A save that throws becomes SAVE_NOT_CONFIRMED;
 * the failure itself (which can carry a connection string or a share code)
 * is never shown.
 *
 * `passOn` is given every failure first and may throw it again. The forms
 * hand in Next.js's own helper for that, so Next.js's signals (a redirect
 * after adding a video, a not-found) still do their job and only real
 * failures are turned into the sentence.
 */
export async function safeSave(save: () => Promise<SaveOutcome>, passOn: (error: unknown) => void = () => {}): Promise<SaveOutcome> {
  try {
    return await save();
  } catch (error) {
    passOn(error);
    return { error: SAVE_NOT_CONFIRMED };
  }
}
