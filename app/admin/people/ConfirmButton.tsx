"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import type { ActionResult } from "./actions";

/**
 * A button that opens an "Are you sure?" popup, and only runs its action when
 * Yes is pressed. The same popup as "Cancel link" on the Shared links page:
 * No, the dark backdrop and Escape all close it and change nothing, and focus
 * lands on No when it opens, so a stray Enter cannot do anything by accident.
 *
 * The action runs on the server. A failure keeps the popup open with the
 * server's sentence and a way to try again; success closes it (the page
 * refreshes itself from the server).
 */
export function ConfirmButton({
  label,
  title,
  body,
  yes,
  danger = false,
  action,
  onDone,
}: {
  label: string;
  title: string;
  body: ReactNode;
  yes: string;
  danger?: boolean;
  action: () => Promise<ActionResult>;
  onDone?: (result: ActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const bodyId = useId();

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
      const result = await action();
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        onDone?.(result);
      }
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
        className={danger ? `${SECONDARY_BUTTON} hover:border-danger-line hover:text-danger` : SECONDARY_BUTTON}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-5" onClick={(e) => e.target === e.currentTarget && !pending && setOpen(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={bodyId}
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-panel sm:p-8"
          >
            <h2 id={headingId} className="text-xl font-semibold">
              {title}
            </h2>
            <div id={bodyId} className="mt-4 text-base leading-relaxed text-ink-soft">
              {body}
            </div>

            {error && (
              <p role="alert" className="mt-4 text-sm text-problem">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                ref={noButton}
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-base font-medium text-ink-soft transition hover:border-brand hover:text-ink disabled:opacity-60"
              >
                No
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className={`inline-flex h-11 items-center rounded-lg px-5 text-base font-medium transition disabled:cursor-wait disabled:opacity-60 ${
                  danger ? "bg-[#a33a3a] text-white hover:bg-[#872e2e]" : "bg-brand text-on-brand hover:bg-brand-hover"
                }`}
              >
                {pending ? "Saving..." : yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
