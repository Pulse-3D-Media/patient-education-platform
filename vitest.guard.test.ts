import { describe, expect, it } from "vitest";
import { checkTestDatabase, endpointOf, productionStrings } from "./vitest.guard";

/**
 * The test-database guard, checked with made-up connection strings. No real
 * string appears here and nothing connects to anything.
 *
 * "prod" below stands for a pretend production endpoint, "tst" for a
 * pretend testing branch. Neon's pooled address is the endpoint name with
 * "-pooler" on the end.
 */

const prodDirect = "postgresql://user:secret@ep-prod-example-123.us-east-2.aws.neon.tech/neondb?sslmode=require";
const prodPooled = "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const testPooled = "postgresql://user:secret@ep-tst-example-456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

function withProduction(env: { DATABASE_URL?: string; DIRECT_URL?: string }) {
  return [
    { name: "DATABASE_URL", value: env.DATABASE_URL },
    { name: "DIRECT_URL", value: env.DIRECT_URL },
  ];
}

describe("endpointOf", () => {
  it("treats the pooled and direct addresses of one endpoint as the same database", () => {
    expect(endpointOf(prodPooled)).toBe(endpointOf(prodDirect));
    expect(endpointOf(prodDirect)).toBe("ep-prod-example-123.us-east-2.aws.neon.tech");
  });

  it("ignores case and surrounding spaces", () => {
    expect(endpointOf("  POSTGRESQL://u:p@EP-Prod-Example-123-POOLER.US-EAST-2.aws.neon.tech/db ")).toBe(
      "ep-prod-example-123.us-east-2.aws.neon.tech",
    );
  });

  it("only strips -pooler from the end of the endpoint name", () => {
    expect(endpointOf("postgresql://u:p@ep-pooler-fan-1.region.aws.neon.tech/db")).toBe("ep-pooler-fan-1.region.aws.neon.tech");
  });

  it("gives one form for every spelling of one host: no port, no trailing dot, no pooler suffix, lower case", () => {
    const expected = "ep-prod-example-123.us-east-2.aws.neon.tech";
    for (const host of [
      "ep-prod-example-123.us-east-2.aws.neon.tech:5432",
      "ep-prod-example-123.us-east-2.aws.neon.tech:6543",
      "ep-prod-example-123.us-east-2.aws.neon.tech.",
      "ep-prod-example-123.us-east-2.aws.neon.tech.:5432",
      "ep-prod-example-123-pooler.us-east-2.aws.neon.tech:5432",
      "ep-prod-example-123-pooler.us-east-2.aws.neon.tech.",
      "EP-Prod-Example-123-POOLER.US-EAST-2.aws.neon.tech.:5432",
    ]) {
      expect(endpointOf(`postgresql://u:p@${host}/db`), host).toBe(expected);
    }
  });

  it("reduces a host with no dots the same way", () => {
    expect(endpointOf("postgresql://u:p@ep-one-pooler:5432/db")).toBe("ep-one");
    expect(endpointOf("postgresql://u:p@localhost.:5432/db")).toBe("localhost");
  });

  it("returns null when a string has no host once the spelling is taken away", () => {
    expect(endpointOf("postgresql://u:p@:5432/db")).toBeNull();
    expect(endpointOf("postgresql://u:p@./db")).toBeNull();
  });

  it("returns null for anything that is not a connection string", () => {
    expect(endpointOf(undefined)).toBeNull();
    expect(endpointOf("")).toBeNull();
    expect(endpointOf("not a url")).toBeNull();
  });
});

