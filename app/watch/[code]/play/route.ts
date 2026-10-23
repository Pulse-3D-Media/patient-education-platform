import { getShareByCode, recordSharePlay } from "@/lib/db/shares";
import { errorKind } from "@/lib/error-kind";
import { playbackForShare } from "@/lib/playback-auth";
import type { PlaybackSource } from "@/lib/playback-source";
import { isShareCodeShape } from "@/lib/share-link";
import { usesProtectedPlayback } from "@/lib/video";

/**
 * POST /watch/<code>/play: the video on a patient link's page actually
 * started playing, for the first time on this page load. Count the play
 * start, and let a first-play link's deadline move (recordSharePlay in
 * lib/db/shares.ts decides both, in one UPDATE, so two first plays at once
 * move the deadline once).
 *
 * A route of its own under /watch, never a Server Action (Prompt O, October
 * 2026): Next.js runs a Server Action by its id at ANY page address, so an
 * action could be posted to / or /sign-in, which the guessing limit in
 * Vercel's firewall (a rule on addresses starting /watch or /q, see
 * "Security headers and link guessing" in CLAUDE.md) does not watch. A route
 * answers only at its own address.
 *
 * Public: the link's code in the address is the key, and no body is read.
 * The player does not wait for this, so it can never delay the video. A play
 * that could not be recorded is simply not counted, and a first-play link
 * keeps its longer, unclaimed deadline, so the patient is never worse off.
 *
 * When the first play moves the deadline of a link whose video streams from
 * Mux, the answer also carries `playback`: a fresh grant made for the new
 * deadline (lib/playback-auth.ts), because the one the page loaded with was
 * bounded by the old one. The player swaps to it at its next refresh. A
 * video still on the CDN needs none, and nothing is handed out for a play
 * that was not recorded, or on a link where the "for education only" box has
 * never been ticked (a recorded tick is what hands out the video in the first
 * place, POST /watch/<code>/accept; this route must not be a way round it).
 *
 *   200 {"recorded": true, "playback"?: {...}}   counted
 *   200 {"recorded": false}                      not counted: the link is
 *                                                unknown, over or taken down
 *   400 {"recorded": false}                      not a link's code
 *   500 {"recorded": false}                      a failure on our side
 *
 * Never cached. The log holds the kind of failure only, never the code.
 */
export async function POST(_request: Request, { params }: RouteContext<"/watch/[code]/play">) {
  const { code } = await params;
  if (!isShareCodeShape(code)) return answer({ recorded: false }, 400);
  try {
    const result = await recordSharePlay(code);
    if (!result.recorded || !result.firstPlay) return answer({ recorded: result.recorded }, 200);
    const share = await getShareByCode(code);
    if (!share || !usesProtectedPlayback(share.video) || !share.disclaimerFirstAcceptedAt) return answer({ recorded: true }, 200);
    return answer({ recorded: true, playback: playbackForShare(share, new Date()) }, 200);
  } catch (error) {
    // The kind of failure goes to the server log, never the error itself: its message could hold the code.
    console.error("Could not record a play start on a share link.", errorKind(error));
    return answer({ recorded: false }, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep: a signed address is for this page load only. */
function answer(body: { recorded: boolean; playback?: PlaybackSource }, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
