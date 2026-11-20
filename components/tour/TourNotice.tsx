"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { TOUR_COPY, TOUR_PARAM, TOUR_START_HREF, markTourSeen, readTourSeen, subscribeTourSeen } from "@/lib/tour";

/**
 * "Take the tour": a small, quiet notice at the foot of the library's menu,
 * just above the account picture (Evan, 2026-11-20: "when I open the library
 * and I haven't taken the tour yet I want a small notification on the bottom
 * left above the profile picture to say take the tour. Once they take it or
 * if they choose to take it then stop the notification.").
 *
 * WHEN IT SHOWS: this browser has never started the tour (the same "seen"
 * value the tour already keeps, lib/tour.ts), and the tour is not on screen
 * right now. Pressing it starts the tour and it goes; starting the tour any
 * other way (the welcome dialog, the account menu) makes it go too. When the
 * browser's storage cannot be read it is not shown at all. The server draws
 * nothing here (it cannot know), so it appears just after the page wakes,
 * in the menu, never over the page.
 *
 * THE SPEED RULE: this file is tiny and imports none of the tour's own code;
 * the tour is loaded only when the address asks for it (TourHost). It is a
 * plain link in the menu, so it never covers Play or anything on a video's
 * page.
 *
 * It replaced the one-time "Take a quick tour?" card shown to someone who
 * had just joined a clinic: the two would have shown together.
 *
 * Three looks: "rail" in the narrow rail (an icon with "Tour" under it),
 * "wide" in the full menu and in the menu that slides out on a tablet or
 * phone.
 */
export function TourNotice({ variant, onChoose }: { variant: "rail" | "wide"; onChoose?: () => void }) {
  // Reading the address needs a Suspense boundary of its own, so a page drawn ahead of time is never held up by it.
  return (
    <Suspense fallback={null}>
      <Notice variant={variant} onChoose={onChoose} />
    </Suspense>
  );
}

/** The server cannot read this browser's storage, so on the server (and in the first paint) it counts as seen: nothing is drawn. */
const seenOnServer = () => true;

function Notice({ variant, onChoose }: { variant: "rail" | "wide"; onChoose?: () => void }) {
  const seen = useSyncExternalStore(subscribeTourSeen, () => readTourSeen(), seenOnServer);
  const tourShowing = useSearchParams().get(TOUR_PARAM) !== null;
  if (seen !== false || tourShowing) return null;

  const start = () => {
    markTourSeen();
    onChoose?.();
  };

  if (variant === "rail") {
    return (
      <Link
        href={TOUR_START_HREF}
        onClick={start}
        title={TOUR_COPY.notice.title}
        aria-label={TOUR_COPY.notice.title}
        // The same size and look as the rail's other items (RAIL_ITEM in components/ui/AppShell.tsx), with a small dot.
        className="relative flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium leading-none text-ink-soft transition hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-bright"
      >
        <PlayCircle />
        {TOUR_COPY.notice.short}
        <span aria-hidden="true" className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-brand" />
      </Link>
    );
  }

  return (
    <div className="shrink-0 px-3 pb-2">
      <Link
        href={TOUR_START_HREF}
        onClick={start}
        className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-[15px] font-medium text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-brand-bright"
      >
        <span className="text-brand-bright">
          <PlayCircle />
        </span>
        {TOUR_COPY.notice.title}
        <span aria-hidden="true" className="ml-auto h-2 w-2 rounded-full bg-brand" />
      </Link>
    </div>
  );
}

function PlayCircle() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5.5 3.5-5.5 3.5z" />
    </svg>
  );
}
