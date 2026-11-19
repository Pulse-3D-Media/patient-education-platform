import { checkCronSecret } from "@/lib/cron-secret";
import { errorKind } from "@/lib/error-kind";
import { runSetupReminders } from "@/lib/setup-reminder-run";

/**
 * GET /api/cron/setup-reminders: the daily job that emails a clinic's account
 * owner while setup is unfinished (1 day, 1 week and 2 weeks after sign-up;
 * the rules are in lib/setup-reminders.ts, the run in lib/setup-reminder-run.ts).
 *
 * Vercel calls it once a day, from the entry in vercel.json, on the
 * production deployment only. It is public by address (proxy.ts hands
 * /api/cron straight on, without Clerk, like the webhooks), so before doing
 * anything it checks the Authorization header against CRON_SECRET
 * (lib/cron-secret.ts):
 *
 *   503  "not configured"  no CRON_SECRET on this deployment. Nothing is read or sent.
 *   401  "refused"         the header is missing or wrong. Nothing is read or sent.
 *   200  counts            the run finished: {"ok":true,"configured":...,"checked":n,"sent":n,"skipped":n,"failed":n,"more":...}
 *   500  {"ok":false}      the run itself failed (the database did not answer). The kind goes to the log.
 *
 * The answer holds counts only: never an address, a clinic name or an id.
 * Safe to call twice, late, or two at once (see lib/db/setup-reminders.ts).
 * Vercel does not retry a failed call; the next day's run catches up.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The longest Vercel's Hobby plan allows. The run stops starting new clinics well before it (RUN_BUDGET_MS).
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const check = checkCronSecret(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (check === "not-configured") {
    console.error("Setup reminders: CRON_SECRET is not set on this deployment (or is shorter than 16 characters), so nothing was sent.");
    return new Response("not configured", { status: 503, headers: NO_STORE });
  }
  if (check === "refused") return new Response("refused", { status: 401, headers: NO_STORE });

  try {
    const result = await runSetupReminders();
    console.log("Setup reminders: run finished", JSON.stringify(result));
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    console.error("Setup reminders: the run failed", errorKind(error));
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
