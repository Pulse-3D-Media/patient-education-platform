"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { requestReactivation } from "../patient-calls";
import { CallButton } from "./CallButton";

/**
 * What a patient sees on a link that has paused: one sentence and one
 * button, "Ask my clinic". No text box, no name, no email, no phone field,
 * on purpose: a patient would type personal details into any box that was
 * there, and nothing about a patient ever enters this system (rule 2). The
 * tap sends the link's code and nothing else.
 *
 * After the tap the same spot says the clinic has been asked and to try
 * the same link again in a day or so. The server records at most one
 * request per link per day; a second tap inside that day, or the page
 * opened again the same day (`alreadyAsked`), shows this same confirmation
 * and sends nothing. The words stay free of anything technical.
 *
 * If the tap does not go through (the connection dropped, say), a calm line
 * asks them to try again, and the page is refreshed so that a link the
 * clinic has just turned back on shows the video instead.
 *
 * FOR A SCREEN READER. The button disappears after the tap, with the focus
 * on it; the focus moves to the new heading ("Your clinic has been asked"),
 * so the reader says where things stand and nothing is lost. The status
 * region below stays empty then, or the reader would hear the same news
 * twice. One status region is always here and only its words change (a
 * region that appears already filled is skipped by many screen readers): it
 * says only that the tap did not go through, when the button (and the focus)
 * stays where it is. A page opened already asked says nothing of its own:
 * the heading is read like any page.
 */
export function AskClinic({ code, alreadyAsked, call }: { code: string; alreadyAsked: boolean; call: { href: string; label: string } | null }) {
  const router = useRouter();
  const [asked, setAsked] = useState(alreadyAsked);
  const [trouble, setTrouble] = useState(false);
  const [pending, startTransition] = useTransition();
  /** The tap on this page load went through: the focus goes to the new heading (not on a page opened already asked). */
  const [justAsked, setJustAsked] = useState(false);
  const askedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (justAsked) askedHeading.current?.focus({ preventScroll: true });
  }, [justAsked]);

  function ask() {
    setTrouble(false);
    startTransition(async () => {
      const result = await requestReactivation(code);
      if (result.asked) {
        setAsked(true);
        setJustAsked(true);
      } else {
        setTrouble(true);
        router.refresh();
      }
    });
  }

  // Always on the page, in both states below; only its words change.
  const status = (
    <p role="status" className="sr-only">
      {trouble ? "That did not go through. Please try again in a moment." : ""}
    </p>
  );

  if (asked) {
    return (
      <>
        {status}
        <h1 ref={askedHeading} tabIndex={-1} className="mt-6 text-[24px] leading-[1.22] font-bold tracking-[-.02em] outline-none">
          Your clinic has been asked
        </h1>
        <p className="mt-3.5 max-w-[30ch] text-[18px] leading-[1.52] break-words text-[#3a4c56]">Try this same link again in a day or so.</p>
        {call && (
          <>
            <p className="mt-3 max-w-[30ch] text-[16px] leading-[1.5] text-[#46555e]">Need it sooner? Call the office.</p>
            <CallButton call={call} />
          </>
        )}
      </>
    );
  }

  return (
    <>
      {status}
      <h1 className="mt-6 text-[24px] leading-[1.22] font-bold tracking-[-.02em]">This link has paused</h1>
      <p className="mt-3.5 max-w-[30ch] text-[18px] leading-[1.52] break-words text-[#3a4c56]">Tap below to ask your clinic to turn it back on.</p>
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="mt-7 flex min-h-14 items-center rounded-full bg-brand px-8 text-[17px] font-semibold text-on-brand shadow-[0_6px_18px_-8px_rgba(18,32,42,.45)] transition active:scale-[0.98] disabled:opacity-70 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#12202a]"
      >
        {pending ? "Asking..." : "Ask my clinic"}
      </button>
      {/* Seen here; heard through the status region above. */}
      {trouble && (
        <p className="mt-4 max-w-[30ch] text-[16px] leading-[1.5] text-[#46555e]">
          That did not go through. Please try again in a moment.
        </p>
      )}
    </>
  );
}
