import { prisma } from "./client";

/**
 * The lock that makes "Add captions" for one video take turns
 * (requestCaptions() in lib/mux-captions.ts).
 *
 * Why it is needed: Add captions first asks Mux whether the video already
 * has English captions, and only asks Mux to make them if it does not. Two
 * presses at the same moment (two tabs, a double click that got through)
 * could both hear "none yet" before either request landed, and Mux would
 * then make two English tracks. With this lock the second press waits until
 * the first has finished, then asks Mux again and hears that captions are
 * already being made.
 *
 * A named Postgres lock (an "advisory lock", like the admin change lock in
 * lib/db/admin-change-lock.ts), held only while Mux is asked, which is ten
 * seconds at most per call. Nothing but another Add captions for the same
 * video ever waits for it. Taken with two numbers: what the lock is for, and
 * the video's id turned into a number. It is released when the work
 * finishes, whether it succeeded or threw.
 *
 * `work` must not write to the database (it runs outside the lock's
 * transaction); it is only for the two calls to Mux.
 */

/** What the lock is for. Different from every other lock's first number. */
const CAPTION_REQUEST_LOCK = 20261117;

/** Two Mux calls of up to ten seconds each, plus a second press waiting for a first. */
const HOLD_MS = 45_000;

export async function withCaptionRequestLock<T>(videoId: string, work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CAPTION_REQUEST_LOCK}::int, hashtext(${videoId}))`;
      return work();
    },
    { maxWait: 10_000, timeout: HOLD_MS },
  );
}
