"use client";

import { PRIMARY_BUTTON } from "@/components/ui/styles";
import type { FormState } from "./actions";

/**
 * The two pieces every form on the dashboard ends with: the line that shows
 * what the server said, and the filled button that says "Saving..." while
 * it works. Shared so the clinic forms and the video forms read the same.
 */

/** The line under a form's button: what the server said, or nothing yet. */
export function Outcome({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[#f3b94d]">
        {state.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-[#5fb8d4]">
      {state.ok}
    </p>
  );
}

/** The one filled button every form ends with. Says "Saving..." while the server works. */
export function SaveButton({ pending, label = "Save" }: { pending: boolean; label?: string }) {
  return (
    <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
      {pending ? "Saving..." : label}
    </button>
  );
}
