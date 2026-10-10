import type { PlaybackSource } from "@/lib/playback-source";

/**
 * The browser's side of the "for education only" box on the patient page:
 * tell the server the box was ticked, and get back what to play. Plain code,
 * safe for the browser, with no server imports; the player
 * (app/watch/[code]/WatchPlayer.tsx) calls it.
 *
 *   a patient link   POST /watch/<code>/accept  (records the tick on the link)
 *   a printed code   POST /q/<code>/accept      (records nothing: there is no
 *                                                link until the Play tap)
 *
 * Routes, not Server Actions, so the request always arrives at an address
 * Vercel's guessing limit covers (a rule on /watch and /q).
 *
 * HOW A SLOW OR FAILED ASK IS HANDLED. A request that gets no answer (the
 * connection dropped, a server failure, the firewall's 429, or no answer
 * within TIMEOUT_MS) is sent again, up to TRIES times in all, after a short
 * wait. If none gets through, the answer is "failed": the player keeps the box
 * ticked and offers a calm Try again, never an error page. One honest limit:
 * when the server recorded the tick and only its answer was lost, the repeat
 * records it again, so a link can show one more tick than the patient made.
 * Like viewCount, the number is recorded ticks, never people.
 */

/** Where the box was ticked: a patient link's page, or a printed code's page before its link exists. */
export type AcceptTarget = { kind: "link"; code: string } | { kind: "printed"; code: string };

/**
 * What the ask came to:
 *   ready        recorded (on a link) and here is what to play
 *   not-working  nothing to play: the link has stopped working, or the
 *                printed code cannot play right now. Asking again will not
 *                change it
 *   stale        the page showed words the server no longer records: reload
 *                the page, so the patient ticks the current ones
 *   failed       no answer got through
 */
export type AcceptAnswer =
  | { kind: "ready"; source: PlaybackSource }
  | { kind: "not-working" }
  | { kind: "stale" }
  | { kind: "failed" };

const TRIES = 3;
const WAIT_MS = [0, 800, 2000];
/** How long one try may take before it is abandoned and tried again. Generous: a waiting-room phone on one bar of signal is slow, not broken. */
export const TIMEOUT_MS = 10_000;

/** Tell the server the box was ticked. `fetcher` and `wait` are the browser's own unless a test hands in its own. */
export async function acceptDisclaimer(
  target: AcceptTarget,
  version: string,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<AcceptAnswer> {
  const path = `/${target.kind === "link" ? "watch" : "q"}/${encodeURIComponent(target.code)}/accept`;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (WAIT_MS[attempt]) await wait(WAIT_MS[attempt]);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : undefined;
    try {
      const response = await fetcher(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
        cache: "no-store",
        signal: controller?.signal,
      });
      // A server failure, or the firewall's limit for a moment: try again shortly.
      if (response.status >= 500 || response.status === 429) continue;
      if (response.status === 409) return { kind: "stale" };
      const body = (await response.json().catch(() => null)) as { source?: unknown } | null;
      if (response.ok && isSource(body?.source)) return { kind: "ready", source: body.source };
      if (response.ok) return { kind: "not-working" };
      // A 400: this page sent something the server will not take. Asking again will not change that.
      return { kind: "failed" };
    } catch {
      // No answer at all (the connection dropped, or the try timed out). Try again.
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind: "failed" };
}

/** Is this something the player can be handed? Only the three kinds the server makes. */
function isSource(value: unknown): value is PlaybackSource {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "file" || kind === "stream" || kind === "unavailable";
}
