"use client";

import Link from "next/link";
import { useTransition } from "react";
import { isSignInUnavailable } from "@/lib/clerk-timeout";

/**
 * What a signed-in person sees when a staff page (the library, the admin
 * area, the Pulse dashboard) could not be drawn: the database did not
 * answer, a lookup failed, or Clerk was too slow (lib/clerk-timeout.ts).
 * One plain sentence, a Try again button, and a way back. Never the error
 * itself: Next.js hands the browser only the error's digest, and not even
 * that is shown. The one thing read from the error is whether its digest
 * is the sign-in one, which changes the words and nothing else.
 *
 * error.tsx files are React error boundaries and must be client
 * components; each staff surface's error.tsx draws this with its own way
 * back. In the tokens (app/globals.css), so inside the library's shell it
 * takes the clinic's light or dark mode; on /admin, whose layout draws no
 * shell, it fills the screen in the dark values, because the clinic's own
 * look could not be read either.
 *
 * `retry` comes from Next.js: it fetches the page again. While that runs
 * the button says so, and if it fails again this same page is shown again.
 */
export function StaffError({ error, retry, backHref, backLabel }: { error: unknown; retry: () => void; backHref: string; backLabel: string }) {
  const [pending, startTransition] = useTransition();
  const signIn = isSignInUnavailable(error);
  return (
    <main className="flex flex-1 flex-col bg-ground px-5 py-6 text-ink sm:px-8">
      <div className="mx-auto w-full max-w-xl py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">{signIn ? "We could not reach sign-in just now" : "Something went wrong loading this page"}</h1>
        <p className="mt-3 text-ink-soft">
          {signIn
            ? "Every staff page checks who is signed in first, and that check did not answer in time. Try again in a moment."
            : "Try again in a moment. If it keeps happening, let Pulse 3D know."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => startTransition(() => retry())}
            disabled={pending}
            className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-on-brand transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? "Trying again..." : "Try again"}
          </button>
          <Link
            href={backHref}
            className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-sm font-medium text-ink-soft transition hover:border-brand hover:text-ink"
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </main>
  );
}
