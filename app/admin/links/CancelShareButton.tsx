"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cancelShareAction } from "./actions";

/**
 * The "Cancel link" button beside each share link on the Shared links page, and the
 * "Are you sure?" popup it opens.
 *
 * Nothing happens until Yes is pressed. No, the dark backdrop and Escape all
 * close the popup and leave the link alone. Focus lands on No when the popup
 * opens, so a stray Enter cannot cancel a link by accident.
 *
 * Client component because the popup is open/closed state in the browser.
 * The actual cancelling happens on the server, in cancelShareAction, which
 * also refreshes the list so the row disappears.
 */
export function CancelShareButton({ code, title, expired }: { code: string; title: string; expired: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // pending stays true from pressing Yes until the refreshed list has rendered.
  const [pending, startTransition] = useTransition();
  const noButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const bodyId = useId();

  // While the popup is open: Escape closes it and the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    noButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelShareAction(code);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex h-10 shrink-0 items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-ink-soft transition hover:border-danger-line hover:text-danger"
      >
        {expired ? "Remove" : "Cancel link"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-5"
          // A click on the dark backdrop (not on the popup itself) closes it, unless we are mid-cancel.
          onClick={(e) => e.target === e.currentTarget && !pending && setOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={bodyId}
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-panel sm:p-8"
          >
            <h2 id={headingId} className="text-xl font-semibold">
              {expired ? "Remove this link?" : "Cancel this link?"}
            </h2>
            <p className="mt-1 text-base text-ink-soft">{title}</p>
            <p id={bodyId} className="mt-4 text-base leading-relaxed text-ink-soft">
              {expired
                ? "It has already expired, so this only takes it off the list."
                : "It will stop working right away. Anyone who still has it will be asked to get a new link from your office."}
            </p>

            {error && <p className="mt-4 text-sm text-problem">{error}</p>}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                ref={noButton}
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-base font-medium text-ink-soft transition hover:border-brand hover:text-ink disabled:opacity-60"
              >
                No, keep it
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="inline-flex h-11 items-center rounded-lg bg-[#a33a3a] px-5 text-base font-medium text-white transition hover:bg-[#872e2e] disabled:cursor-wait disabled:opacity-60"
              >
                {pending ? "Cancelling..." : expired ? "Yes, remove it" : "Yes, cancel it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
