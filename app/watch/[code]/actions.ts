"use server";

import { headers } from "next/headers";
import { recordSharePlay, requestShareRenewal } from "@/lib/db/shares";
import { notifyClinicOfRenewalRequest } from "@/lib/renewal-email";
import { pickTrustedOrigin } from "@/lib/trusted-origin";

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

/**
 * Called when a patient taps "Ask my clinic" on a link that has paused.
 * Two steps, in this order:
 *
 *   1. Record the request on the link (requestShareRenewal in
 *      lib/db/shares.ts): one timestamp, at most once per link per day.
 *      This is the part that must not be lost, and it is done first. The
 *      clinic's overview lists the link from this moment on.
 *   2. Tell the clinic's office admins by email (lib/renewal-email.ts), if
 *      email is set up. This part is allowed to fail: without a key, with
 *      no admins, or with the service down, the request is still recorded
 *      and still listed, and the reason goes to the server log.
 *
 * The address in the email is built from an origin this deployment knows
 * is its own (pickTrustedOrigin), never from the Host header as it came:
 * an address in someone's inbox must not be one an attacker chose.
 *
 * The answer is `asked: true` when the request is recorded now or was
 * recorded within the last day (the page shows the same calm confirmation
 * for both), and `asked: false` otherwise, including on a server failure,
 * which is logged there and never shown to the patient. Only the link's
 * code is sent and only a timestamp is written: no name, no address,
 * nothing typed (rule 2).
 */
export async function requestReactivation(code: string): Promise<{ asked: boolean }> {
  if (typeof code !== "string" || code.length === 0 || code.length > 20) return { asked: false };
  try {
    const outcome = await requestShareRenewal(code);
    if (outcome.kind === "already-asked") return { asked: true };
    if (outcome.kind === "refused") return { asked: false };

    const origin = pickTrustedOrigin((await headers()).get("host"), process.env);
    const told = await notifyClinicOfRenewalRequest(outcome.facts, origin);
    // The request is recorded either way; this line only says whether the office was emailed. Never the code.
    if (!told.told) console.log("A request to turn a link back on was recorded; the clinic was not emailed:", told.reason);
    return { asked: true };
  } catch (error) {
    console.error("Could not record a request to turn a link back on.", error instanceof Error ? error.name : "unknown error");
    return { asked: false };
  }
}
