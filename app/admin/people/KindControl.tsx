"use client";

import { useState, useTransition } from "react";
import type { Kind } from "@/lib/roles";
import { setKindAction } from "./actions";

/**
 * The Surgeon / Staff switch on one row of the People page: two buttons,
 * the chosen one filled. Pressing the other one calls the Server Action
 * and shows the new choice as soon as the server confirms it. While the
 * server is thinking both buttons go quiet.
 *
 * If nobody has answered for this person yet, neither button is filled and
 * the row says "Not set".
 */
export function KindControl({ userId, name, kind }: { userId: string; name: string; kind: Kind | null }) {
  const [current, setCurrent] = useState<Kind | null>(kind);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: Kind) {
    if (next === current || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await setKindAction(userId, next);
      if (result.error) setError(result.error);
      else setCurrent(next);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div role="group" aria-label={`Is ${name} a surgeon or staff?`} className="flex overflow-hidden rounded-lg border border-white/15">
        <Option label="Surgeon" active={current === "surgeon"} pending={pending} onClick={() => choose("surgeon")} />
        <Option label="Staff" active={current === "staff"} pending={pending} onClick={() => choose("staff")} />
      </div>
      {current === null && !error && <p className="text-xs text-[#667085]">Not set</p>}
      {error && (
        <p role="alert" className="text-xs text-[#f3b94d]">
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
        active ? "bg-[#2a829b] text-white" : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
