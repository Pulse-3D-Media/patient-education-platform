"use server";

import { recordSharePlay } from "@/lib/db/shares";

/**
 * Called from the player the first time the video actually starts playing
 * on a page load, so the admin console can show what got watched, and so a
 * first-play link's deadline can move (see recordSharePlay in
 * lib/db/shares.ts, which decides both).
 *
 * The player does not wait for this to finish, so it can never delay the
 * video. Anything odd sent to it is ignored rather than answered, and a
 * failure on the server (a dropped database connection, say) is logged
 * there and answered with `recorded: false`: the patient's page never sees
 * an exception, and the video keeps playing. A play that could not be
 * recorded is simply not counted, and a first-play link keeps its longer,
 * unclaimed deadline, so the patient is never worse off for it.
 */
export async function recordPlay(code: string): Promise<{ recorded: boolean }> {
  if (typeof code !== "string" || code.length === 0 || code.length > 20) return { recorded: false };
  try {
    const result = await recordSharePlay(code);
    return { recorded: result.recorded };
  } catch (error) {
    // The detail goes to the server log, never to the patient's screen.
    console.error("Could not record a play start on a share link.", error);
    return { recorded: false };
  }
}
