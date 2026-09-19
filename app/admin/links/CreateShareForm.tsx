"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { watchLink } from "@/lib/share-link";
import { createShareAction } from "./actions";

/**
 * The "Create share link" button next to one video, and the link that
 * appears once one has been created.
 *
 * There is nothing to choose. A line of helper text beside the button says
 * how long a link works after the patient first plays it; the number comes
 * from the page, which read it from the same settings createShare copies
 * onto the link, so the words and the link cannot disagree.
 *
 * Client component because it needs to remember the link it just made.
 * The actual creating happens on the server, in createShareAction.
 */
export function CreateShareForm({
  videoId,
  baseUrl,
  daysAfterFirstPlay,
}: {
  videoId: string;
  baseUrl: string;
  /** Days a new link works after the patient first plays it, as resolved for this clinic. Null when a setting is out of range: the button is off and the text says so. */
  daysAfterFirstPlay: number | null;
}) {
  // useActionState runs the Server Action when the form is submitted and
  // hands back whatever it returned (the new code, or an error message).
  const [state, formAction, pending] = useActionState(createShareAction, null);

  const link = state?.code ? watchLink(baseUrl, state.code) : null;

  return (
    <div className="flex flex-col items-start gap-3 lg:items-end">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="videoId" value={videoId} />

        <p className="text-sm text-ink-soft">
          {daysAfterFirstPlay === null
            ? "Links cannot be made right now. Ask Pulse 3D."
            : `Works for ${daysAfterFirstPlay} ${daysAfterFirstPlay === 1 ? "day" : "days"} after the first play`}
        </p>

        {/* The disabled button is a courtesy; createShare refuses for the same reason (rule 8). */}
        <button
          type="submit"
          disabled={pending || daysAfterFirstPlay === null}
          className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-on-brand transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create share link"}
        </button>
      </form>

      {state?.error && <p className="text-sm text-problem">{state.error}</p>}

      {link && (
        <div className="flex w-full max-w-xl items-center gap-3 rounded-lg border border-brand/50 bg-brand/10 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={link}>
            {link}
          </span>
          <CopyButton text={link} />
        </div>
      )}
    </div>
  );
}
