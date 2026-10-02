import { withTimeout } from "./timeout";

/**
 * A time limit on every question the app asks Clerk (the sign-in service)
 * while a page is being drawn, and the one error that stands for "Clerk
 * did not answer".
 *
 * Why: lib/clinic.ts asks Clerk who the signed-in person is on every staff
 * page request. Without a limit, a slow or unreachable Clerk would leave a
 * surgeon staring at a blank, loading page mid-consult. With it, the page
 * gives up after CLERK_TIMEOUT_MS and shows a calm "We could not reach
 * sign-in just now" page with a Try again button (the error pages under
 * app/ recognise the error by its digest, below).
 *
 * How the error pages recognise it: Next.js hides the message of an error
 * thrown on the server from the browser (so nothing sensitive leaks) and
 * hands the browser only the error's `digest`, a short identifier. An
 * error that already carries a digest keeps it, so this one is set to a
 * fixed word, and isSignInUnavailable() checks for that word. That is the
 * whole mechanism.
 *
 * The patient page never asks Clerk, so none of this touches it.
 *
 * Pure: no Clerk import, no database, safe for the browser (the error
 * pages, which run in the browser, import isSignInUnavailable from here).
 */

/** How long a page waits for Clerk before giving up. Clerk normally answers in well under a second. */
export const CLERK_TIMEOUT_MS = 5_000;

/** The digest that marks "Clerk did not answer". The error pages look for exactly this. */
export const SIGN_IN_UNAVAILABLE_DIGEST = "SIGN_IN_UNAVAILABLE";

/** Thrown when Clerk timed out or failed. The original failure is kept as `cause`, for the server log only. */
export class SignInUnavailableError extends Error {
  /** Read by Next.js and handed to the browser in place of the message. */
  readonly digest = SIGN_IN_UNAVAILABLE_DIGEST;

  constructor(what: string, cause: unknown) {
    super(`Sign-in could not be reached: ${what}`, { cause });
    this.name = "SignInUnavailableError";
  }
}

/** Is this the error above (or its digest, which is all the browser gets)? */
export function isSignInUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && error.digest === SIGN_IN_UNAVAILABLE_DIGEST;
}

/**
 * Ask Clerk something, with the time limit. `work` is the Clerk call (a
 * promise) and `what` names it for the log ("the clinic membership").
 * Whether Clerk is slow (a TimeoutError) or answers with a failure (the
 * network, a 5xx, a bad key), the caller gets one SignInUnavailableError,
 * so every staff page treats both the same way: the calm page, Try again.
 *
 * `ms` exists for the tests; the app always uses CLERK_TIMEOUT_MS.
 */
export async function askClerk<T>(work: Promise<T>, what: string, ms: number = CLERK_TIMEOUT_MS): Promise<T> {
  try {
    return await withTimeout(work, ms, `Clerk (${what})`);
  } catch (error) {
    // The kind of failure goes to the server log; the browser sees only the digest.
    console.error("Clerk could not be reached:", what, error instanceof Error ? error.name : "unknown error");
    throw new SignInUnavailableError(what, error);
  }
}
