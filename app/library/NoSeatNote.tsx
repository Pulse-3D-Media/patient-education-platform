"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { takeMySeatAction } from "@/app/admin/people/actions";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import type { NoSeatHelp } from "@/lib/seats";

/**
 * The line under the videos for someone who does not hold a seat, so has no
 * Send. Which line is noSeatHelp() in lib/seats.ts, decided on the server:
 *
 *   take    the account owner with a seat free: one tap takes it, then the
 *           page is redrawn with Send. The server checks everything again.
 *   people  an office admin: a link to People, where seats are given.
 *   ask     anyone else: ask the clinic's office admin, as before.
 *
 * `lead` is the page's own opening words ("Play any video here."), or none.
 */
export function NoSeatNote({ help, lead, className = "" }: { help: NoSeatHelp; lead?: string; className?: string }) {
  const opening = lead ? `${lead} ` : "";
  // "Play any video here. Sending one ..." on a grid; "Sending a video ..." on its own, as the two pages always said.
  const what = lead ? "one" : "a video";

  if (help === "ask") {
    return (
      <p className={`max-w-2xl text-base text-ink-soft ${className}`}>
        {opening}Sending {what} to a patient needs a surgeon seat: ask your clinic&apos;s office admin if you should have one.
      </p>
    );
  }

  if (help === "people") {
    return (
      <p className={`max-w-2xl text-base text-ink-soft ${className}`}>
        {opening}Sending {what} to a patient needs a surgeon seat.{" "}
        <Link href="/admin/people" className="font-medium text-brand-bright underline underline-offset-2 hover:text-ink">
          Seats are given on the People page
        </Link>
        .
      </p>
    );
  }

  return <TakeSeat opening={opening} what={what} className={className} />;
}

/** The owner's one tap: take the free seat, then redraw the page, which then offers Send. */
function TakeSeat({ opening, what, className }: { opening: string; what: string; className: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function take() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await takeMySeatAction();
        if (result.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("We could not confirm that just now. Try again in a moment.");
      }
    });
  }

  return (
    <div className={`max-w-2xl text-base text-ink-soft ${className}`}>
      <p>{opening}Sending {what} to a patient needs a surgeon seat, and your clinic has one free.</p>
      <button type="button" onClick={take} disabled={pending} className={`${SECONDARY_BUTTON} mt-3 min-h-11 disabled:opacity-60`}>
        {pending ? "Taking a seat..." : "Take a seat"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
