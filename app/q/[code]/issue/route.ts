import { issueShareFromQrCode } from "@/lib/db/shares";
import { DISCLAIMER, judgeAcceptedVersion } from "@/lib/education-note";
import { errorKind } from "@/lib/error-kind";
import { ShareTermsError } from "@/lib/expiry";
import { isAttemptKey, isQrCodeShape } from "@/lib/qr-code";

/**
 * POST /q/<code>/issue: a patient tapped Play on a printed QR code's page.
 * Make this visit's own patient link (or find the one it already made) and
 * answer with its code. Public: the printed code in the address is the key
 * (issueShareFromQrCode in lib/db/shares.ts does every check).
 *
 * Only POST. Opening the printed code's page (GET), a link preview, an email
 * scanner or a HEAD request never reaches this, so none of them makes a
 * link; a GET or HEAD here is answered 405 by Next.js.
 *
 * The body is two fields: `key`, the visit's one-time key (isAttemptKey in
 * lib/qr-code.ts), and `accepted`, the version of the "for education only"
 * words the patient ticked before Play (lib/education-note.ts). The page only
 * lets Play be pressed after the tick, and the new link is written with the
 * tick's record already in it (issueShareFromQrCode). Nothing else is read,
 * nothing about the person is sent or stored, and the answer is never cached
 * (no-store), so one visit's link is never handed to another.
 *
 *   200 {"code": "..."}   this visit's link
 *   200 {"code": null}    no link: the code is unknown or retired, or the
 *                         clinic may not show this video right now. One
 *                         answer for all of them, so the page says only
 *                         "not available right now" and nothing is given
 *                         away about why
 *   400                   malformed, or no tick of the box
 *   409                   the page showed other words: it reloads
 *   500                   a failure on our side; the page tries again
 *
 * Abuse: requests to addresses starting /q are counted by the rate-limit
 * rule in Vercel's firewall (set by Evan in the dashboard, beside the one
 * for /watch), and a code handing out an unusual number of links in a day
 * is flagged on the clinic's /pulse page (the qrDailyFlag setting). The log
 * never holds the code, the key, or the link made.
 */
export async function POST(request: Request, { params }: RouteContext<"/q/[code]/issue">) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { key?: unknown; accepted?: unknown } | null;
  if (!isQrCodeShape(code) || !isAttemptKey(body?.key)) return answer({ code: null }, 400);
  const accepted = judgeAcceptedVersion(body.accepted);
  if (accepted === "malformed") return answer({ code: null }, 400);
  if (accepted === "stale") return answer({ code: null }, 409);

  try {
    const outcome = await issueShareFromQrCode(code, body.key, { disclaimerVersion: DISCLAIMER.version });
    return answer({ code: outcome.ok ? outcome.code : null }, 200);
  } catch (error) {
    // A link setting out of range: no link can be made anywhere until Pulse fixes it. Calm for the patient, loud in the log.
    if (error instanceof ShareTermsError) {
      console.error("A printed QR code could not hand out a link: a link setting is out of range.");
      return answer({ code: null }, 200);
    }
    console.error("A printed QR code could not hand out a link.", errorKind(error));
    return answer({ code: null }, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep. */
function answer(body: { code: string | null }, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
