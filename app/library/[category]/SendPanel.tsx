"use client";

import { useRef } from "react";
import { useModalFocus } from "@/components/ui/useModalFocus";
import { CopyButton } from "@/components/ui/CopyButton";
import { CloseIcon } from "@/components/ui/icons";
import type { SendResult } from "./actions";

/**
 * The panel that opens when a surgeon taps Send on a procedure card.
 *
 * It floats over the library (the grid stays underneath, nothing navigates
 * away) and shows the new patient link with a Copy button and a QR code big
 * enough for a patient to scan straight off the tablet screen.
 *
 * It opens the instant Send is tapped, in a "Creating link..." state, and
 * fills in when the server answers. That keeps the tap feeling immediate
 * even on slow clinic Wi-Fi. If the server says no, the message is shown
 * with a Try again button.
 *
 * On phones it slides up as a sheet from the bottom; on tablets and up it
 * sits in the middle of the screen.
 */
export function SendPanel({
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
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-scrim pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-6"
      // A tap on the dark backdrop (not on the panel itself) closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-panel-title"
        className="w-full max-w-2xl rounded-t-3xl border border-line bg-surface p-6 shadow-panel outline-none sm:rounded-2xl sm:p-8"
      >
        {placeholder && <p role="note" className="mb-4 text-base text-warn-bright">Placeholder animation. This plays a sample, not this procedure.</p>}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">Send to a patient</p>
            <h2 id="send-panel-title" className="mt-1 text-2xl font-semibold leading-tight">
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

        {result === null ? (
          <Creating />
        ) : result.ok ? (
          <Ready
            link={result.link}
            qrImage={result.qrImage}
            unclaimedUntil={result.unclaimedUntil}
            daysAfterFirstPlay={result.daysAfterFirstPlay}
            senderName={result.senderName}
          />
        ) : (
          <Failed error={result.error} onRetry={onRetry} />
        )}

        <div className="mt-8 flex justify-end">
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

/** Shown while the server is making the link: usually well under a second. */
function Creating() {
  return (
    <div className="mt-8 flex flex-col items-center gap-4 py-10" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-line-strong border-t-brand-bright"
      />
      <p className="text-lg text-ink-soft">Creating link...</p>
    </div>
  );
}

/** The link, its Copy button and the QR code, side by side on wide screens. */
function Ready({
  link,
  qrImage,
  unclaimedUntil,
  daysAfterFirstPlay,
  senderName,
}: {
  link: string;
  qrImage: string;
  unclaimedUntil: string;
  daysAfterFirstPlay: number;
  senderName: string | null;
}) {
  // With the year, because a link made in the autumn runs into the next one.
  const until = new Date(unclaimedUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      {/* White box behind the QR code: phone cameras read dark modules on white best. */}
      <div className="shrink-0 rounded-2xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
        <img src={qrImage} alt={`QR code that opens ${link}`} className="h-52 w-52 sm:h-56 sm:w-56" />
      </div>

      <div className="min-w-0 w-full flex-1">
        <p className="text-base leading-relaxed text-ink-soft">
          Let the patient scan the code with their phone camera, or copy the link and send it to them.
        </p>

        {/* break-all lets the address wrap anywhere instead of widening the panel */}
        <p
          className="mt-4 break-all rounded-lg border border-brand/50 bg-brand/10 px-4 py-3 text-base text-ink"
          aria-label="Patient link"
        >
          {link}
        </p>

        <div className="mt-3">
          <CopyButton text={link} label="Copy link" />
        </div>

        {/* The same numbers createShare copied onto this link, so this says what the link will actually do. */}
        <p className="mt-5 text-sm text-ink-muted">
          {senderName ? <>The patient will see it is from {senderName}. </> : null}Once the patient plays it, it works for {daysAfterFirstPlay}{" "}
          {daysAfterFirstPlay === 1 ? "day" : "days"}. If nobody plays it, it stops on {until}.
        </p>
      </div>
    </div>
  );
}

/** The server could not make the link. Plain message, one button. */
function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-8 py-6 text-center" role="alert">
      <p className="text-lg text-problem">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-12 items-center rounded-lg border border-line-strong px-6 text-base font-medium text-ink-soft transition hover:border-brand hover:text-ink"
      >
        Try again
      </button>
    </div>
  );
}
