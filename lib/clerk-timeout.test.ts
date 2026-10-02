import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_TIMEOUT_MS, SIGN_IN_UNAVAILABLE_DIGEST, SignInUnavailableError, askClerk, isSignInUnavailable } from "./clerk-timeout";
import { TimeoutError } from "./timeout";

/**
 * The time limit on a Clerk call and the error that stands for "Clerk did
 * not answer". Pure: the clock is the test's, and nothing real is called.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("askClerk", () => {
  it("passes the answer through when Clerk answers in time", async () => {
    await expect(askClerk(Promise.resolve({ data: [1] }), "the clinic membership")).resolves.toEqual({ data: [1] });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("gives up after the limit with the sign-in error, keeping the timeout as its cause", async () => {
    const never = new Promise<never>(() => {});
    const asked = askClerk(never, "the clinic membership");
    const outcome = expect(asked).rejects.toBeInstanceOf(SignInUnavailableError);
    await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS);
    await outcome;
    await expect(asked).rejects.toMatchObject({ digest: SIGN_IN_UNAVAILABLE_DIGEST, cause: expect.any(TimeoutError) });
  });

  it("turns a failure from Clerk into the same sign-in error, with the failure as its cause", async () => {
    const failure = Object.assign(new Error("Clerk: 502 Bad Gateway"), { status: 502 });
    const asked = askClerk(Promise.reject(failure), "the staff user");
    await expect(asked).rejects.toBeInstanceOf(SignInUnavailableError);
    await expect(asked).rejects.toMatchObject({ digest: SIGN_IN_UNAVAILABLE_DIGEST, cause: failure });
  });

  it("logs only the kind of failure, never what Clerk said", async () => {
    const failure = new Error("secret-looking detail sk_test_abc");
    await askClerk(Promise.reject(failure), "the staff user").catch(() => {});
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls[0].join(" ");
    expect(logged).toContain("the staff user");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("sk_test_abc");
  });

  it("uses the limit it is given", async () => {
    const never = new Promise<never>(() => {});
    const asked = askClerk(never, "a lookup", 200);
    const outcome = expect(asked).rejects.toBeInstanceOf(SignInUnavailableError);
    await vi.advanceTimersByTimeAsync(200);
    await outcome;
  });
});

describe("isSignInUnavailable", () => {
  it("recognises the error itself, and a plain object carrying only its digest (what the browser gets)", () => {
    expect(isSignInUnavailable(new SignInUnavailableError("x", null))).toBe(true);
    expect(isSignInUnavailable({ digest: SIGN_IN_UNAVAILABLE_DIGEST })).toBe(true);
    expect(isSignInUnavailable(Object.assign(new Error("Something"), { digest: SIGN_IN_UNAVAILABLE_DIGEST }))).toBe(true);
  });

  it("is false for every other error, and for nothing at all", () => {
    expect(isSignInUnavailable(new Error("database down"))).toBe(false);
    expect(isSignInUnavailable(Object.assign(new Error("x"), { digest: "1234567890" }))).toBe(false);
    expect(isSignInUnavailable(new TimeoutError("Clerk", 5000))).toBe(false);
    expect(isSignInUnavailable(null)).toBe(false);
    expect(isSignInUnavailable(undefined)).toBe(false);
    expect(isSignInUnavailable("SIGN_IN_UNAVAILABLE")).toBe(false);
  });
});
