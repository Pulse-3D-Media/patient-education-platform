import { describe, expect, it } from "vitest";
import { planRelease } from "./release-plan";

/**
 * The check behind "npm run on-production", with made-up connection strings.
 * No real string appears here and nothing connects to anything.
 */

const prodHost = "ep-prod-example-123.us-east-2.aws.neon.tech";
const prodDirect = `postgresql://user:secret@${prodHost}/neondb?sslmode=require`;
const prodPooled = "postgresql://user:secret@ep-prod-example-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const testPooled = "postgresql://user:secret@ep-tst-example-456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const testDirect = "postgresql://user:secret@ep-tst-example-456.us-east-2.aws.neon.tech/neondb?sslmode=require";

const release = { DATABASE_URL: prodPooled, DIRECT_URL: prodDirect };
const command = ["npx", "prisma", "migrate", "deploy"];

describe("planRelease", () => {
  it("hands over production's two strings when .env.release is production", () => {
    const plan = planRelease(release, prodHost, command);
    expect(plan).toEqual({ ok: true, host: prodHost, env: { DATABASE_URL: prodPooled, DIRECT_URL: prodDirect } });
  });

  it("reads a production host pasted with a database name and options, or as a whole address", () => {
    expect(planRelease(release, `${prodHost}/neondb?sslmode=require`, command).ok).toBe(true);
    expect(planRelease(release, prodPooled, command).ok).toBe(true);
  });

  it("refuses when no command was given", () => {
    expect(planRelease(release, prodHost, []).ok).toBe(false);
  });

  it("refuses when .env.release is missing", () => {
    expect(planRelease(null, prodHost, command).ok).toBe(false);
  });

  it("refuses when either string is missing or unreadable", () => {
    expect(planRelease({ DATABASE_URL: prodPooled }, prodHost, command).ok).toBe(false);
    expect(planRelease({ DIRECT_URL: prodDirect }, prodHost, command).ok).toBe(false);
    expect(planRelease({ DATABASE_URL: "nonsense", DIRECT_URL: prodDirect }, prodHost, command).ok).toBe(false);
    expect(planRelease({ DATABASE_URL: " ", DIRECT_URL: prodDirect }, prodHost, command).ok).toBe(false);
  });

  it("refuses when the production host is missing or unreadable", () => {
    expect(planRelease(release, undefined, command).ok).toBe(false);
    expect(planRelease(release, "  ", command).ok).toBe(false);
    expect(planRelease(release, "not a host", command).ok).toBe(false);
  });

  it("refuses a .env.release that points anywhere but production, in whole or in part", () => {
    expect(planRelease({ DATABASE_URL: testPooled, DIRECT_URL: testDirect }, prodHost, command).ok).toBe(false);
    expect(planRelease({ DATABASE_URL: prodPooled, DIRECT_URL: testDirect }, prodHost, command).ok).toBe(false);
    expect(planRelease({ DATABASE_URL: testPooled, DIRECT_URL: prodDirect }, prodHost, command).ok).toBe(false);
  });

  it("never puts a connection string or a password in a refusal", () => {
    const refusals = [
      planRelease(null, prodHost, command),
      planRelease({ DATABASE_URL: testPooled, DIRECT_URL: testDirect }, prodHost, command),
      planRelease({ DATABASE_URL: "nonsense", DIRECT_URL: prodDirect }, prodHost, command),
      planRelease(release, undefined, command),
      planRelease(release, prodHost, []),
    ];
    for (const plan of refusals) {
      expect(plan.ok).toBe(false);
      if (!plan.ok) {
        expect(plan.reason).not.toContain("secret");
        expect(plan.reason).not.toContain("neon.tech");
      }
    }
  });
});
