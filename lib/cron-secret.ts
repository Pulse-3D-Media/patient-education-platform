import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The check a scheduled route makes before it does anything. Pure (no
 * database, no request object), so the tests can try every case.
 *
 * Vercel calls a scheduled route (a "cron job", listed in vercel.json) on the
 * production deployment with the header
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * where CRON_SECRET is an environment variable Evan sets in Vercel. The route
 * is public by address, like the webhooks, so this header is the only thing
 * that tells Vercel's call apart from anyone else's.
 *
 *   "ok"              the header matches the secret.
 *   "not-configured"  no secret is set (or it is shorter than 16 characters,
 *                     the minimum Vercel recommends). FAILS CLOSED: the route
 *                     refuses and does nothing.
 *   "refused"         a header is missing or does not match.
 *
 * The comparison takes the same time whether the header is close or not:
 * both sides are turned into SHA-256 fingerprints of the same length first,
 * then compared with timingSafeEqual, so the time taken says nothing about
 * how much of a guess was right. The secret itself is never logged.
 */
export type CronCheck = "ok" | "not-configured" | "refused";

/** The shortest secret accepted, as Vercel's documentation recommends. */
export const MIN_CRON_SECRET_LENGTH = 16;

function fingerprint(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

export function checkCronSecret(authorization: string | null | undefined, secret: string | undefined): CronCheck {
  const expected = secret?.trim() ?? "";
  if (expected.length < MIN_CRON_SECRET_LENGTH) return "not-configured";
  if (!authorization) return "refused";
  return timingSafeEqual(fingerprint(authorization), fingerprint(`Bearer ${expected}`)) ? "ok" : "refused";
}
