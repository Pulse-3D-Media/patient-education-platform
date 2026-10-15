"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { FAVORITES_EMPTY } from "@/lib/library-rows";
import { useLibrary } from "./LibraryBrowser";
import type { LibraryItem } from "./library-item";
import { VideoCard } from "./VideoCard";

/**
 * A row of cards that scrolls sideways, Netflix-style: a swipe on a phone or
 * a tablet, and on a computer two arrow buttons at the row's ends as well
 * (the `computer:` variant in app/globals.css: a mouse or trackpad that can
 * hover). An arrow is only shown while there is more to see that way.
 * Cards snap to the row's start, so a swipe never stops half-way across one.
 *
 * "hero" cards (My favorites) are bigger than "row" cards. A phone shows one
 * card and a bit of the next, which is the hint that the row scrolls.
 */
export function VideoRow({ items, size, label }: { items: LibraryItem[]; size: "hero" | "row"; label: string }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [canBack, setCanBack] = useState(false);
  const [canOn, setCanOn] = useState(false);

  /** Work out whether there is more to see on either side. */
  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    setCanBack(row.scrollLeft > 4);
    setCanOn(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const row = scroller.current;
    if (!row) return;
    // Measured once the row is on the screen, again whenever its width changes (a turned tablet, a resized window).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    observer?.observe(row);
    const frame = window.requestAnimationFrame(measure);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [measure, items.length]);

  /** Move the row by most of its visible width, so the last card in view becomes the first. */
  function step(direction: 1 | -1) {
    const row = scroller.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: "smooth" });
  }

  const width = size === "hero" ? "w-[82vw] max-w-[26rem] sm:w-[24rem] xl:w-[28rem]" : "w-[15.5rem] sm:w-[17rem] xl:w-[18rem]";

  return (
    <div className="relative">
      <ul
        ref={scroller}
        onScroll={measure}
        aria-label={label}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-3 pt-1 [scrollbar-width:none] sm:scroll-px-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <li key={item.id} className={`shrink-0 snap-start ${width}`}>
            <VideoCard video={item} size={size} />
          </li>
        ))}
      </ul>
      {/* The arrows are for a mouse only; a finger swipes. Hidden from a screen reader, which reads the row as a list. */}
      {canBack && <Arrow direction={-1} onClick={() => step(-1)} />}
      {canOn && <Arrow direction={1} onClick={() => step(1)} />}
    </div>
  );
}

function Arrow({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      aria-hidden="true"
      className={`absolute top-[calc(50%-1.75rem)] z-10 hidden h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-overlay text-ink shadow-panel transition hover:border-brand computer:flex ${
        direction === -1 ? "left-2" : "right-2"
      }`}
    >
      {direction === -1 ? <ChevronLeftIcon className="h-6 w-6" /> : <ChevronRightIcon className="h-6 w-6" />}
    </button>
  );
}

/**
 * "My favorites", which follows the hearts on the page as they are tapped
 * (LibraryBrowser keeps the list). With none, one quiet line.
 */
export function FavoritesRow() {
  const { favorites } = useLibrary();
  if (favorites.length === 0) return <p className="px-5 text-base text-ink-muted sm:px-8">{FAVORITES_EMPTY}</p>;
  return <VideoRow items={favorites} size="hero" label="My favorites" />;
}
