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
 * - no production connection string at all, so there is nothing to compare
 *   against (a worktree with no .env, for example)
 * - the test string names the same Neon endpoint as production, whether or
 *   not one side goes through Neon's connection pooler
 *
 * That last one matters: Neon gives the same database two host names,
 * ep-abc.region.aws.neon.tech and ep-abc-pooler.region.aws.neon.tech. A
 * guard that compared host names as written would let the pooled address of
 * production through when .env only held the direct one.
 */

/** One connection string the app runs on, and the variable it came from. */
export type ProductionUrl = { name: string; value: string | undefined };

export type GuardResult = { ok: true; endpoint: string } | { ok: false; reason: string };

/**
 * The database a connection string points at, in a form that is the same for
 * its pooled and direct addresses: the host, lower-cased, with Neon's
 * "-pooler" removed from the endpoint name. Null when the string cannot be
 * read as a URL.
 */
export function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url.trim()).host.toLowerCase();
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
        "Refusing to run: no DATABASE_URL or DIRECT_URL is set (in .env or the environment), so the tests cannot confirm the test database is not production. Copy .env from the main checkout, or set them.",
    };
  }

  return { ok: true, endpoint: testEndpoint };
}
