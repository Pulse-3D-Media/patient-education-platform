import type { Settings } from "./settings-defaults";

/**
 * What a settings save on /pulse/settings would change for links and
 * clinics, in plain sentences, and the server log line for a save. Pure and
 * safe for the browser: the form asks for a yes with these sentences before
 * it sends, and the action writes the log line after it saves.
 *
 * The yes is a courtesy against a slip of the hand. The protection is on the
 * server: Pulse staff only, and every number checked again (saveSettingsAction).
 *
 * Which changes ask first: the ones that reach links already sent or clinics
 * already running, or that change every link made from now on.
 *   - Maximum renewals lowered (to 0 above all: every paused link everywhere
 *     is finished at once, because the number is read live, not copied).
 *   - The printed-code limit or flag lowered.
 *   - Unclaimed link days, days after first play, or grace days changed.
 * Raising the printed-code limit or flag, or raising renewals, asks nothing.
 */

/** The order the sentences and the log line follow, matching the form. */
const ORDER: (keyof Settings)[] = ["unclaimedDays", "viewDays", "maxRenewals", "graceDays", "qrDailyCap", "qrDailyFlag"];

/** "1 day", "7 days". */
function days(n: number) {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** One sentence per change that should be confirmed first, in the form's order. Empty when nothing needs a yes. */
export function settingsWarnings(before: Settings, after: Settings): string[] {
  const out: string[] = [];
  if (after.unclaimedDays !== before.unclaimedDays) {
    out.push(
      `Unclaimed link days ${before.unclaimedDays} to ${after.unclaimedDays}: every link made from now on stops after ${days(after.unclaimedDays)} if nobody plays it. Links already sent keep the days they were made with.`,
    );
  }
  if (after.viewDays !== before.viewDays) {
    out.push(
      `Days after first play ${before.viewDays} to ${after.viewDays}: every link made from now on works for ${days(after.viewDays)} after its first play, at every clinic without its own number. Links already sent keep theirs.`,
    );
  }
  if (after.maxRenewals < before.maxRenewals) {
    out.push(
      after.maxRenewals === 0
        ? `Maximum renewals ${before.maxRenewals} to 0: no clinic can turn any paused link back on, links already sent included. Every paused link at every clinic is finished at once, and its patient sees the "ask for a new link" page.`
        : `Maximum renewals ${before.maxRenewals} to ${after.maxRenewals}: this applies at once to every link, links already sent included. A paused link that has already been turned back on ${after.maxRenewals} ${after.maxRenewals === 1 ? "time" : "times"} or more is finished.`,
    );
  }
  if (after.graceDays !== before.graceDays) {
    out.push(
      `Grace days ${before.graceDays} to ${after.graceDays}: a clinic whose card payment fails from now on keeps the library for ${days(after.graceDays)} before it is switched off. A clinic already in its grace period keeps the deadline it was given.`,
    );
  }
  if (after.qrDailyCap < before.qrDailyCap) {
    out.push(
      `Printed-code links per day ${before.qrDailyCap} to ${after.qrDailyCap}: from now on each printed code at every clinic hands out at most ${after.qrDailyCap} links a day. A code that has already handed out that many today stops until midnight UTC. Links already handed out keep working.`,
    );
  }
  if (after.qrDailyFlag < before.qrDailyFlag) {
    out.push(
      `Printed-code links per day to flag ${before.qrDailyFlag} to ${after.qrDailyFlag}: printed codes are flagged to Pulse staff at ${after.qrDailyFlag} links a day, so more may show as flagged. Nothing is stopped by a flag.`,
    );
  }
  return out;
}

/** The changed settings as "viewDays 7 -> 10, maxRenewals 3 -> 0": names and numbers only, for the server log. Empty when nothing changed. */
export function settingsChangeWords(before: Settings, after: Settings): string {
  return ORDER.filter((name) => before[name] !== after[name])
    .map((name) => `${name} ${before[name]} -> ${after[name]}`)
    .join(", ");
}
