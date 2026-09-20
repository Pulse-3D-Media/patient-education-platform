"use client";

import { useActionState } from "react";
import { retryBillingEventAction } from "../actions";

/**
 * "Try again" on one stuck notification. A client component only because a
 * button needs to show that it is working and what came back. The work, and
 * the check that the person is Pulse staff, are in the Server Action.
 */
export function RetryButton({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(retryBillingEventAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="eventId" value={eventId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center whitespace-nowrap rounded-lg border border-white/15 px-3 text-sm font-medium text-white transition hover:border-[#2a829b] disabled:opacity-60"
      >
        {pending ? "Trying..." : "Try again"}
      </button>
      <span aria-live="polite" className="max-w-[14rem] text-sm">
        {state?.ok && <span className="text-[#5fb8d4]">{state.ok}</span>}
        {state?.error && <span className="text-[#f3b94d]">{state.error}</span>}
      </span>
    </form>
  );
}
