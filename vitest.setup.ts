import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Runs before every test file. Points the database at the Neon "testing"
 * branch and refuses to run if that could possibly be production.
 *
 * How: .env.test holds TEST_DATABASE_URL (gitignored, like .env). This file
 * copies it into DATABASE_URL and DIRECT_URL before lib/db/client.ts is
 * loaded, so the ordinary Prisma client, unchanged, talks to the test
 * database for the length of the test run.
 *
 * The guard compares host names: the test database must not share a host
 * with either connection string in .env. Neon gives every branch its own
 * host, so a match can only mean someone pasted the production string into
 * .env.test.
 */

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

/** The host part of a Postgres connection string, or null if it cannot be read. */
function hostOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

const testEnv = readEnvFile(".env.test");
const appEnv = readEnvFile(".env");

const testUrl = testEnv.TEST_DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim();
if (!testUrl) {
  throw new Error(
    "Tests need TEST_DATABASE_URL in .env.test: the pooled connection string of the Neon 'testing' branch. Never the production string.",
  );
}

const testHost = hostOf(testUrl);
if (!testHost) {
  throw new Error("TEST_DATABASE_URL in .env.test is not a valid connection string.");
}

for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
  const appHost = hostOf(appEnv[name] ?? process.env[name]);
  if (appHost && appHost === testHost) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL points at the same database as ${name} in .env. Tests must never touch production.`,
    );
  }
}

process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
