import { isDatabaseHealthy } from "@/lib/health";

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
 *   503  {"ok":false}   it did not, or not within five seconds
 *
 * The answer is remembered for five seconds (lib/health.ts), so a burst of
 * calls from anyone is one database query, not one each.
 *
 * No version, no timing, no error message, no connection detail: the kind
 * of failure goes to the server log, and a monitor only needs the status
 * code. Nothing is read from the request either.
 */

// Always run on the server at request time, on Node (Prisma needs it), and never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ok = await isDatabaseHealthy();
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
