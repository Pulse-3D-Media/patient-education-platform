/**
 * The browser's side of a printed QR code's Play tap: ask the server for this
 * visit's own patient link (POST /q/<code>/issue, app/q/[code]/issue/route.ts).
 * Plain code, safe for the browser, with no server imports; the player
 * (app/watch/[code]/WatchPlayer.tsx) calls it.
 *
 * A route of its own under /q, rather than a Server Action, so the one
 * request that writes a link always arrives at an address starting /q: the
 * guessing limit in Vercel's firewall is a rule on the address, and a Server
 * Action can be sent to any address.
 */

/**
 * What the ask came to: this visit's link, a calm "not available" (nothing will change that by asking again),
 * "stale" (the page showed "for education only" words the server no longer records: reload), or no answer at all.
 */
export type IssueAnswer = { kind: "issued"; code: string } | { kind: "unavailable" } | { kind: "stale" } | { kind: "failed" };

/** How many times a request that got no answer (a dropped connection, a server failure) is sent, and the wait before each repeat. */
const TRIES = 3;
const WAIT_MS = [0, 800, 2000];

/**
 * A fresh one-time key for this visit: random, and nothing about the phone
 * or the person. The same key goes with every try of this visit's ask, so a
 * repeat finds the link the first try made (see childShareCode in
 * lib/db/shares.ts) instead of making another.
 */
export function newVisitKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ask for this visit's link, trying again (with the same key) when no answer came. `accepted` is the version of
 * the "for education only" words the patient ticked (DISCLAIMER in lib/education-note.ts): the server writes the
 * tick's record onto the new link. `fetcher` and `wait` are the browser's own unless a test hands in its own.
 */
export async function issueLink(
  qrCode: string,
  visitKey: string,
  accepted: string,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<IssueAnswer> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (WAIT_MS[attempt]) await wait(WAIT_MS[attempt]);
    try {
      const response = await fetcher(`/q/${encodeURIComponent(qrCode)}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: visitKey, accepted }),
        cache: "no-store",
      });
      // A server failure (500, or the firewall's 429 while the limit holds): try again shortly.
      if (response.status >= 500 || response.status === 429) continue;
      if (response.status === 409) return { kind: "stale" };
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      if (response.ok && typeof body?.code === "string") return { kind: "issued", code: body.code };
      return { kind: "unavailable" };
    } catch {
      // No answer at all: the connection dropped. Try again.
    }
  }
  return { kind: "failed" };
}
