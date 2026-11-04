import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { checkTestDatabase } from "./vitest.guard";

/**
 * Runs before every test file. Points the database at the Neon "testing"
 * branch and refuses to run unless it can show that is not production.
 *
 * How: .env.test holds TEST_DATABASE_URL (gitignored, like .env). This file
 * copies it into DATABASE_URL and DIRECT_URL before lib/db/client.ts is
 * loaded, so the ordinary Prisma client, unchanged, talks to the test
 * database for the length of the test run.
 *
 * The decision itself lives in vitest.guard.ts, which has its own tests.
 * In short: the test string must be readable, every production string that
 * is set must be readable, at least one must be set, and none may name the
 * same Neon endpoint as the test string, pooled or direct. Anything less
 * than that is a refusal, not a pass.
 */

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

const testEnv = readEnvFile(".env.test");
const appEnv = readEnvFile(".env");

const testUrl = testEnv.TEST_DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim();

// The app's own strings come from .env first, then the environment, so a
// production value set either way is compared against.
const production = (["DATABASE_URL", "DIRECT_URL"] as const).map((name) => ({
  name,
  value: appEnv[name] ?? process.env[name],
}));

const result = checkTestDatabase(testUrl, production);
if (!result.ok) {
  throw new Error(result.reason);
}

// The same database, passed by the check above, with one setting added: wait up
// to 15 seconds for a connection instead of Prisma's 5, so a slow connection
// to the remote branch is a wait and not "Can't reach database server".
const testUrlWithPatience = new URL(testUrl!);
testUrlWithPatience.searchParams.set("connect_timeout", "15");

process.env.DATABASE_URL = testUrlWithPatience.toString();
process.env.DIRECT_URL = testUrlWithPatience.toString();

// The tests' own Prisma client, parked where lib/db/client.ts looks first, so
// the tests get more time for a transaction than Prisma's 5 seconds. Only the
// tests: the app's transactions keep the limits in its own code. Why: several
// transactions on one row take turns, and each costs about 70ms a statement
// from this computer, so five tries at one printed QR code at once ran past 5
// seconds and failed for no reason but the distance to the database.
(globalThis as unknown as { prisma?: PrismaClient }).prisma = new PrismaClient({
  transactionOptions: { maxWait: 15_000, timeout: 45_000 },
});
