import { pingDatabase } from "./db/health";
import { withTimeout } from "./timeout";

/**
 * The answer behind GET /api/health (app/api/health/route.ts): can this
 * server reach its database? Server only (it reaches lib/db).
 *
 * WHY IT REMEMBERS. The route is public, so anyone can call it as often as
 * they like, and every call used to run a database query (audit finding F3,
 * November 2026). Now the last answer is remembered for HEALTH_MEMORY_MS, ok
 * or not, and calls that arrive while a query is already on its way wait for
 * that one instead of starting their own. So a burst of a thousand calls is
 * one query. A monitor calling every minute or so still gets a fresh answer
 * each time.
 *
 * Each server remembers for itself; several servers running at once means one
 * query each per five seconds at most.
 */

/** How long to wait for the database before answering "not ok". */
export const HEALTH_TIMEOUT_MS = 5_000;

/** How long an answer, ok or not, is remembered before the database is asked again. */
export const HEALTH_MEMORY_MS = 5_000;

let remembered: { ok: boolean; at: number } | null = null;
let asking: Promise<boolean> | null = null;

/** True when the database answered (now, or within the last HEALTH_MEMORY_MS). Never throws. */
export function isDatabaseHealthy(): Promise<boolean> {
  if (remembered && Date.now() - remembered.at < HEALTH_MEMORY_MS) return Promise.resolve(remembered.ok);
  if (!asking) {
    asking = askTheDatabase().then((ok) => {
      // Remembered from the moment the answer came, so a slow failure is remembered for the full five seconds too.
      remembered = { ok, at: Date.now() };
      asking = null;
      return ok;
    });
  }
  return asking;
}

async function askTheDatabase(): Promise<boolean> {
  try {
    await withTimeout(pingDatabase(), HEALTH_TIMEOUT_MS, "the database");
    return true;
  } catch (error) {
    // The kind only: a message could carry the connection string.
    console.error("Health check: the database did not answer.", error instanceof Error ? error.name : "unknown error");
    return false;
  }
}

/** For the tests only: forget the last answer, as a freshly started server would. */
export function forgetHealthAnswer() {
  remembered = null;
  asking = null;
}
