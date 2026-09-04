"use server";

import { recordShareView } from "@/lib/db/shares";

/**
 * Called from the player the first time the patient presses play, so the
 * admin console can show what got watched.
 *
 * The player does not wait for this to finish, so it can never delay the
 * video. Anything odd sent to it is ignored rather than answered.
 */
export async function recordView(code: string) {
  if (typeof code !== "string" || code.length === 0 || code.length > 20) return;
  await recordShareView(code);
}
