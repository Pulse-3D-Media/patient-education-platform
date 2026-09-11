import { describe, expect, it } from "vitest";
import { checkTestDatabase, endpointOf } from "./vitest.guard";

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
