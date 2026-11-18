import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkCleanupError, demoCleanupClerk, isTestClerkSecretKey } from "./clerk-demo-cleanup";

/**
 * The clean-up's calls to Clerk, with a pretend fetch: nothing here reaches
 * Clerk. The real Clerk test instance is the check that the addresses and
 * answers are what Clerk documents. Every key and id is made up.
 */

type Call = { method: string; url: string; auth: string | null };
let calls: Call[];
let answers: ((call: Call) => { status: number; body?: unknown })[];

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_madeupclerkkey");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", url, auth: new Headers(init.headers).get("Authorization") };
    calls.push(call);
    const answer = answers.shift()?.(call) ?? { status: 500 };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isTestClerkSecretKey", () => {
  it("accepts only a test-instance secret key", () => {
    expect(isTestClerkSecretKey("sk_test_abc")).toBe(true);
    for (const key of ["sk_live_abc", "pk_test_abc", "", undefined]) expect(isTestClerkSecretKey(key)).toBe(false);
  });
});

describe("demoCleanupClerk", () => {
  it("refuses to send anything with a live key", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_madeupclerkkey");
    await expect(demoCleanupClerk.deleteOrganization("org_fake")).rejects.toBeInstanceOf(ClerkCleanupError);
    expect(calls).toEqual([]);
  });

  it("lists an organization's people, and says null when the organization is gone", async () => {
    answers.push(() => ({ status: 200, body: { data: [{ public_user_data: { user_id: "user_a" } }, { public_user_data: { user_id: "user_b" } }], total_count: 2 } }));
    expect(await demoCleanupClerk.organizationMembers("org_fake")).toEqual(["user_a", "user_b"]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.clerk.com/v1/organizations/org_fake/memberships?limit=100&offset=0", auth: "Bearer sk_test_madeupclerkkey" });

    answers.push(() => ({ status: 404 }));
    expect(await demoCleanupClerk.organizationMembers("org_gone")).toBeNull();
  });

  it("treats an organization or user that is already gone as deleted", async () => {
    answers.push(() => ({ status: 404 }), () => ({ status: 404 }));
    await expect(demoCleanupClerk.deleteOrganization("org_gone")).resolves.toBeUndefined();
    await expect(demoCleanupClerk.deleteUser("user_gone")).resolves.toBeUndefined();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE https://api.clerk.com/v1/organizations/org_gone",
      "DELETE https://api.clerk.com/v1/users/user_gone",
    ]);
  });

  it("reads whether a user is Pulse staff and how many organizations they are in", async () => {
    answers.push(() => ({ status: 200, body: { public_metadata: { pulseStaff: true } } }), () => ({ status: 200, body: { data: [], total_count: 0 } }));
    expect(await demoCleanupClerk.userState("user_staff")).toEqual({ exists: true, pulseStaff: true, organizations: 0 });

    answers.push(() => ({ status: 200, body: { public_metadata: { pulseStaff: "true" } } }), () => ({ status: 200, body: { data: [{}], total_count: 3 } }));
    expect(await demoCleanupClerk.userState("user_other")).toEqual({ exists: true, pulseStaff: false, organizations: 3 });

    answers.push(() => ({ status: 404 }));
    expect(await demoCleanupClerk.userState("user_gone")).toEqual({ exists: false });
  });

  it("fails closed on an organization count it cannot trust, so nobody is deleted on a guess", async () => {
    for (const body of [{ data: [] }, { data: [], total_count: "0" }, { total_count: 0 }, { data: [], total_count: -1 }, { data: [], total_count: 0.5 }, {}]) {
      answers.push(() => ({ status: 200, body: { public_metadata: {} } }), () => ({ status: 200, body }));
      await expect(demoCleanupClerk.userState("user_odd"), JSON.stringify(body)).rejects.toBeInstanceOf(ClerkCleanupError);
    }
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("escapes ids, so an odd id can only name one record", async () => {
    answers.push(() => ({ status: 404 }));
    await demoCleanupClerk.deleteUser("user_x/../organizations/org_y");
    expect(calls[0].url).toBe("https://api.clerk.com/v1/users/user_x%2F..%2Forganizations%2Forg_y");
  });

  it("fails with the step and status only, never the key or the id", async () => {
    answers.push(() => ({ status: 500, body: { errors: [{ message: "something about user_secretid" }] } }));
    const error = await demoCleanupClerk.deleteUser("user_secretid").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClerkCleanupError);
    const message = (error as Error).message;
    expect(message).toContain("500");
    expect(message).not.toContain("user_secretid");
    expect(message).not.toContain("sk_test");
  });
});
