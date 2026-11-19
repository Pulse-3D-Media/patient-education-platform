"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { SETUP_PATH } from "@/lib/setup";

/**
 * "Thanks for signing up." (the approved design, screen 03-welcome): the
 * dialog over the library after a new clinic's first payment, with three
 * choices, worded exactly as drawn.
 *
 * WHEN IT SHOWS (decided on the server, app/library/page.tsx): the address
 * says ?welcome=1, the person is the clinic's account owner, and the clinic
 * is open. Only /onboarding/done sends anyone to that address, and only once
 * the server's billing record says the payment was confirmed, so the dialog
 * never claims a clinic is open before it is.
 *
 * ONCE: as soon as it opens it takes ?welcome=1 out of the address (without
 * reloading), so a refresh, the Back button or a second notification from
 * Stripe never brings it back. No database record is needed for that.
 *
 * Escape or a click on a choice closes it. "Go to the library" just closes
 * it, since the library is already underneath.
 */

/** Setup (pull request #5): the step the clinic is on, or the finished page. */
const FINISH_SETTING_UP_HREF = SETUP_PATH;
/** Pull request #6 (tour) replaces this with the tour's first stop. */
const TOUR_HREF = "/library";

export function WelcomeDialog() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Take the one-time marker out of the address, keeping everything else.
    const url = new URL(window.location.href);
    if (url.searchParams.has("welcome")) {
      url.searchParams.delete("welcome");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const close = () => dialog.current?.close();

  const choice = "flex w-full items-center gap-4 rounded-2xl border border-line-strong bg-surface px-4 py-3.5 text-left hover:border-brand";
  const icon = "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-wash text-brand-bright";
  const chevron = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="ml-auto shrink-0 text-ink-soft">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby="welcome-heading"
      className="m-auto w-[calc(100%-2rem)] max-w-[560px] rounded-3xl border border-line bg-surface p-8 text-ink-soft shadow-lift backdrop:bg-black/40"
    >
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-wash text-brand-bright">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 id="welcome-heading" className="mt-5 text-center text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">
        Thanks for signing up.
      </h2>
      <p className="mt-2 text-center text-base">We want you to have a great experience.</p>

      <ul className="mt-6 flex flex-col gap-3">
        <li>
          <Link href={FINISH_SETTING_UP_HREF} onClick={close} className={choice}>
            <span className={icon}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 11l8-7 8 7v9H4z" />
              </svg>
            </span>
            <span>
              <span className="block text-base font-semibold text-ink">
                Finish setting up <span className="font-normal text-ink-soft">(recommended)</span>
              </span>
              <span className="block text-[15px]">Clinic name, branding, your team. About 5 minutes.</span>
            </span>
            {chevron}
          </Link>
        </li>
        <li>
          <Link href={TOUR_HREF} onClick={close} className={choice}>
            <span className={icon}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M8 5l11 7-11 7z" />
              </svg>
            </span>
            <span>
              <span className="block text-base font-semibold text-ink">Take a quick tour</span>
              <span className="block text-[15px]">Three stops, under a minute.</span>
            </span>
            {chevron}
          </Link>
        </li>
        <li>
          <button type="button" onClick={close} className={choice}>
            <span className={icon}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M5 4h3v16H5zM10 4h3v16h-3zM15 4.5l3-.8 3.2 15.6-3 .8z" />
              </svg>
            </span>
            <span>
              <span className="block text-base font-semibold text-ink">Go to the library</span>
              <span className="block text-[15px]">Look around first.</span>
            </span>
            {chevron}
          </button>
        </li>
      </ul>
    </dialog>
  );
}
