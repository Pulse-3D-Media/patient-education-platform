"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { watchLink } from "@/lib/share-link";
import { createShareAction } from "./actions";
import { DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS } from "./expiry";

/**
 * The "expires after [dropdown] [Create share link]" controls next to one
 * video, and the link that appears once one has been created.
 *
 * Client component because it needs to remember the link it just made.
 * The actual creating happens on the server, in createShareAction.
 */
export function CreateShareForm({ videoId, baseUrl }: { videoId: string; baseUrl: string }) {
  // useActionState runs the Server Action when the form is submitted and
  // hands back whatever it returned (the new code, or an error message).
  const [state, formAction, pending] = useActionState(createShareAction, null);

  const link = state?.code ? watchLink(baseUrl, state.code) : null;
  const selectId = `days-${videoId}`;

  return (
    <div className="flex flex-col items-start gap-3 lg:items-end">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="videoId" value={videoId} />

        <label htmlFor={selectId} className="text-sm text-[#bfbfbf]">
          Expires after
        </label>
        <select
          id={selectId}
          name="days"
          defaultValue={DEFAULT_EXPIRY_DAYS}
          className="h-10 rounded-lg border border-white/15 bg-[#0d1113] px-3 text-sm text-white focus:border-[#2a829b] focus:outline-none"
        >
          {EXPIRY_DAYS.map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-lg bg-[#2a829b] px-4 text-sm font-medium text-white transition hover:bg-[#1e5668] disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create share link"}
        </button>
      </form>

      {state?.error && <p className="text-sm text-[#f0b06a]">{state.error}</p>}

      {link && (
        <div className="flex w-full max-w-xl items-center gap-3 rounded-lg border border-[#2a829b]/50 bg-[#2a829b]/10 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-white" title={link}>
            {link}
          </span>
          <CopyButton text={link} />
        </div>
      )}
    </div>
  );
}
