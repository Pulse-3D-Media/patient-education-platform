import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./timeout";

/** The time limit, with the clock under the test's control. No database. */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A promise that answers only when the test says so. */
function later<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withTimeout", () => {
  it("passes a value through when the work finishes in time", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 1000, "the lookup");
    await vi.advanceTimersByTimeAsync(500);
    work.resolve("done");
    await expect(wrapped).resolves.toBe("done");
  });

  it("passes a failure through unchanged when the work fails in time", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 1000, "the lookup");
    const failure = new Error("the service said no");
    work.reject(failure);
    await expect(wrapped).rejects.toBe(failure);
  });

  it("throws a TimeoutError naming the slow thing once the limit passes", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 1000, "Clerk");
    // Attach the expectation before the clock moves, so the rejection is never unhandled.
    const outcome = expect(wrapped).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
    await expect(wrapped).rejects.toThrow("Clerk took longer than 1000 ms");
  });

  it("does not time out one millisecond before the limit", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 1000, "the lookup");
    await vi.advanceTimersByTimeAsync(999);
    work.resolve("just in time");
    await expect(wrapped).resolves.toBe("just in time");
  });

  it("clears its timer when the work finishes, so nothing is left running", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 1000, "the lookup");
    work.resolve("done");
    await wrapped;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late answer from work that already timed out", async () => {
    const work = later<string>();
    const wrapped = withTimeout(work.promise, 100, "the lookup");
    const outcome = expect(wrapped).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    // The slow work answering afterwards changes nothing and throws nothing.
    work.resolve("too late");
    await vi.advanceTimersByTimeAsync(10);
    await expect(wrapped).rejects.toThrow(TimeoutError);
  });
});
