"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CopyIcon, MailIcon, MessageIcon, ShareIcon } from "./icons";
import {
  copyMessage,
  mailtoHref,
  messageNotice,
  sendWaysFor,
  shareMessage,
  smsHref,
  type SendWays,
} from "@/lib/patient-message";

/**
 * The buttons beside a new patient link that send the ready-made message
 * (decided by Evan on 2026-11-20): Copy message always, then whichever of
 * Share, Text message and Email this device can really do. The words and
 * the rules are in lib/patient-message.ts.
 *
 * Everything happens on the device. The clipboard, the share sheet and the
 * device's own texting or email app are asked directly; nothing is sent to
 * our server, nothing is counted, and there is no box for a patient's name,
 * number or email (rule 2). A text or an email opens with NO recipient: the
 * person sending picks the patient in their own app.
 *
 * WHEN SOMETHING GOES WRONG: a refused clipboard or a share sheet that will
 * not open says so in one sentence and shows the message in a box, selected,
 * to copy by hand. A share sheet the person closes does nothing at all.
 *
 * `buttonClass` and `doneClass` let each page keep its own button look; both
 * must be at least 44px tall.
 */
export function PatientMessageButtons({ message, buttonClass, doneClass }: { message: string; buttonClass: string; doneClass: string }) {
  // What this device can do. Asked of the browser, never guessed from the screen width; "none" while drawn on the server.
  const ways = useSyncExternalStore(subscribeNever, readSendWays, () => "none" as SendWays);
  const [copied, setCopied] = useState(false);
  // The words after a press, and a count of presses: the count is the key of the span the words sit in, so a second
  // "Message copied." is announced again by a screen reader.
  const [notice, setNotice] = useState({ text: "", press: 0 });
  const [showByHand, setShowByHand] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // When the message box appears, put the keyboard on it with the whole message selected, ready to copy by hand.
  useEffect(() => {
    if (!showByHand) return;
    box.current?.focus();
    box.current?.select();
  }, [showByHand]);

  function say(text: string) {
    setNotice((last) => ({ text, press: last.press + 1 }));
  }

  async function copy() {
    const outcome = await copyMessage(navigator, message);
    say(messageNotice("copy", outcome));
    if (outcome === "copied") {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } else {
      setShowByHand(true);
    }
  }

  async function share() {
    const outcome = await shareMessage(navigator, message);
    say(messageNotice("share", outcome));
    if (outcome === "refused") setShowByHand(true);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void copy()} className={copied ? doneClass : buttonClass}>
          <CopyIcon className="h-5 w-5 shrink-0" />
          {copied ? "Copied" : "Copy message"}
        </button>
        {ways === "share" && (
          <button type="button" onClick={() => void share()} className={buttonClass}>
            <ShareIcon className="h-5 w-5 shrink-0" />
            Share message
          </button>
        )}
        {ways === "text-and-email" && (
          // A plain link to the device's own texting app, the message filled in and no number.
          <a href={smsHref(message)} className={buttonClass}>
            <MessageIcon className="h-5 w-5 shrink-0" />
            Text message
          </a>
        )}
        {(ways === "text-and-email" || ways === "email") && (
          <a href={mailtoHref(message)} className={buttonClass}>
            <MailIcon className="h-5 w-5 shrink-0" />
            Email
          </a>
        )}
      </div>
      {/* Always here, so a screen reader hears the words when they arrive. */}
      <p role="status" className="mt-2 text-sm text-ink-soft empty:mt-0">
        {notice.text && <span key={notice.press}>{notice.text}</span>}
      </p>
      {showByHand && (
        <textarea
          ref={box}
          readOnly
          value={message}
          rows={4}
          aria-label="The message to send, to copy by hand"
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 w-full resize-none rounded-lg border border-line-strong bg-field px-3 py-2 text-[15px] text-ink focus:border-brand focus:outline-none"
        />
      )}
    </div>
  );
}

/** What the device can do never changes while the panel is open, so there is nothing to listen to. */
function subscribeNever() {
  return () => undefined;
}

/** Ask the browser what it can do. The share sheet's own check is called on navigator, where it belongs. */
function readSendWays(): SendWays {
  const nav = navigator as Navigator & { canShare?: (data: { text?: string }) => boolean };
  return sendWaysFor({
    share: nav.share,
    canShare: typeof nav.canShare === "function" ? (data) => nav.canShare!(data) : undefined,
    touchFirst: typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches,
  });
}
