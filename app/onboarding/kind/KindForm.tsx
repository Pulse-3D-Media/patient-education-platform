"use client";

import { useState, useTransition } from "react";
import type { Kind } from "@/lib/roles";
import { setMyKindAction } from "../actions";

/**
 * The Yes / No buttons for the surgeon question. Each one calls the Server
 * Action with the kind it stands for; the action records it and sends the
 * person to the library. Both buttons go quiet while that happens so a
 * double tap cannot answer twice.
 */
export function KindForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(kind: Kind) {
    setError(null);
    startTransition(async () => {
      const result = await setMyKindAction(kind);
      // On success the action redirects, so this only runs on failure.
      if (result?.error) setError(result.error);
    });
  }

  const base = "flex h-14 flex-1 items-center justify-center rounded-xl text-base font-medium transition disabled:opacity-60";

  return (
    <div className="mt-6">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => answer("surgeon")}
          disabled={pending}
          className={`${base} bg-[#2a829b] text-white hover:bg-[#1e5668]`}
        >
          Yes, I am a surgeon
        </button>
        <button
          type="button"
          onClick={() => answer("staff")}
          disabled={pending}
          className={`${base} border border-[#98a2b3] text-black hover:border-[#2a829b] hover:text-[#1e5668]`}
        >
          No
        </button>
      </div>
      {pending && <p className="mt-3 text-sm text-[#667085]">Saving...</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}
