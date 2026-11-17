"use client";

import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ShareIcon } from "@/components/ui/icons";
import { shareMessage, shareOrCopy, showShareButton } from "./share-link";

/**
 * One quiet button under the video's length and deadline: "Save or share
 * this link" (decided on 2026-11-16, the one exception to "nothing
 * to click but the box and Play"). What it does, and what it never does, is
 * at the top of share-link.ts: the phone's own share sheet, or a copy of the
 * address, and nothing ever sent to our server.
 *
 * Quiet on purpose: a white pill with a grey edge (#737b83, 4.3:1 on white, the staff screens' edge), not the clinic's colour,
 * so it never competes with Play. 48px tall. It sits below the player, so
 * whether it shows never moves the video.
 *
 * On a printed code's page it waits for the visit's own link: Next.js keeps
 * usePathname in step with the address bar, which the player changes to
 * /watch/<code> once the Play tap has made the link (WatchPlayer).
 */
export function ShareLinkButton({ title, when }: { title: string; when: "now" | "once-own-link" }) {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const pressing = useRef(false);
  if (!showShareButton(when, pathname)) return null;

  async function press() {
    if (pressing.current) return;
    pressing.current = true;
    // Clear the last words first, so a second "Link copied." is heard again rather than taken for no change.
    setMessage("");
    try {
      const outcome = await shareOrCopy(navigator, { url: window.location.href, title });
      setMessage(shareMessage(outcome));
    } finally {
      pressing.current = false;
    }
  }

  return (
    <div className="mt-5" data-needs-script="">
      <button
        type="button"
        onClick={() => void press()}
        data-share-link=""
        className="flex min-h-12 items-center gap-2.5 rounded-full border-2 border-[#737b83] bg-white px-5 text-[17px] font-semibold text-[#12333f] transition active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1e5668]"
      >
        <ShareIcon className="h-5 w-5 shrink-0" />
        Save or share this link
      </button>
      {/* Always here, so a screen reader hears the words when they arrive. */}
      <p role="status" className="mt-2 min-h-6 text-[16px] leading-6 text-[#46555e]">
        {message}
      </p>
    </div>
  );
}
