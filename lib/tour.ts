/**
 * The quick tour of the library (the approved design, screens 07-tour-1 to 3):
 * the rules, as plain values and small pure functions. No database, no Clerk,
 * nothing from the server, so the tour's own code (components/tour) and its
 * tests can both use it, and the pages that link to the tour can import the
 * addresses without pulling the tour itself in.
 *
 * THE STOPS, in order:
 *   1. "nav"   on the library home: the categories and the search box.
 *   2. "video" on an open video's page: Favorite, Send to patient, Show QR.
 *              Skipped when the clinic has no video it can open.
 *   3. "admin" on the admin overview: the admin pages. Office admins only.
 *
 * WHERE THE TOUR IS kept in the address, as ?tour=<stop> (and ?tv=<video id>
 * once a video has been picked, so Back from the admin pages can find it
 * again). Nothing about the tour is stored on the server, and nothing in the
 * address grants anything: the pages underneath check who may see what, as
 * always, and the tour only points at what they already drew.
 *
 * WHETHER IT HAS BEEN SEEN is one value in this browser's own storage. It is
 * only used to offer the tour once to someone who has just joined a clinic.
 * It is per browser, not per person: a second device, or cleared site data,
 * offers it once more. When storage is blocked (some private windows) the
 * answer is "unknown", and the tour is then simply not offered by itself; it
 * can still be started from the account menu.
 */

import { readWatchVideoId, watchPageHref } from "./library-rows";

/** The three stops, by name. */
export type TourStop = "nav" | "video" | "admin";

/** The address parameter that says which stop is showing ("nav", "video", "admin"), or "offer". */
export const TOUR_PARAM = "tour";
/** The address parameter that carries the video the tour opened, once one is picked. */
export const TOUR_VIDEO_PARAM = "tv";
/** The value of ?tour that asks for the one-time offer (after joining a clinic). */
export const TOUR_OFFER = "offer";

/** Where "Take a quick tour" and "Take the tour" go: the first stop. */
export const TOUR_START_HREF = `/library?${TOUR_PARAM}=nav`;
/** Where someone who has just joined a clinic lands: the library home, with the tour offered once. */
export const TOUR_OFFER_HREF = `/library?${TOUR_PARAM}=${TOUR_OFFER}`;

/** The library home, where the first stop and the offer are shown. */
export const LIBRARY_HOME = "/library";

/** Where this browser remembers that the tour was seen or offered. */
export const TOUR_SEEN_KEY = "p3-tour-seen";

/** The words on each stop, exactly as the mock-up has them. No paragraphs (decided 2026-11-16). */
export const TOUR_COPY = {
  offer: { title: "Take a quick tour?", yes: "Show me", no: "Not now" },
  nav: { title: "Navigate by specialty", body: null },
  /** Stop 2 for someone holding a seat, who has Send and Show QR. */
  videoSend: { title: "Send it or save it", body: "Send the video to a patient's phone, show a QR code, or keep it as a favorite." },
  /** Stop 2 for someone without a seat: only what they can see, and nothing about seats or plans. */
  videoSave: { title: "Save it", body: "Keep the video as a favorite, at the top of your library." },
  admin: { title: "Your admin pages", body: "Links, people, clinic branding and billing. Admins only." },
} as const;

/** What the address asks the tour to do: nothing, the one-time offer, or show one stop. */
export type TourRequest = { kind: "offer" } | { kind: "stop"; stop: TourStop; videoId: string | null } | null;

/** Reads ?tour (and ?tv) from an address. Anything it does not recognise is nothing at all. */
export function readTourRequest(params: Pick<URLSearchParams, "get">): TourRequest {
  const value = params.get(TOUR_PARAM);
  if (value === TOUR_OFFER) return { kind: "offer" };
  if (value === "nav" || value === "video" || value === "admin") {
    return { kind: "stop", stop: value, videoId: readWatchVideoId(params.get(TOUR_VIDEO_PARAM) ?? undefined) };
  }
  return null;
}

/**
 * The stops this person's tour has, in order: the first always, the video
 * stop only when there is a video to open, the admin stop only for an
 * office admin. A courtesy, like the menu's Admin line: the admin pages
 * check for themselves.
 */
export function tourStops({ hasVideo, isAdmin }: { hasVideo: boolean; isAdmin: boolean }): TourStop[] {
  const stops: TourStop[] = ["nav"];
  if (hasVideo) stops.push("video");
  if (isAdmin) stops.push("admin");
  return stops;
}

/** The address of one stop. The video stop needs the video; the others carry it along when there is one. */
export function tourStopHref(stop: TourStop, videoId: string | null): string {
  const keep = videoId ? `&${TOUR_VIDEO_PARAM}=${encodeURIComponent(videoId)}` : "";
  if (stop === "video" && videoId) return `${watchPageHref(videoId)}?${TOUR_PARAM}=video${keep}`;
  if (stop === "admin") return `/admin?${TOUR_PARAM}=admin${keep}`;
  return TOUR_START_HREF;
}

/** The same address with the tour's parameters taken out, everything else kept. */
export function withoutTourParams(href: string, base = "http://local.invalid"): string {
  const url = new URL(href, base);
  url.searchParams.delete(TOUR_PARAM);
  url.searchParams.delete(TOUR_VIDEO_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Joins names the way a sentence does: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The browser's local storage, or whatever stands in for it in a test. */
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike {
  return window.localStorage;
}

/**
 * Has this browser seen (or been offered) the tour? true or false, or null
 * when storage cannot be read at all, in which case the tour is not offered
 * by itself. Never throws.
 */
export function readTourSeen(storage: () => StorageLike = browserStorage): boolean | null {
  try {
    return storage().getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return null;
  }
}

/** Remembers in this browser that the tour was seen. A blocked store just means it is not remembered. Never throws. */
export function markTourSeen(storage: () => StorageLike = browserStorage): void {
  try {
    storage().setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Not remembered: nothing else depends on it.
  }
}
