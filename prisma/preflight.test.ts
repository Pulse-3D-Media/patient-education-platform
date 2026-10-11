import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScriptTarget, PRODUCTION_FLAG } from "./preflight";

/**
 * The operator scripts' production check, with made-up connection strings
 * only. Nothing here connects to anything.
 *
 * "prod" stands for a pretend production endpoint, "tst" for a pretend
 * testing branch. Neon's pooled address is the endpoint name with "-pooler"
 * on the end.
 */

const prodPooled = "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const prodDirect = "postgresql://user:secret@ep-prod-example-123.us-east-2.aws.neon.tech/neondb?sslmode=require";
const testPooled = "postgresql://user:secret@ep-tst-example-456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const prodHost = "ep-prod-example-123.us-east-2.aws.neon.tech";

/** Every reason and host the check gives back, for "never contains the password" checks. */
function printed(result: ReturnType<typeof checkScriptTarget>) {
  return result.ok ? result.host : result.reason;
}

describe("checkScriptTarget", () => {
  it("runs against a database that is clearly not production, and says so", () => {
    const result = checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: prodHost }, ["clinic_1", "PAUSED"]);
    expect(result).toEqual({ ok: true, host: "ep-tst-example-456.us-east-2.aws.neon.tech", production: false, args: ["clinic_1", "PAUSED"] });
  });

  it("refuses production without --production, and names the host", () => {
    const result = checkScriptTarget({ DATABASE_URL: prodPooled, PRODUCTION_DATABASE_HOST: prodHost }, ["clinic_1", "PAUSED"]);
    expect(result.ok).toBe(false);
    expect(printed(result)).toContain(prodHost);
    expect(printed(result)).toContain(PRODUCTION_FLAG);
  });

  it("runs against production with --production, and takes the flag out of the arguments wherever it was", () => {
    for (const argv of [
      ["clinic_1", "PAUSED", "a reason", PRODUCTION_FLAG],
      [PRODUCTION_FLAG, "clinic_1", "PAUSED", "a reason"],
      ["clinic_1", PRODUCTION_FLAG, "PAUSED", "a reason"],
    ]) {
      const result = checkScriptTarget({ DATABASE_URL: prodPooled, PRODUCTION_DATABASE_HOST: prodHost }, argv);
      expect(result).toEqual({ ok: true, host: prodHost, production: true, args: ["clinic_1", "PAUSED", "a reason"] });
    }
  });

  it("counts the pooled and direct addresses of production as production, whichever one each side names", () => {
    for (const [url, host] of [
      [prodPooled, prodHost],
      [prodDirect, prodHost],
      [prodDirect, "ep-prod-example-123-pooler.us-east-2.aws.neon.tech"],
      [prodPooled, prodDirect],
      [prodPooled, "  EP-PROD-EXAMPLE-123.us-east-2.aws.neon.tech  "],
    ]) {
      const result = checkScriptTarget({ DATABASE_URL: url, PRODUCTION_DATABASE_HOST: host }, []);
      expect(result.ok).toBe(false);
      expect(checkScriptTarget({ DATABASE_URL: url, PRODUCTION_DATABASE_HOST: host }, [PRODUCTION_FLAG])).toMatchObject({ ok: true, production: true });
    }
  });

  it("treats the target as production when PRODUCTION_DATABASE_HOST is missing or unreadable (fails closed)", () => {
    for (const marker of [undefined, "", "   ", "http://", "postgresql://"]) {
      const refused = checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: marker }, ["clinic_1"]);
      expect(refused.ok).toBe(false);
      expect(printed(refused)).toContain("treats it as production");

      // With the flag it runs, and is reported as production, since nothing shows otherwise.
      const allowed = checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: marker }, ["clinic_1", PRODUCTION_FLAG]);
      expect(allowed).toMatchObject({ ok: true, production: true, args: ["clinic_1"] });
    }
  });

  it("holds --production to its word: refused for a database that is clearly not production", () => {
    const result = checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: prodHost }, [PRODUCTION_FLAG]);
    expect(result.ok).toBe(false);
    expect(printed(result)).toContain("is not the production database");
  });

  it("refuses outright, flag or not, when DATABASE_URL is missing or unreadable", () => {
    for (const url of [undefined, "", "  ", "not a url"]) {
      for (const argv of [[], [PRODUCTION_FLAG]]) {
        const result = checkScriptTarget({ DATABASE_URL: url, PRODUCTION_DATABASE_HOST: prodHost }, argv);
        expect(result.ok).toBe(false);
        expect(printed(result)).toContain("DATABASE_URL");
      }
    }
  });

  it("never gives back a password, a user name or a whole connection string", () => {
    const cases = [
      checkScriptTarget({ DATABASE_URL: prodPooled, PRODUCTION_DATABASE_HOST: prodHost }, []),
      checkScriptTarget({ DATABASE_URL: prodPooled, PRODUCTION_DATABASE_HOST: prodHost }, [PRODUCTION_FLAG]),
      checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: prodHost }, []),
      checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: prodHost }, [PRODUCTION_FLAG]),
      checkScriptTarget({ DATABASE_URL: testPooled }, []),
      checkScriptTarget({ DATABASE_URL: testPooled, PRODUCTION_DATABASE_HOST: prodDirect }, []),
      checkScriptTarget({ DATABASE_URL: "postgresql://user:secret@/nohost" }, []),
    ];
    for (const result of cases) {
      const text = printed(result);
      expect(text).not.toContain("secret");
      expect(text).not.toContain("user:");
      expect(text).not.toContain("postgresql://");
    }
  });
});

describe("the operator scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; prisma?: { seed?: string } };
  const commands = [...Object.values(pkg.scripts), pkg.prisma?.seed ?? ""];

  it("every script run from package.json calls preflight() before its first query", () => {
    const files = commands.flatMap((command) => command.match(/prisma\/[\w-]+\.ts/g) ?? []);
    expect(files.length).toBeGreaterThan(0);
    for (const file of new Set(files)) {
      const source = readFileSync(file, "utf8");
      const check = source.indexOf("preflight()");
      expect(check, `${file} must call preflight()`).toBeGreaterThan(-1);
      const firstQuery = source.search(/\bprisma\.\w+\.|\b(linkClinicToClerkOrg|setClinicPlan|setClinicStatusByStaff)\(/);
      expect(firstQuery, `${file} must call preflight() before it touches the database`).toBeGreaterThan(check);
    }
  });

  it("no npm script runs a Prisma command that changes a database's shape (rule 3)", () => {
    for (const command of commands) {
      expect(command).not.toMatch(/migrate\s+(dev|reset|deploy)|db\s+push/);
    }
  });
});
