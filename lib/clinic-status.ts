import type { ClinicStatus } from "@prisma/client";

/**
 * Is a clinic with this status allowed to use the library and the admin
 * console?
 *
 * This is the one place that question is answered. Every page and action
 * that lets a clinic in calls this, so when billing adds a grace period for
 * PAST_DUE, or pausing, only this function changes.
 *
 * Today: only ACTIVE. A PENDING clinic has signed up but not chosen a plan.
 * PAUSED, PAST_DUE and CANCELED are set by billing later.
 */
export function clinicIsOpen(status: ClinicStatus): boolean {
  return status === "ACTIVE";
}

/** Nothing here talks to a database or to Clerk: it is a plain rule, so it can be tested on its own. */
