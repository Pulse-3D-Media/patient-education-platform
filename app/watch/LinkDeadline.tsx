"use client";

import { useSyncExternalStore } from "react";
import { describeLinkDate } from "@/lib/format";

/**
 * "This link works until Friday, October 18." on the patient page, with the
 * date in the PATIENT'S OWN time zone.
 *
 * Why this runs in the browser: the page is drawn on Vercel's server, whose
 * clock is in UTC and which has no idea where the patient is. A deadline of
 * 2am UTC on October 19 is still the evening of October 18 in Utah, so a date
 * worked out on the server could be a day off. Only the phone knows its own
 * time zone, so the phone writes the date.
 *
 * How, without a blank line or a flash: React's useSyncExternalStore takes
 * two answers. The server's answer (and the one the browser starts with, so
 * the page it was sent and the page React picks up agree) is the date in
 * Utah time, America/Denver, where Pulse 3D is and the zone the reports use.
 * Straight after the page comes to life the browser's answer, the date in the
 * phone's own zone, replaces it. For a patient in Utah, or anywhere the two
 * fall on the same day, nothing visibly changes; elsewhere the word changes
 * once, in place, on the same line.
 *
 * The deadline comes in as a number of milliseconds (a Date cannot be handed
 * from a server component to a browser one), with the server's "now", which
 * only decides whether the year is written.
 */
const SERVER_ZONE = "America/Denver";

/** A time zone never changes while the page is open, so there is nothing to listen for. */
function subscribe() {
  return () => {};
}

export function LinkDeadline({ deadlineMs, nowMs }: { deadlineMs: number; nowMs: number }) {
  const deadline = new Date(deadlineMs);
  const now = new Date(nowMs);
  const date = useSyncExternalStore(
    subscribe,
    () => describeLinkDate(deadline, now),
    () => describeLinkDate(deadline, now, SERVER_ZONE),
  );
  return <>{`This link works until ${date}.`}</>;
}
