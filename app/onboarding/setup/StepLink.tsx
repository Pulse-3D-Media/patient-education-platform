"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * Moving between setup steps without losing what was typed by accident
 * (Evan, 2026-11-20: the steps in the list on the left are links).
 *
 * A step's boxes are only saved by its own Continue (or Finish). So once
 * something has been typed into a box on this step, a step link (the list on
 * the left, or Back) first asks, in the browser's own plain question: "What
 * you typed on this step is not saved. Leave it anyway?" Cancel stays, with
 * everything still in the boxes. Nothing typed: the link just goes.
 *
 * Choosing from a list (the test link's procedure) does not count: nothing
 * is lost by leaving it. A file chosen for the logo, or a colour, does count.
 *
 * Navigation only. Which steps may be opened is decided on the server
 * (stepIsOpen() in lib/setup.ts, asked again by every step's page).
 */

/** Whether something was typed on the step on screen and not saved yet. One step is on screen at a time. */
let typedOnThisStep = false;

/** The browser's question before a step link leaves typed words behind. */
export const LEAVE_UNSAVED = "What you typed on this step is not saved. Leave it anyway?";

/** Boxes that hold something typed or chosen from the computer; a list (select) does not. */
function holdsTyping(target: EventTarget | null): boolean {
  if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) return true;
  if (typeof HTMLInputElement === "undefined" || !(target instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "hidden"].includes(target.type);
}

function noticeTyping(target: EventTarget | null) {
  if (holdsTyping(target)) typedOnThisStep = true;
}

/** Wraps a step's page and notices typing in it. A new step (a new address) starts with nothing typed. */
export function StepTypingWatch({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    typedOnThisStep = false;
  }, [pathname]);
  return (
    <div className="contents" onInput={(event) => noticeTyping(event.target)} onChange={(event) => noticeTyping(event.target)}>
      {children}
    </div>
  );
}

/** A link to another setup step that asks first when something typed here would be left behind. */
export function StepLink({ href, className, ariaLabel, children }: { href: string; className?: string; ariaLabel?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (typedOnThisStep && !window.confirm(LEAVE_UNSAVED)) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
