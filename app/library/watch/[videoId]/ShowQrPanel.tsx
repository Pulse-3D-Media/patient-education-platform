"use client";

import { useRef } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { useModalFocus } from "@/components/ui/useModalFocus";
import type { SendResult } from "../../[category]/actions";
import { Creating, Failed, linkTermsSentence } from "../../[category]/SendPanel";

/**
 * "Show QR on screen" on the watch page: a new patient link for this video,
 * made exactly the way Send makes one (the same Server Action, so the link
 * is from the surgeon who tapped, and the seat is checked again on the
 * server), shown as one QR code as large as the screen allows, for the
 * patient to scan with their own phone in the room.
 *
 * The code sits on white whatever the clinic's mode, because phone cameras
 * read dark squares on white best. Nothing else competes with it: the
 * procedure's name, one sentence for the patient, and one small line for
 * the surgeon saying what the link will do. Done (or Escape, or a tap on the
 * dark edge) closes it; the link stays made, like every unsent link, and
 * simply runs out if nobody plays it.
 *
 * It opens the instant the button is tapped, in a "Creating link..." state,
 * and fills in when the server answers, like the Send panel.
 */
export function ShowQrPanel({
  title,
  placeholder = false,
  result,
  onRetry,
  onClose,
}: {
  title: string;
  placeholder?: boolean;
  /** null while the link is still being created. */
  result: SendResult | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true);

  return (
    <div
      ref={panel}
      className="fixed inset-0 z-50 flex overflow-y-auto bg-scrim p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6"
      // A tap on the dark edge (not on the panel itself) closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-panel-title"
        className="m-auto flex w-full max-w-3xl flex-col items-center rounded-2xl border border-line bg-surface p-5 text-center shadow-panel outline-none sm:p-7"
      >
        <div className="flex w-full items-start justify-between gap-4 text-left">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">Scan to watch at home</p>
            <h2 id="qr-panel-title" className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-wash hover:text-ink"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        {placeholder && (
          <p role="note" className="mt-3 w-full text-left text-base text-warn-bright">
            Placeholder animation. This plays a sample, not this procedure.
          </p>
        )}

        {result === null ? (
          <Creating />
        ) : result.ok ? (
          <>
            {/* As big as the screen allows, square, on white. */}
            <div className="mt-5 rounded-2xl bg-white p-4 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
              <img src={result.qrImage} alt="QR code that opens the patient's link to this video" className="h-[min(72vw,46vh,30rem)] w-[min(72vw,46vh,30rem)]" />
            </div>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink">Point your phone&apos;s camera at the code, then tap the link that appears.</p>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              {result.senderName ? `From ${result.senderName}. ` : ""}
              {linkTermsSentence(result.daysAfterFirstPlay, result.unclaimedUntil)}
            </p>
          </>
        ) : (
          <Failed error={result.error} onRetry={onRetry} />
        )}

        <div className="mt-5 flex w-full justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 items-center rounded-lg bg-brand px-6 text-base font-medium text-on-brand transition hover:bg-brand-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
