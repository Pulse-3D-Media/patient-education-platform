"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TOUR_COPY,
  joinNames,
  markTourSeen,
  tourStopHref,
  tourStops,
  withoutTourParams,
  type TourRequest,
  type TourStop,
} from "@/lib/tour";
import { readWatchVideoId } from "@/lib/library-rows";

/**
 * The quick tour itself (the approved design, screens 07-tour-1 to 3). This
 * file is only downloaded when the address asks for the tour (TourHost loads
 * it lazily), so a normal library visit carries none of it.
 *
 * HOW A STOP LOOKS: the page goes a little darker except for the controls
 * the stop is about, which get a ring in the clinic's accent, and a small
 * caption sits beside them (or under them on a narrow screen) with "1 of 3",
 * a title, at most one line more, and End tour, Back, Next or Done. Plain
 * markup, styles and the colour tokens; no package.
 *
 * WHAT IT NEVER DOES (the speed rule outranks the tour):
 *   - The darkening lets every tap through, so nothing under it is ever
 *     blocked, Play included. Pressing Play on the video ends the tour.
 *   - It never starts, pauses or touches a video. The watch page opens paused
 *     as it always does.
 *   - It can be left at any stop with one tap (End tour, or Done on the last)
 *     or with the Escape key.
 *   - Nothing moves with animation: the page jumps (it never glides) when a
 *     stop needs it scrolled into view, so reduced motion is honoured.
 *
 * WHAT IT POINTS AT is found by data-tour attributes on the real controls
 * (the shell's categories and search, the watch page's row of buttons, the
 * admin pages' list), whichever of them is visible at this width. It shows
 * only what the page drew for this person, so someone without a seat, whose
 * page has no Send or Show QR, has only Favorite pointed at, with words that
 * say nothing about seats or plans. None of it decides who may do what.
 *
 * FOCUS: each stop's caption takes the keyboard, a screen reader hears its
 * title, its line and which controls are highlighted, and when the tour ends
 * the keyboard goes back to where it was before the tour started.
 */

/** Where the keyboard was before the tour started, to give it back at the end. Kept across stops, which are separate pages. */
let returnFocusTo: HTMLElement | null = null;

/** Remembers where the keyboard is, once per tour. */
function rememberFocus() {
  if (returnFocusTo) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) returnFocusTo = active;
}

