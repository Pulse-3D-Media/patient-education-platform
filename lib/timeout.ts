/**
 * Give a piece of work a time limit.
 *
 * `withTimeout(work, ms, what)` waits for `work` (a promise) for at most
 * `ms` milliseconds. If it finishes in time, its value comes back as usual.
 * If it does not, a TimeoutError is thrown instead, and `what` names the
 * thing that was slow in the message ("Clerk took longer than 5000 ms").
 *
 * The slow work itself is not stopped: a promise cannot be cancelled from
 * the outside. It simply carries on in the background and its answer, when
 * it comes, is ignored. That is fine for a lookup that is only being read.
 *
 * The timer is cleared whichever way it ends, so a request that finished
 * quickly does not leave a timer running behind it.
 *
 * Pure: no database, no Clerk, safe anywhere.
 */

/** Thrown by withTimeout() when the work did not finish in time. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
