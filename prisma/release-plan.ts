/**
 * The decision behind "npm run on-production": may this command be run
 * against the production database, and with which connection strings?
 *
 * Why this exists. Until November 2026 the main checkout's .env held the
 * production connection strings, so any database command that forgot to say
 * otherwise ran against production (one did, on 2026-11-18; nothing was
 * pending, so nothing changed). Now .env points at the TESTING branch, and
 * production's two strings live in .env.release, which nothing reads unless
 * it is asked to. This is the one thing that asks:
 *
 *   npm run on-production -- npx prisma migrate deploy
 *   npm run on-production -- npm run db:set-status -- <clinicId> PAUSED "reason" --production
 *
 * So a forgotten setting now reaches the testing branch, and reaching
 * production takes a command that says "production" in its own name.
 *
 * It is strict about what .env.release may hold: both strings must be there,
 * both must be readable, and both must name the database that
 * PRODUCTION_DATABASE_HOST (in .env) names. A .env.release that points
 * anywhere else is refused, so the file can never quietly become "some other
 * database that gets migrated on release day".
 *
 * Pure: give it what the files said, it gives back the decision. It never
 * returns or prints a connection string in a reason; the host name it
 * returns carries no password.
 */
import { endpointOf } from "../vitest.guard";

/** A set of settings read from a file. */
type Settings = Record<string, string | undefined>;

export type ReleasePlan =
  | {
      ok: true;
      /** The production host, safe to print. */
      host: string;
      /** The two strings to hand to the command. Never printed. */
      env: { DATABASE_URL: string; DIRECT_URL: string };
    }
  | { ok: false; reason: string };

/**
 * @param release        what .env.release holds, or null when the file is not there
 * @param productionHost PRODUCTION_DATABASE_HOST from .env
 * @param command        the command to run, as typed after "npm run on-production --"
 */
export function planRelease(release: Settings | null, productionHost: string | undefined, command: string[]): ReleasePlan {
  if (command.length === 0) {
    return {
      ok: false,
      reason: "Nothing to run. Put the command after the two dashes, for instance: npm run on-production -- npx prisma migrate deploy",
    };
  }
  if (!release) {
    return {
      ok: false,
      reason: "Refusing to run: there is no .env.release file here. It holds production's DATABASE_URL and DIRECT_URL. Nothing was run.",
    };
  }

  const pooled = release.DATABASE_URL?.trim();
  const direct = release.DIRECT_URL?.trim();
  if (!pooled || !direct) {
    return { ok: false, reason: "Refusing to run: .env.release must hold both DATABASE_URL and DIRECT_URL. Nothing was run." };
  }
  const pooledEndpoint = endpointOf(pooled);
  const directEndpoint = endpointOf(direct);
  if (!pooledEndpoint || !directEndpoint) {
    return { ok: false, reason: "Refusing to run: a line in .env.release cannot be read as a connection string. Nothing was run." };
  }

  const hostText = productionHost?.trim();
  if (!hostText) {
    return {
      ok: false,
      reason: "Refusing to run: PRODUCTION_DATABASE_HOST is not set in .env, so .env.release cannot be checked against it. Nothing was run.",
    };
  }
  // A bare host name is turned into an address so it can be read like one.
  const production = endpointOf(hostText.includes("://") ? hostText : `postgresql://${hostText}`);
  if (!production) {
    return { ok: false, reason: "Refusing to run: PRODUCTION_DATABASE_HOST in .env cannot be read as a host name. Nothing was run." };
  }

  if (pooledEndpoint !== production || directEndpoint !== production) {
    return {
      ok: false,
      reason:
        "Refusing to run: .env.release does not point at the database PRODUCTION_DATABASE_HOST names. One of the two is wrong. Nothing was run.",
    };
  }

  return { ok: true, host: production, env: { DATABASE_URL: pooled, DIRECT_URL: direct } };
}