/** Ends the tour: remembered as seen, the address tidied (which takes the tour off the page), and the keyboard given back. */
function leaveTour() {
  markTourSeen();
  const target = returnFocusTo;
  returnFocusTo = null;
  // null, not the current history state: Next.js only updates the page (and so takes the tour off it) for a change it did not make itself.
  window.history.replaceState(null, "", withoutTourParams(window.location.href));
  if (target && target.isConnected) target.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function Tour({ request, isAdmin }: { request: Exclude<TourRequest, null>; isAdmin: boolean }) {
  const pathname = usePathname();
  // A key per stop and page, so moving on starts the next stop afresh.
  return <TourStopView key={`${request.stop}:${pathname}`} stop={request.stop} videoId={request.videoId} isAdmin={isAdmin} />;
}

// ---------------------------------------------------------------------------
// One stop.
// ---------------------------------------------------------------------------

/** Which controls each stop points at, by their data-tour names. The first one found visible at this width is used for each slot. */
const TARGETS: Record<TourStop, string[][]> = {
  // The categories (the full menu, or the rail's Library button, or on a phone the menu button that holds them), and the search.
  nav: [["categories", "menu"], ["search"]],
  video: [["video-actions"]],
  admin: [["admin-sections"]],
};

/** An element is usable when the page actually shows it at this width (a hidden copy has no size). */
function isShown(element: Element): element is HTMLElement {
  const box = element.getBoundingClientRect();
  return element instanceof HTMLElement && box.width > 0 && box.height > 0;
}

function findTarget(names: string[]): HTMLElement | null {
  for (const name of names) {
    const found = [...document.querySelectorAll(`[data-tour="${name}"]`)].find(isShown);
    if (found) return found;
  }
  return null;
}

/** The names a screen reader hears for what is highlighted: each target's own data-tour-name, then those inside it. */
function highlightedNames(targets: HTMLElement[]): string[] {
  const names: string[] = [];
  for (const target of targets) {
    if (target.dataset.tourName) names.push(target.dataset.tourName);
    target.querySelectorAll<HTMLElement>("[data-tour-name]").forEach((inner) => {
      if (inner.dataset.tourName) names.push(inner.dataset.tourName);
    });
  }
  return names;
}

/**
 * Whether the page this stop is on has been drawn yet. The library shows a
 * loading screen while its page is read, and the tour may arrive first, so
 * each stop waits for its page: the library home's marker, or the watch
 * page's row of buttons. The admin list is part of the admin frame, there
 * from the start.
 */
function pageIsDrawn(stop: TourStop): boolean {
  if (stop === "nav") return document.querySelector("[data-tour-home]") !== null;
  if (stop === "video") return document.querySelector('[data-tour="video-actions"]') !== null;
  return true;
}

/** How long a stop waits for its page before quietly giving up (a page that never came, or one with nothing to show). */
const WAIT_FOR_PAGE_MS = 15000;

type Plan = {
  stops: TourStop[];
  index: number;
  videoId: string | null;
  targets: HTMLElement[];
  title: string;
  body: string | null;
  names: string[];
};

/**
 * Works out this stop from the page as drawn: the video the tour will open
 * (the library home names one it may use; later stops carry it in the
 * address), the stops this person has, and what to highlight. Null when the
 * stop does not belong to this person's tour (it then simply ends).
 */
function planStop(stop: TourStop, addressVideoId: string | null, isAdmin: boolean): Plan | null {
  const homeVideo = document.querySelector<HTMLElement>("[data-tour-video]")?.dataset.tourVideo;
  const videoId = stop === "nav" ? readWatchVideoId(homeVideo) : addressVideoId;
  const stops = tourStops({ hasVideo: videoId !== null, isAdmin });
  const index = stops.indexOf(stop);
  if (index < 0) return null;

  const targets = TARGETS[stop].map(findTarget).filter((target): target is HTMLElement => target !== null);
  const copy =
    stop === "nav" ? TOUR_COPY.nav : stop === "admin" ? TOUR_COPY.admin : targets[0]?.querySelector("[data-tour-send]") ? TOUR_COPY.videoSend : TOUR_COPY.videoSave;
  return { stops, index, videoId, targets, title: copy.title, body: copy.body, names: highlightedNames(targets) };
}

/** A rounded rectangle as an SVG path, for the holes in the shade and the rings. */
function roundedRect(x: number, y: number, w: number, h: number): string {
  const r = Math.min(12, w / 2, h / 2);
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

const PAD = 6;
const GAP = 14;
const MARGIN = 12;
/** From this width the caption may sit beside what it points at, as on a computer; narrower, it goes underneath. */
const SIDE_BY_SIDE_WIDTH = 860;

function TourStopView({ stop, videoId: addressVideoId, isAdmin }: { stop: TourStop; videoId: string | null; isAdmin: boolean }) {
  const router = useRouter();
  const caption = useRef<HTMLDivElement>(null);
  const shadePath = useRef<SVGPathElement>(null);
  const ringPath = useRef<SVGPathElement>(null);
  const shade = useRef<SVGSVGElement>(null);
  /** The stop as worked out from the page: undefined while the page is still being drawn, null when it is not this person's stop. */
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);

  // The tour has started: remembered at once, so the "Take the tour" notice in the menu goes (Evan, 2026-11-20).
  useEffect(() => {
    markTourSeen();
  }, []);

  // Wait for the page under this stop to be drawn, then work the stop out from it.
  useEffect(() => {
    let settled = false;
    const finish = (value: Plan | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      setPlan(value);
    };
    const tryNow = () => {
      if (pageIsDrawn(stop)) finish(planStop(stop, addressVideoId, isAdmin));
    };
    const observer = new MutationObserver(tryNow);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), WAIT_FOR_PAGE_MS);
    const frame = requestAnimationFrame(tryNow);
    return () => {
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [stop, addressVideoId, isAdmin]);

  useLayoutEffect(() => {
    if (plan === undefined) return;
    if (plan === null) {
      leaveTour();
      return;
    }
    rememberFocus();
    const note = caption.current;
    if (!note) return;

    /** Draws the shade with its holes and rings, and puts the caption beside or under the first highlighted control. */
    const place = () => {
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const boxes = plan.targets.filter((target) => target.isConnected).map((target) => {
        const r = target.getBoundingClientRect();
        const x = Math.max(2, r.left - PAD);
        const y = Math.max(2, r.top - PAD);
        return { x, y, w: Math.min(width - 2, r.right + PAD) - x, h: r.bottom + PAD - y };
      });
      shade.current?.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const holes = boxes.map((b) => roundedRect(b.x, b.y, b.w, b.h)).join("");
      shadePath.current?.setAttribute("d", `M0 0h${width}v${height}h${-width}z${holes}`);
      ringPath.current?.setAttribute("d", holes);

      const noteWidth = note.offsetWidth;
      const noteHeight = note.offsetHeight;
      let left = MARGIN;
      let top = MARGIN;
      const first = boxes[0];
      if (first) {
        const bottom = Math.max(...boxes.map((b) => b.y + b.h));
        const above = Math.min(...boxes.map((b) => b.y));
        if (window.innerWidth >= SIDE_BY_SIDE_WIDTH && first.x + first.w + GAP + noteWidth <= width - MARGIN) {
          left = first.x + first.w + GAP;
          top = first.y + Math.min(first.h, 260) / 2 - noteHeight / 2;
        } else {
          left = Math.min(...boxes.map((b) => b.x));
          top = bottom + GAP;
          // No room underneath: above, if that fits.
          if (top + noteHeight > height - MARGIN && above - GAP - noteHeight >= MARGIN) top = above - GAP - noteHeight;
        }
      }
      left = Math.max(MARGIN, Math.min(left, width - noteWidth - MARGIN));
      top = Math.max(MARGIN, Math.min(top, height - noteHeight - MARGIN));
      note.style.left = `${left}px`;
      note.style.top = `${top}px`;
    };

    // When the highlighted controls and the caption would not both fit on screen, bring them up first. A jump, never a glide.
    const first = plan.targets[0]?.getBoundingClientRect();
    if (first) {
      const bottom = Math.max(...plan.targets.map((target) => target.getBoundingClientRect().bottom));
      if (first.top < 0 || bottom + GAP + note.offsetHeight > window.innerHeight - MARGIN) {
        window.scrollBy({ top: first.top - 88, behavior: "instant" });
      }
    }
    place();
    note.focus({ preventScroll: true });

    // Keep it lined up as the page scrolls, resizes, or finishes loading its fonts and pictures.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = new ResizeObserver(schedule);
    plan.targets.forEach((target) => observer.observe(target));
    observer.observe(document.body);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    // Escape leaves at any stop. A video starting to play leaves too, so the tour never sits over a playing video.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      leaveTour();
    };
    const onPlay = () => leaveTour();
    document.addEventListener("keydown", onKey);
    document.addEventListener("play", onPlay, true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("play", onPlay, true);
    };
  }, [plan]);

  if (!plan) return null;
  const last = plan.index === plan.stops.length - 1;
  // Moving between stops replaces the address rather than adding to the history, so the browser's Back never brings the tour back.
  const go = (to: TourStop) => router.replace(tourStopHref(to, plan.videoId));

  return (
    <>
      <svg ref={shade} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] h-screen w-full">
        <path ref={shadePath} fillRule="evenodd" className="fill-black/40" />
        <path ref={ringPath} className="fill-none stroke-brand" strokeWidth={3} />
      </svg>
      <div
        ref={caption}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby={plan.body ? "tour-body tour-names" : "tour-names"}
        tabIndex={-1}
        className="fixed z-[61] w-[min(320px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-[18px] text-ink-soft shadow-lift outline-none focus-visible:ring-2 focus-visible:ring-brand-bright"
        style={{ left: MARGIN, top: MARGIN }}
      >
        <p className="text-[0.8125rem] font-semibold text-ink-muted">
          {plan.index + 1} of {plan.stops.length}
        </p>
        <h2 id="tour-title" className="mt-0.5 text-lg font-bold text-ink">
          {plan.title}
        </h2>
        {plan.body && (
          <p id="tour-body" className="mt-1.5 text-base">
            {plan.body}
          </p>
        )}
        <p id="tour-names" className="sr-only">
          {plan.names.length > 0 ? `Highlighted: ${joinNames(plan.names)}.` : ""}
        </p>
        <div className="mt-3.5 flex items-center gap-2">
          {!last && (
            <button type="button" onClick={leaveTour} className={TEXT_BUTTON}>
              End tour
            </button>
          )}
          <span className="flex-1" />
          {plan.index > 0 && (
            <button type="button" onClick={() => go(plan.stops[plan.index - 1])} className={SECONDARY_BUTTON}>
              Back
            </button>
          )}
          <button type="button" onClick={last ? leaveTour : () => go(plan.stops[plan.index + 1])} className={PRIMARY_BUTTON}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}

const TEXT_BUTTON = "inline-flex min-h-11 items-center rounded-xl px-3 text-base font-medium text-ink-soft hover:bg-wash hover:text-ink";
const SECONDARY_BUTTON = "inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-base font-semibold text-ink hover:bg-wash";
const PRIMARY_BUTTON = "inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-base font-semibold text-on-brand hover:bg-brand-hover";
