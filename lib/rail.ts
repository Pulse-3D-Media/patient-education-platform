/**
 * The side rail's rules (Evan, 2026-11-20), as plain values and small pure
 * functions, so the rail (components/ui/SideRail.tsx), the tour and their
 * tests can all use them. No database, no Clerk, nothing from the server.
 *
 * The rail is the same on the library and the admin pages. At rest it is a
 * narrow strip of icons (Home, Library, Admin). It opens into the full menu
 * OVER the page, so nothing underneath moves:
 *
 *   - WITH A MOUSE, when the pointer rests on it, and it closes when the
 *     pointer leaves. Both wait a moment first, so a pointer passing across
 *     does not make it flap.
 *   - WITH TOUCH (a phone, a tablet, any screen with no hover), only by
 *     tapping the three lines, and a tap outside closes it.
 *   - WITH THE KEYBOARD, when the focus moves into it; Escape closes it.
 *
 * Mouse or touch is decided by what the device says each time the pointer
 * moves (a touch on a laptop's touch screen counts as touch), never by the
 * width of the screen: the library is tablet-first, and a tablet has no
 * hover.
 */

/** How long the pointer must rest on the closed rail before it opens. */
export const RAIL_OPEN_DELAY_MS = 150;

/** How long after the pointer leaves the open rail before it closes. Coming back in time keeps it open. */
export const RAIL_CLOSE_DELAY_MS = 300;

/** The width from which there is a rail at all (Tailwind's md). A phone has none: the three lines in its top bar slide the menu out instead. */
export const RAIL_QUERY = "(min-width: 768px)";

/** Only a device that can hover opens the rail on hover. */
export const HOVER_QUERY = "(hover: hover)";

/** The event the tour sends to have the rail opened at a stop that points into it. */
export const RAIL_OPEN_EVENT = "p3-rail-open";

/** How the rail came to be open, which decides how it closes. */
export type RailMode =
  /** The mouse rests on it: closes when the pointer leaves. */
  | "hover"
  /** The keyboard moved into it: closes when the focus leaves. */
  | "focus"
  /** A tap or a click on the three lines (or the Library icon): closes on a tap outside, Escape, or choosing something. */
  | "pinned"
  /** The tour opened it to point at what is inside: closes on a press anywhere outside it, Escape, or a new page. */
  | "tour";

/** What can happen to the rail. */
export type RailEvent =
  | { kind: "pointer-rested" }
  | { kind: "pointer-left" }
  | { kind: "keyboard-focus-in" }
  | { kind: "focus-left" }
  | { kind: "menu-pressed" }
  | { kind: "library-pressed" }
  | { kind: "tour-asked" }
  | { kind: "dismissed" };

/**
 * The rail's whole behaviour in one place: what it is after something
 * happens. `null` is closed. The delays are kept by the caller (the timers
 * are only about WHEN "pointer-rested" and "pointer-left" are sent).
 */
export function nextRailMode(now: RailMode | null, event: RailEvent): RailMode | null {
  switch (event.kind) {
    case "pointer-rested":
      // The mouse never takes over a rail opened another way.
      return now ?? "hover";
    case "pointer-left":
      return now === "hover" ? null : now;
    case "keyboard-focus-in":
      return now ?? "focus";
    case "focus-left":
      // Tabbing out of the rail closes it, however it was opened, except a mouse still resting on it, or the tour (whose caption takes the focus).
      return now === "hover" || now === "tour" ? now : null;
    case "menu-pressed":
      // The three lines open it for good, or close it whatever opened it.
      return now === null ? "pinned" : null;
    case "library-pressed":
      // The Library icon opens the menu where the categories are; once open, pressing it keeps it open.
      return now === null || now === "hover" || now === "focus" ? "pinned" : now;
    case "tour-asked":
      return "tour";
    case "dismissed":
      return null;
  }
}

/** True when a video on the page is playing. The rail does not open on hover then, so it never covers a playing video's controls. */
export function aVideoIsPlaying(videos: Iterable<Pick<HTMLVideoElement, "paused" | "ended">>): boolean {
  for (const video of videos) {
    if (!video.paused && !video.ended) return true;
  }
  return false;
}
