"use client";

import { useState, useTransition } from "react";
import type { Kind } from "@/lib/roles";
import type { SeatState } from "@/lib/seats";
import { setKindAction } from "./actions";

/**
 * The Surgeon / Staff switch on one row of the People page: two buttons,
 * the chosen one filled. Pressing the other one calls the Server Action
 * and shows the new choice as soon as the server confirms it. While the
 * server is thinking both buttons go quiet.
 *
 * Under the buttons, where the person stands with the clinic's surgeon
 * seats (lib/seats.ts), when that needs saying:
 *
 *   Waiting for a seat   they are marked as a surgeon and no seat was free.
 *   Not saved yet        a seat was reserved for them and the change did not
 *                        finish. "Try again" sends it again, which is safe:
 *                        they are never counted twice. Left alone, the
 *                        reservation undoes itself in a few minutes.
 *   Not set              nobody has answered for this person yet.
 *
 * The server decides whether a seat is free. When none is, the button press
 * comes back with a sentence saying so and nothing is changed.
 *
 * The page gives this a new `key` whenever the server's answer for the
 * person changes, so it always starts from what the server last said.
 */
export function KindControl({ userId, name, kind, seat }: { userId: string; name: string; kind: Kind | null; seat: SeatState }) {
  const [current, setCurrent] = useState<Kind | null>(kind);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(next: Kind) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await setKindAction(userId, next);
      if (result.error) setError(result.error);
      else setCurrent(next);
    });
  }

  function choose(next: Kind) {
    if (next !== current) send(next);
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div role="group" aria-label={`Is ${name} a surgeon or staff?`} className="flex overflow-hidden rounded-lg border border-line-strong">
        <Option label="Surgeon" active={current === "surgeon"} pending={pending} onClick={() => choose("surgeon")} />
        <Option label="Staff" active={current === "staff"} pending={pending} onClick={() => choose("staff")} />
      </div>

      {!error && !pending && seat === "waiting" && current === "surgeon" && <p className="text-sm text-warn">Waiting for a seat</p>}
      {!error && !pending && seat === "pending" && (
        <p className="flex items-center gap-2 text-sm text-warn">
          Not saved yet
          <button type="button" onClick={() => send("surgeon")} className="h-9 rounded-md border border-line-strong px-3 text-sm font-medium text-ink hover:bg-wash">
            Try again
          </button>
        </p>
      )}
      {!error && !pending && seat === "none" && current === null && <p className="text-xs text-ink-muted">Not set</p>}
      {pending && <p className="text-xs text-ink-muted">Saving...</p>}
      {error && (
        <p role="alert" className="max-w-xs text-sm text-warn sm:text-right">
          {error}
        </p>
      )}
    </div>
  );
}

function Option({ label, active, pending, onClick }: { label: string; active: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={pending}
      onClick={onClick}
      className={`h-10 px-4 text-sm font-medium transition disabled:opacity-60 ${
        active ? "bg-brand text-on-brand" : "text-ink-soft hover:bg-wash hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
