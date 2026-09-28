"use client";

import { useTransition } from "react";
import { CalmFrame } from "./CalmFrame";
import { ReplayIcon } from "./icons";

/**
 * The calm frame with one button, Try again, for the pages that stand in
 * when a page could not be drawn (app/error.tsx, app/global-error.tsx and
 * the patient's app/watch/error.tsx). Those files are React error
 * boundaries, which have to be client components, which is why this piece
 * is one too.
 *
 * What it never shows: the error, its message, its code or its digest.
 * The detail is in the server log, and the pages that draw this decide the
 * words from nothing more than the error's digest (lib/clerk-timeout.ts).
 *
 * `retry` comes from Next.js: it fetches the page again. While that runs
 * the button says so, and if it fails again this same page is shown again.
 */
export function CalmError({ heading, body, retry }: { heading: string; body: string; retry: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <CalmFrame icon={<ReplayIcon className="h-8 w-8" />} heading={heading} body={body}>
      <button
        type="button"
        onClick={() => startTransition(() => retry())}
        disabled={pending}
        className="mt-7 flex min-h-14 items-center rounded-full bg-brand px-8 text-[19px] font-semibold text-on-brand shadow-[0_6px_18px_-8px_rgba(18,32,42,.45)] transition active:scale-[0.98] disabled:opacity-70 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#12202a]"
      >
        {pending ? "Trying again..." : "Try again"}
      </button>
    </CalmFrame>
  );
}
