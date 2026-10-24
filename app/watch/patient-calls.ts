import type { PlaybackSource } from "@/lib/playback-source";

/**
 * The browser's side of the three calls a patient link's page makes once the
 * video is on its way: plain code, safe for the browser, with no server
 * imports. The player (app/watch/[code]/WatchPlayer.tsx) and the paused
 * page's button (AskClinic.tsx) call these.
 *
 *   recordPlay(code)           POST /watch/<code>/play     the first real play on this page load
 *   refreshPlayback(code)      POST /watch/<code>/refresh  a fresh signed address before the old one runs out
 *   requestReactivation(code)  POST /watch/<code>/ask      the "Ask my clinic" tap on a paused link
 *
 * Routes, not Server Actions (Prompt O, October 2026): Next.js runs a Server
 * Action by its id at any page address, so a patient action could be posted
 * to / or /sign-in, which Vercel's guessing limit (a rule on /watch and /q)
 * does not watch. A route answers only at its own address. The routes
 * themselves are in app/watch/[code]/play, refresh and ask.
 *
 * Each is ONE try, as the Server Actions were: the play count is allowed to
 * be missed (the video plays on), the player's refresh already tries again
 * shortly by itself (components/ui/video-source-loader.ts), and Ask my clinic
 * says "That did not go through" and lets the patient tap again. Anything
 * other than a well-formed answer (a dropped connection, a server failure,
 * the firewall's 429) becomes the calm "no" each caller already handles.
 * Nothing is ever thrown at the page.
 */

/** What the player gets back when it asks for a fresh address: one, or why not. */
export type PlaybackRefresh = { ok: true; source: PlaybackSource } | { ok: false; reason: "ended" | "unavailable" };

/** Count the play start. A first play that moved a Mux link's deadline hands back a grant for the new deadline. */
export async function recordPlay(code: string, fetcher: typeof fetch = fetch): Promise<{ recorded: boolean; playback?: PlaybackSource }> {
  const body = await post(code, "play", fetcher);
  if (!body || body.recorded !== true) return { recorded: false };
  return isSource(body.playback) ? { recorded: true, playback: body.playback } : { recorded: true };
}

/** Ask for a fresh address. "ended" only when the server says the link is over; any failure is "unavailable", which is tried again. */
export async function refreshPlayback(code: string, fetcher: typeof fetch = fetch): Promise<PlaybackRefresh> {
  const body = await post(code, "refresh", fetcher);
  if (body?.ok === true && isSource(body.source)) return { ok: true, source: body.source };
  if (body?.ok === false && body.reason === "ended") return { ok: false, reason: "ended" };
  return { ok: false, reason: "unavailable" };
}

/** Ask the clinic to turn a paused link back on. */
export async function requestReactivation(code: string, fetcher: typeof fetch = fetch): Promise<{ asked: boolean }> {
  const body = await post(code, "ask", fetcher);
  return { asked: body?.asked === true };
}

/**
 * One POST to /watch/<code>/<what>, and its JSON body when the server
 * answered 200, or 400 (this page sent something the server will not take,
 * which asking again will not change). Null for anything else: no answer, a
 * failure (500), the firewall's limit (429), or a body that is not JSON.
 */
async function post(code: string, what: "play" | "refresh" | "ask", fetcher: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetcher(`/watch/${encodeURIComponent(code)}/${what}`, { method: "POST", cache: "no-store" });
    if (response.status !== 200 && response.status !== 400) return null;
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Is this something the player can be handed? Only the three kinds the server makes. */
function isSource(value: unknown): value is PlaybackSource {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "file" || kind === "stream" || kind === "unavailable";
}
