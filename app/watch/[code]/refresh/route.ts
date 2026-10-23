import type { PlaybackRefresh } from "@/app/watch/patient-calls";
import { getShareByCode } from "@/lib/db/shares";
import { errorKind } from "@/lib/error-kind";
import { isExpired } from "@/lib/expiry";
import { playbackForShare } from "@/lib/playback-auth";
import { isShareCodeShape } from "@/lib/share-link";

/**
 * POST /watch/<code>/refresh: the player asks for a fresh signed address a
 * little before the one it has runs out, while the patient still has the page
 * open. A route of its own under /watch, never a Server Action, for the same
 * reason as /watch/<code>/play (see the note there).
 *
 * The link is looked up and judged again, exactly as the page judges it:
 * working and its video published gets a fresh grant bounded by the link's
 * deadline, but only once the "for education only" box has been ticked on it
 * (a tick is recorded before the player ever has a video to refresh, so this
 * changes nothing for a real patient; it stops this route being a way to get
 * the video without one). Public: the code in the address is the key, and no
 * body is read.
 *
 *   200 {"ok": true, "source": {...}}          a fresh grant
 *   200 {"ok": false, "reason": "ended"}       the link has run out, paused,
 *                                              been taken down, never had a
 *                                              tick, or never existed: the
 *                                              player says so calmly and
 *                                              renews nothing
 *   200 {"ok": false, "reason": "unavailable"} no address could be signed
 *                                              (Mux not configured here)
 *   400 {"ok": false, "reason": "ended"}       not a link's code
 *   500 {"ok": false, "reason": "unavailable"} a failure on our side; the
 *                                              player tries again shortly
 *
 * Never cached. The log holds the kind of failure only, never the code.
 */
export async function POST(_request: Request, { params }: RouteContext<"/watch/[code]/refresh">) {
  const { code } = await params;
  if (!isShareCodeShape(code)) return answer({ ok: false, reason: "ended" }, 400);
  try {
    const now = new Date();
    const share = await getShareByCode(code);
    if (!share || isExpired(share, now) || !share.video.isPublished) return answer({ ok: false, reason: "ended" }, 200);
    if (!share.disclaimerFirstAcceptedAt) return answer({ ok: false, reason: "ended" }, 200);
    const source = playbackForShare(share, now);
    if (source.kind === "unavailable") return answer({ ok: false, reason: "unavailable" }, 200);
    return answer({ ok: true, source }, 200);
  } catch (error) {
    console.error("Could not refresh a share link's playback.", errorKind(error));
    return answer({ ok: false, reason: "unavailable" }, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep: a signed address is for this page load only. */
function answer(body: PlaybackRefresh, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
