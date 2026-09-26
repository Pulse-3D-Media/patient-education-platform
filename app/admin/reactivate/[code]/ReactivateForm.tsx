"use client";

import { useActionState } from "react";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { reactivateLinkAction } from "./actions";

/**
 * The bottom of /admin/reactivate/<code>: the Confirm form for a paused
 * link, the server's sentence after a press, or the sentence for a link
 * that cannot be turned back on.
 *
 * One hidden field (which link) and one button. The button is a POST to
 * reactivateLinkAction, which does every check again on the server; nothing
 * on this page changes the link until that press.
 *
 * After a successful press the page re-renders from the server (the action
 * revalidates it), so the details above say "working until" and this piece
 * is asked to draw the not-paused sentence. It keeps the server's "Done"
 * sentence instead: the piece stays mounted through the refresh, so what
 * the press came to is what the admin reads, and the button is gone, so a
 * second press is not even offered (the server would refuse it anyway).
 */
export function ReactivateForm({
  code,
  paused,
  days,
  renewalsLeft,
  whyNot,
}: {
  code: string;
  /** True when the link can be turned back on right now, which is the only time the button is drawn. */
  paused: boolean;
  days: number;
  renewalsLeft: number;
  /** The sentence for a link that cannot be turned back on (shown when `paused` is false and nothing was just pressed). */
  whyNot: string;
}) {
  const [state, action, pending] = useActionState(reactivateLinkAction, null);

  if (state?.ok) {
    return (
      <p role="status" className="mt-5 rounded-xl border border-brand/50 bg-brand/15 px-4 py-3 text-[15px] text-ink">
        {state.message}
      </p>
    );
  }

  if (!paused) return <p className="mt-5 text-ink-soft">{whyNot}</p>;

  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="code" value={code} />
      <p className="text-ink-soft">
        Confirm turns this link back on for {days} {days === 1 ? "day" : "days"} from now. That uses 1 of its {renewalsLeft} remaining{" "}
        {renewalsLeft === 1 ? "renewal" : "renewals"}.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
          {pending ? "Turning it back on..." : "Confirm: turn this link back on"}
        </button>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-problem">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
