/**
 * The rule that decides whether a test run may go ahead: the test database
 * must be readable, and it must not be production.
 *
 * This file has no imports and touches nothing, so it can be tested with
 * made-up connection strings (vitest.guard.test.ts). vitest.setup.ts feeds
 * it the real values before any test file loads.
 *
 * It fails closed. Every case where the answer is not a clear "these are
 * different databases" is a refusal:
 *
 * - no test connection string, or one that cannot be read
 * - a production connection string that is set but cannot be read
 * - nothing that names production at all, so there is nothing to compare
 *   against (a worktree with no .env, for example). What names production
 *   is worked out by productionStrings(), at the end of this file
 * - the test string names the same Neon endpoint as production, however
 *   either side spells it: through Neon's connection pooler or not, with a
 *   port or a trailing dot or without
 *
 * That last one matters: Neon gives the same database two host names,
 * ep-abc.region.aws.neon.tech and ep-abc-pooler.region.aws.neon.tech, and any
 * host can be written with ":5432" or a dot on the end. A guard that compared
 * host names as written would let production through under another spelling.
 */

/** One connection string the app runs on, and the variable it came from. */
export type ProductionUrl = { name: string; value: string | undefined };

export type GuardResult = { ok: true; endpoint: string } | { ok: false; reason: string };

/**
 * The database a connection string points at, reduced to one form, so that
 * two spellings of one database can never look like two databases. Lower
 * case, no port, no trailing dot, and Neon's "-pooler" removed from the
 * endpoint name. Null when the string cannot be read as a URL, or no host is
 * left.
 *
 * Leaving the port out means two databases on one host at different ports
 * count as the same database. That is on purpose: the mistake it can make is
 * a refusal, never a pass.
 */
export function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
  if (!host) return null;
  const dot = host.indexOf(".");
  const first = dot === -1 ? host : host.slice(0, dot);
  const rest = dot === -1 ? "" : host.slice(dot);
  return first.replace(/-pooler$/, "") + rest;
}

/**
 * May the tests run against `testUrl`? Compares it with every production
 * connection string given. Returns ok with the test endpoint, or a reason
 * to refuse. Never prints or returns a connection string: reasons name the
 * variable, not its value.
 */
export function checkTestDatabase(testUrl: string | undefined, production: ProductionUrl[]): GuardResult {
  if (!testUrl?.trim()) {
    return {
      ok: false,
      reason:
        "Tests need TEST_DATABASE_URL in .env.test: the pooled connection string of the Neon 'testing' branch. Never the production string.",
    };
  }

  const testEndpoint = endpointOf(testUrl);
  if (!testEndpoint) {
    return { ok: false, reason: "TEST_DATABASE_URL in .env.test is not a valid connection string." };
  }

  let compared = 0;
  for (const { name, value } of production) {
    if (!value?.trim()) continue;
    const endpoint = endpointOf(value);
    if (!endpoint) {
      return {
        ok: false,
        reason: `Refusing to run: ${name} is set but cannot be read as a connection string, so the tests cannot confirm they are not pointed at production.`,
      };
    }
    if (endpoint === testEndpoint) {
      return {
        ok: false,
        reason: `Refusing to run: TEST_DATABASE_URL points at the same database as ${name} (the pooled and direct addresses of one Neon endpoint count as the same database). Tests must never touch production.`,
      };
    }
    compared++;
  }

  if (compared === 0) {
    return {
      ok: false,
      reason:
        "Refusing to run: nothing here says which database is production (no PRODUCTION_DATABASE_HOST in .env or the environment, no .env.release, and no DATABASE_URL or DIRECT_URL), so the tests cannot confirm the test database is not production. Copy .env from the main checkout, or set PRODUCTION_DATABASE_HOST.",
    };
  }

  return { ok: true, endpoint: testEndpoint };
}

/** A set of settings read from a file or the environment. */
type Settings = Record<string, string | undefined>;

/**
 * Everything on this computer that names the production database, as the list
 * checkTestDatabase() compares the test database against.
 *
 * Since November 2026 the main checkout's .env points at the TESTING branch,
 * and production's two connection strings live in .env.release, which only
 * the release command reads. So ".env's DATABASE_URL" no longer means
 * production, and production is named two other ways instead:
 *
 * - PRODUCTION_DATABASE_HOST (in .env, or the environment): the production
 *   host name, the same line the operator scripts compare with.
 * - .env.release: its DATABASE_URL and DIRECT_URL, when the file is there.
 *
 * When PRODUCTION_DATABASE_HOST is not set anywhere, .env's (or the
 * environment's) DATABASE_URL and DIRECT_URL are compared as well, the way
 * they always were. That covers GitHub's checks, which set a stand-in
 * DATABASE_URL and nothing else, and a checkout whose .env is still the old
 * production one with the host line missing.
 *
 * When PRODUCTION_DATABASE_HOST is set, .env's DATABASE_URL is NOT treated as
 * production: it is the testing branch, and the tests are allowed to run
 * there.
 *
 * Pure: it only reads what it is given. Never returns anything but the
 * values it was handed, and checkTestDatabase() never prints them.
 */
export function productionStrings(sources: { appEnv: Settings; releaseEnv: Settings; processEnv: Settings }): ProductionUrl[] {
  const { appEnv, releaseEnv, processEnv } = sources;
  const list: ProductionUrl[] = [];

  const host = (appEnv.PRODUCTION_DATABASE_HOST ?? processEnv.PRODUCTION_DATABASE_HOST)?.trim();
  if (host) {
    // A bare host name is turned into an address so it can be read like one.
    list.push({ name: "PRODUCTION_DATABASE_HOST", value: host.includes("://") ? host : `postgresql://${host}` });
  }

  list.push({ name: "DATABASE_URL in .env.release", value: releaseEnv.DATABASE_URL });
  list.push({ name: "DIRECT_URL in .env.release", value: releaseEnv.DIRECT_URL });

  if (!host) {
    list.push({ name: "DATABASE_URL", value: appEnv.DATABASE_URL ?? processEnv.DATABASE_URL });
    list.push({ name: "DIRECT_URL", value: appEnv.DIRECT_URL ?? processEnv.DIRECT_URL });
  }

  return list;
}
