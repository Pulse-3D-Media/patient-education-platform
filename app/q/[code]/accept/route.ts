import { decideVideoAccess } from "@/lib/access";
import { getClinicAccess } from "@/lib/db/access";
import { getQrCodeByCode } from "@/lib/db/qr-codes";
import { judgeAcceptedVersion } from "@/lib/education-note";
import { errorKind } from "@/lib/error-kind";
import { playbackForVideo } from "@/lib/playback-auth";
import type { PlaybackSource } from "@/lib/playback-source";
import { isQrCodeShape } from "@/lib/qr-code";

/**
 * POST /q/<code>/accept: the patient ticked "I understand this video is for
 * education only" on a printed QR code's page. Hand the player the video, so
 * the Play tap can start it at once, inside the tap.
 *
 * NOTHING IS WRITTEN HERE, on purpose. A printed code has no patient link
 * until the Play tap makes one (POST /q/<code>/issue), and "opening the page
 * makes nothing" stays true: no link and no record exist until the patient
 * acts. The tick's record is written onto the visit's own link when the Play
 * tap creates it: the player sends the version it showed with that request,
 * and issueShareFromQrCode (lib/db/shares.ts) writes the link with its record
 * already in it. A patient who ticks and never presses Play leaves nothing.
 *
 * The checks are the page's own, made again now: the code exists, it has not
 * been retired, and the clinic may show this video at this moment
 * (decideVideoAccess: open, on its plan, published, a placeholder only while
 * shown). One answer for every "no", so a patient is told nothing about the
 * clinic's plan or billing. The video is the same short-lived grant the page
 * handed out before the box existed (playbackForVideo, bounded by the token's
 * own hour); from the first play on, the player renews it through the
 * patient's own link.
 *
 * A route under /q, never a Server Action, so Vercel's guessing limit covers
 * it. One field in the body, `version`; never cached.
 *
 *   200 {"source": {...}}   what to play
 *   200 {"source": null}    the code is unknown or retired, or the clinic may
 *                           not show this video right now
 *   400                     malformed
 *   409                     the page showed other words: it reloads
 *   500                     a failure on our side; the page tries again
 */
export async function POST(request: Request, { params }: RouteContext<"/q/[code]/accept">) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  if (!isQrCodeShape(code)) return answer(null, 400);
  const version = judgeAcceptedVersion(body?.version);
  if (version === "malformed") return answer(null, 400);
  if (version === "stale") return answer(null, 409);

  try {
    const qr = await getQrCodeByCode(code);
    if (!qr || qr.retiredAt) return answer(null, 200);
    const access = await getClinicAccess(qr.clinicId);
    if (!access || !decideVideoAccess(access, qr.video).allowed) return answer(null, 200);
    return answer(playbackForVideo(qr.video, new Date(), null), 200);
  } catch (error) {
    // The kind only: never the printed code, which is a secret like a key.
    console.error("Could not get a printed QR code's video ready.", errorKind(error));
    return answer(null, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep. */
function answer(source: PlaybackSource | null, status: number) {
  return Response.json({ source }, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
