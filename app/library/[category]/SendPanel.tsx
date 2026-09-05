"use client";

import { useEffect, useRef } from "react";
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
  result,
  onRetry,
  onClose,
}: {
  title: string;
  /** null while the link is still being created. */
  result: SendResult | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Move keyboard focus into the panel when it opens, so Escape and Tab
  // work from here and a screen reader reads the heading.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
      // A tap on the dark backdrop (not on the panel itself) closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-panel-title"
        className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#0d1113] p-6 shadow-[0_24px_80px_rgba(0,0,0,.7)] outline-none sm:rounded-2xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">Send to a patient</p>
            <h2 id="send-panel-title" className="mt-1 text-2xl font-semibold leading-tight">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#bfbfbf] transition hover:bg-white/5 hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {result === null ? (
          <Creating />
        ) : result.ok ? (
          <Ready link={result.link} qrImage={result.qrImage} expiresAt={result.expiresAt} days={result.days} />
        ) : (
          <Failed error={result.error} onRetry={onRetry} />
        )}

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 items-center rounded-lg bg-[#2a829b] px-6 text-base font-medium text-white transition hover:bg-[#1e5668]"
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
        className="h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-[#5fb8d4]"
      />
      <p className="text-lg text-[#bfbfbf]">Creating link...</p>
    </div>
  );
}

/** The link, its Copy button and the QR code, side by side on wide screens. */
function Ready({ link, qrImage, expiresAt, days }: { link: string; qrImage: string; expiresAt: string; days: number }) {
  // With the year, because a link made in the autumn runs into the next one.
  const until = new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      {/* White box behind the QR code: phone cameras read dark modules on white best. */}
      <div className="shrink-0 rounded-2xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a drawn QR code, not a photo to resize */}
        <img src={qrImage} alt={`QR code that opens ${link}`} className="h-52 w-52 sm:h-56 sm:w-56" />
      </div>

      <div className="min-w-0 w-full flex-1">
        <p className="text-base leading-relaxed text-[#bfbfbf]">
          Let the patient scan the code with their phone camera, or copy the link and send it to them.
        </p>

        {/* break-all lets the address wrap anywhere instead of widening the panel */}
        <p
          className="mt-4 break-all rounded-lg border border-[#2a829b]/50 bg-[#2a829b]/10 px-4 py-3 text-base text-white"
          aria-label="Patient link"
        >
          {link}
        </p>

        <div className="mt-3">
          <CopyButton text={link} label="Copy link" />
        </div>

        <p className="mt-5 text-sm text-[#667085]">
          Works for {days} days, until {until}. The office can print a pamphlet for it from Share links.
        </p>
      </div>
    </div>
  );
}

/** The server could not make the link. Plain message, one button. */
function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-8 py-6 text-center" role="alert">
      <p className="text-lg text-[#f0b06a]">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-12 items-center rounded-lg border border-white/15 px-6 text-base font-medium text-[#bfbfbf] transition hover:border-[#2a829b] hover:text-white"
      >
        Try again
      </button>
    </div>
  );
}
