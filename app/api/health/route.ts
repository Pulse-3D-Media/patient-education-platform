import { pingDatabase } from "@/lib/db/health";
import { withTimeout } from "@/lib/timeout";

/**
 * GET /api/health: can this deployment reach its database? Made for an
 * uptime monitor to watch every few minutes, so that somebody is told when
 * the site is down or the database is unreachable before a patient or a
 * clinic finds out.
 *
 * Public on purpose (there is nothing in it), never cached, and it says
 * nothing but ok or not:
 *
 *   200  {"ok":true}    the database answered
 *   503  {"ok":false}   it did not, or not within HEALTH_TIMEOUT_MS
 *
 * No version, no timing, no error message, no connection detail: the kind
 * of failure goes to the server log, and a monitor only needs the status
 * code. Nothing is read from the request either.
 */

// Always run on the server at request time, on Node (Prisma needs it), and never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long to wait for the database before answering "not ok". */
const HEALTH_TIMEOUT_MS = 5_000;

export async function GET() {
  try {
    await withTimeout(pingDatabase(), HEALTH_TIMEOUT_MS, "the database");
    return answer(200, true);
  } catch (error) {
    console.error("Health check: the database did not answer.", error instanceof Error ? error.name : "unknown error");
    return answer(503, false);
  }
}

function answer(status: number, ok: boolean) {
  return Response.json({ ok }, { status, headers: { "Cache-Control": "no-store" } });
}
