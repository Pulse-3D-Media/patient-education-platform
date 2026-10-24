import { requestShareRenewal } from "@/lib/db/shares";
import { errorKind } from "@/lib/error-kind";
import { notifyClinicOfRenewalRequest } from "@/lib/renewal-email";
import { isShareCodeShape } from "@/lib/share-link";
import { pickTrustedOrigin } from "@/lib/trusted-origin";

/**
 * POST /watch/<code>/ask: a patient tapped "Ask my clinic" on a link that has
 * paused. A route of its own under /watch, never a Server Action, for the
 * same reason as /watch/<code>/play (see the note there): a public write must
 * always arrive at an address the guessing limit in Vercel's firewall covers.
 *
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
 *   200 {"asked": true}    recorded now, or within the last day (the page
 *                          shows the same calm confirmation for both)
 *   200 {"asked": false}   refused: the link is not paused, or unknown
 *   400 {"asked": false}   not a link's code
 *   500 {"asked": false}   a failure on our side, never shown to the patient
 *
 * Only the link's code (in the address) is sent and only a timestamp is
 * written: no body is read, no name, no address, nothing typed (rule 2).
 * Never cached. The log holds the kind of failure only, never the code.
 */
export async function POST(request: Request, { params }: RouteContext<"/watch/[code]/ask">) {
  const { code } = await params;
  if (!isShareCodeShape(code)) return answer(false, 400);
  try {
    const outcome = await requestShareRenewal(code);
    if (outcome.kind === "already-asked") return answer(true, 200);
    if (outcome.kind === "refused") return answer(false, 200);

    const origin = pickTrustedOrigin(request.headers.get("host"), process.env);
    const told = await notifyClinicOfRenewalRequest(outcome.facts, origin);
    // The request is recorded either way; this line only says whether the office was emailed. Never the code.
    if (!told.told) console.log("A request to turn a link back on was recorded; the clinic was not emailed:", told.reason);
    return answer(true, 200);
  } catch (error) {
    console.error("Could not record a request to turn a link back on.", errorKind(error));
    return answer(false, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep. */
function answer(asked: boolean, status: number) {
  return Response.json({ asked }, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
