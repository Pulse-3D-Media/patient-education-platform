import { acceptShareDisclaimer } from "@/lib/db/shares";
import { DISCLAIMER, judgeAcceptedVersion } from "@/lib/education-note";
import { errorKind } from "@/lib/error-kind";
import { playbackForShare } from "@/lib/playback-auth";
import type { PlaybackSource } from "@/lib/playback-source";
import { isShareCodeShape } from "@/lib/share-link";

/**
 * POST /watch/<code>/accept: the patient ticked "I understand this video is
 * for education only" on a patient link's page. Record the tick on the link,
 * and only then hand the player the video (decided by Evan and Van on
 * 2026-10-08: the video stays frozen until the box is ticked, and the page's
 * HTML carries no playable address before it).
 *
 * Public: the link's code in the address is the key, exactly as for the page.
 * acceptShareDisclaimer (lib/db/shares.ts) checks the link the way the page
 * does (it exists, it is before its deadline, its video is published) and
 * records the tick in the same single UPDATE, so nothing is handed out
 * without a record, and nothing is recorded on a link that is not working.
 *
 * A route of its own under /watch, never a Server Action, so the guessing
 * limit in Vercel's firewall (a rule on addresses starting /watch or /q, see
 * "Security headers and link guessing" in CLAUDE.md) always covers it.
 *
 * The body is one field, `version`: the version of the words the page showed
 * (DISCLAIMER in lib/education-note.ts). Nothing else is read, nothing about
 * the person is sent or stored (rule 2), and the answer is never cached.
 *
 *   200 {"source": {...}}   recorded; what to play (a signed Mux grant
 *                           bounded by the link, or the CDN file)
 *   200 {"source": null}    nothing recorded: the link is unknown, expired,
 *                           paused or taken down. One answer for all of them
 *   400                     malformed
 *   409                     the page showed other words (drawn by another
 *                           deployment): it reloads, and the patient ticks
 *                           the current words
 *   500                     a failure on our side; the page tries again
 *
 * The log never holds the code or an address: the kind of failure only.
 */
export async function POST(request: Request, { params }: RouteContext<"/watch/[code]/accept">) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  if (!isShareCodeShape(code)) return answer(null, 400);
  const version = judgeAcceptedVersion(body?.version);
  if (version === "malformed") return answer(null, 400);
  if (version === "stale") return answer(null, 409);

  try {
    const now = new Date();
    const record = await acceptShareDisclaimer(code, DISCLAIMER.version, now);
    if (!record.recorded) return answer(null, 200);
    return answer(playbackForShare(record.share, now), 200);
  } catch (error) {
    console.error("Could not record the education box on a share link.", errorKind(error));
    return answer(null, 500);
  }
}

/** A JSON answer that no browser, CDN or proxy may keep: a signed address is for this page load only. */
function answer(source: PlaybackSource | null, status: number) {
  return Response.json({ source }, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
