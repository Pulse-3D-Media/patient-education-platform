import type { ClinicStatus } from "@prisma/client";

/**
 * Is this clinic allowed to use the library and the admin console right now?
 *
 * This is the one place that question is answered. Every page and action
 * that lets a clinic in calls this (the pages directly, share links through
 * the access rule in lib/access.ts, which calls it too), so the library,
 * link creation and, later, QR codes cannot disagree.
 *
 * The rule:
 *
 *   ACTIVE     open.
 *   PAST_DUE   a renewal payment failed. Open until the exact moment the
 *              grace period ends (graceEndsAt), closed from that moment on.
 *              A PAST_DUE clinic with no deadline stored is closed: a
 *              missing time is never read as "unlimited".
 *   PENDING, PAUSED, CANCELED   closed.
 *
 * `status` here is the clinic's effective status, the one stored on the
 * Clinic row. How it is worked out from what staff set by hand and from
 * billing is effectiveAccess() in lib/billing-state.ts; this function only
 * reads the result.
 *
 * `now` is the server's clock. It is a parameter so the tests can stand on
 * either side of a deadline; nothing in the app passes anything but the
 * default.
 */
export type ClinicOpenFacts = {
  status: ClinicStatus;
  /** When the grace period ends. Only read while the status is PAST_DUE. */
  graceEndsAt: Date | null;
};

export function clinicIsOpen(clinic: ClinicOpenFacts, now: Date = new Date()): boolean {
  if (clinic.status === "ACTIVE") return true;
  if (clinic.status === "PAST_DUE") return inGrace(clinic.graceEndsAt, now);
  return false;
}

/** True while `now` is before the deadline. A missing or unreadable deadline is never "in grace". */
export function inGrace(graceEndsAt: Date | null, now: Date = new Date()): boolean {
  if (!(graceEndsAt instanceof Date)) return false;
  const deadline = graceEndsAt.getTime();
  if (!Number.isFinite(deadline)) return false;
  return now.getTime() < deadline;
}

/** Nothing here talks to a database or to Clerk: it is a plain rule, so it can be tested on its own. */
