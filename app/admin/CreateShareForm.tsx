"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { watchLink } from "@/lib/share-link";
import { createShareAction } from "./actions";

/**
 * The "Create share link" button next to one video, and the link that
 * appears once one has been created.
 *
 * There is nothing to choose: every link works for SHARE_EXPIRY_DAYS days,
 * and a line of helper text beside the button says so.
 *
 * Client component because it needs to remember the link it just made.
 * The actual creating happens on the server, in createShareAction.
 */
export function CreateShareForm({ videoId, baseUrl }: { videoId: string; baseUrl: string }) {
  // useActionState runs the Server Action when the form is submitted and
  // hands back whatever it returned (the new code, or an error message).
  const [state, formAction, pending] = useActionState(createShareAction, null);

  const link = state?.code ? watchLink(baseUrl, state.code) : null;

  return (
    <div className="flex flex-col items-start gap-3 lg:items-end">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="videoId" value={videoId} />

        <p className="text-sm text-[#bfbfbf]">Links work for {SHARE_EXPIRY_DAYS} days</p>

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