describe("checkTestDatabase", () => {
  it("allows a testing endpoint that differs from both production strings", () => {
    const result = checkTestDatabase(testPooled, withProduction({ DATABASE_URL: prodPooled, DIRECT_URL: prodDirect }));
    expect(result).toEqual({ ok: true, endpoint: "ep-tst-example-456.us-east-2.aws.neon.tech" });
  });

  it("refuses the identical production string", () => {
    const result = checkTestDatabase(prodPooled, withProduction({ DATABASE_URL: prodPooled, DIRECT_URL: prodDirect }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DATABASE_URL");
  });

  it("refuses the pooled address of production when only the direct one is configured", () => {
    const result = checkTestDatabase(prodPooled, withProduction({ DIRECT_URL: prodDirect }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DIRECT_URL");
  });

  it("refuses the direct address of production when only the pooled one is configured", () => {
    const result = checkTestDatabase(prodDirect, withProduction({ DATABASE_URL: prodPooled }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DATABASE_URL");
  });

  it("refuses production however the test string or the production string spells its host", () => {
    const withPort = "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";
    const withDot = "postgresql://user:secret@ep-prod-example-123.us-east-2.aws.neon.tech./neondb?sslmode=require";
    for (const [test, production] of [
      [withPort, prodPooled],
      [withPort, prodDirect],
      [withDot, prodPooled],
      [prodPooled, withPort],
      [prodDirect, withDot],
      [withPort, withDot],
    ]) {
      const result = checkTestDatabase(test, withProduction({ DATABASE_URL: production }));
      expect(result.ok, `${test} against ${production}`).toBe(false);
      if (!result.ok) expect(result.reason).toContain("same database");
    }
  });

  it("refuses a production string that has no host left once the spelling is taken away", () => {
    const result = checkTestDatabase(testPooled, withProduction({ DATABASE_URL: "postgresql://u:p@./db", DIRECT_URL: prodDirect }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DATABASE_URL");
  });

  it("still allows a real testing endpoint spelled with a port", () => {
    const result = checkTestDatabase(
      "postgresql://user:secret@ep-tst-example-456-pooler.us-east-2.aws.neon.tech:5432/neondb",
      withProduction({ DATABASE_URL: prodPooled, DIRECT_URL: prodDirect }),
    );
    expect(result).toEqual({ ok: true, endpoint: "ep-tst-example-456.us-east-2.aws.neon.tech" });
  });

  it("refuses when there is no production string to compare against", () => {
    const result = checkTestDatabase(testPooled, withProduction({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("cannot confirm");
  });

  it("refuses when a production string is set but cannot be read", () => {
    const result = checkTestDatabase(testPooled, withProduction({ DATABASE_URL: "not a url", DIRECT_URL: prodDirect }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("DATABASE_URL");
  });

  it("refuses when the test string is missing or unreadable", () => {
    expect(checkTestDatabase(undefined, withProduction({ DATABASE_URL: prodPooled })).ok).toBe(false);
    expect(checkTestDatabase("   ", withProduction({ DATABASE_URL: prodPooled })).ok).toBe(false);
    expect(checkTestDatabase("nonsense", withProduction({ DATABASE_URL: prodPooled })).ok).toBe(false);
  });

  it("never puts a connection string in its reason", () => {
    const results = [
      checkTestDatabase(prodPooled, withProduction({ DATABASE_URL: prodPooled })),
      checkTestDatabase(testPooled, withProduction({ DATABASE_URL: "not a url" })),
      checkTestDatabase(testPooled, withProduction({})),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toContain("secret");
    }
  });
});

/**
 * What names production now that .env points at the testing branch and the
 * production strings live in .env.release (November 2026).
 */
describe("productionStrings", () => {
  const prodHost = "ep-prod-example-123.us-east-2.aws.neon.tech";
  const testDirect = "postgresql://user:secret@ep-tst-example-456.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const local = "postgresql://user:secret@localhost:5432/pulse_test";
  // The new arrangement: .env is the testing branch and names the production host.
  const newEnv = { DATABASE_URL: testPooled, DIRECT_URL: testDirect, PRODUCTION_DATABASE_HOST: prodHost };
  const release = { DATABASE_URL: prodPooled, DIRECT_URL: prodDirect };

  function check(testUrl: string, sources: Parameters<typeof productionStrings>[0]) {
    return checkTestDatabase(testUrl, productionStrings(sources));
  }

  it("refuses production when only PRODUCTION_DATABASE_HOST names it, pooled or direct", () => {
    const sources = { appEnv: newEnv, releaseEnv: {}, processEnv: {} };
    expect(check(prodPooled, sources).ok).toBe(false);
    expect(check(prodDirect, sources).ok).toBe(false);
  });

  it("refuses production when only .env.release names it", () => {
    // The host line is missing, and .env is the testing branch.
    const sources = { appEnv: { DATABASE_URL: testPooled, DIRECT_URL: testDirect }, releaseEnv: release, processEnv: {} };
    expect(check(prodPooled, sources).ok).toBe(false);
    expect(check(prodDirect, sources).ok).toBe(false);
  });

  it("lets the tests run on the local database and on the testing branch .env points at", () => {
    const sources = { appEnv: newEnv, releaseEnv: release, processEnv: {} };
    expect(check(local, sources).ok).toBe(true);
    // .env's own DATABASE_URL is the testing branch, which is not production.
    expect(check(testPooled, sources).ok).toBe(true);
  });

  it("reads a production host that was pasted with a database name and options after it", () => {
    const pasted = `${prodHost}/neondb?sslmode=require`;
    const sources = { appEnv: { ...newEnv, PRODUCTION_DATABASE_HOST: pasted }, releaseEnv: {}, processEnv: {} };
    expect(check(prodPooled, sources).ok).toBe(false);
    expect(check(local, sources).ok).toBe(true);
  });

  it("with no host line, still treats .env's own strings as production, as it always did", () => {
    // A checkout whose .env is the old production one, and GitHub's checks.
    const oldEnv = { appEnv: { DATABASE_URL: prodPooled, DIRECT_URL: prodDirect }, releaseEnv: {}, processEnv: {} };
    expect(check(prodDirect, oldEnv).ok).toBe(false);
    expect(check(testPooled, oldEnv).ok).toBe(true);
    const github = { appEnv: {}, releaseEnv: {}, processEnv: { DATABASE_URL: prodPooled, DIRECT_URL: prodPooled } };
    expect(check(prodDirect, github).ok).toBe(false);
    expect(check(local, github).ok).toBe(true);
  });

  it("takes the host line from the environment when .env has none", () => {
    const sources = { appEnv: {}, releaseEnv: {}, processEnv: { PRODUCTION_DATABASE_HOST: prodHost } };
    expect(check(prodPooled, sources).ok).toBe(false);
    expect(check(local, sources).ok).toBe(true);
  });

  it("refuses when nothing names production at all", () => {
    expect(check(local, { appEnv: {}, releaseEnv: {}, processEnv: {} }).ok).toBe(false);
  });

  it("refuses when something that names production cannot be read", () => {
    const badHost = { appEnv: { ...newEnv, PRODUCTION_DATABASE_HOST: "not a host" }, releaseEnv: {}, processEnv: {} };
    expect(check(local, badHost).ok).toBe(false);
    const badRelease = { appEnv: newEnv, releaseEnv: { DATABASE_URL: "nonsense" }, processEnv: {} };
    expect(check(local, badRelease).ok).toBe(false);
  });

  it("never puts a connection string in a refusal", () => {
    const result = check(prodPooled, { appEnv: newEnv, releaseEnv: release, processEnv: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("secret");
      expect(result.reason).not.toContain("neon.tech");
    }
  });
});
