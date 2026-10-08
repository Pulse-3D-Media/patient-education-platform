/**
 * The platform settings as plain facts: their shape, the values the app runs
 * on until the row is saved, and the sentence shown beside each one on
 * /pulse/settings.
 *
 * No database and no server imports, so the settings form (which runs in the
 * browser) and lib/db/settings.ts (which runs on the server) can both import
 * it. The reads and the save live in lib/db/settings.ts.
 */

/** The settings, as the rest of the app reads them. */
export type Settings = {
  /** Days a patient link works if nobody ever plays it. */
  unclaimedDays: number;
  /** Days a patient link keeps working after the first play. Copied onto each new link when it is made (lib/expiry.ts). */
  viewDays: number;
  /** Days a clinic keeps access after a missed payment. */
  graceDays: number;
  /** Scans of one QR code in a day that get flagged for a look. */
  qrDailyFlag: number;
  /**
   * How many times a clinic may turn a paused patient link back on (0 to 10;
   * 0 means never). Read when it is needed, never copied onto a link, so a
   * change applies to every link at once (lib/expiry.ts).
   */
  maxRenewals: number;
};

/** What the app uses until the row exists. Keep in step with the @default values in prisma/schema.prisma. */
export const SETTINGS_DEFAULTS: Settings = {
  unclaimedDays: 90,
  viewDays: 7,
  graceDays: 14,
  qrDailyFlag: 200,
  maxRenewals: 3,
};

/** The one line a staff member reads beside each setting on /pulse/settings. */
export const SETTINGS_HELP: Record<keyof Settings, string> = {
  unclaimedDays:
    "How many days a patient link stays open if nobody ever plays it. After that it is finished: a link that was never played cannot be turned back on. Applies to links made from now on.",
  viewDays:
    "Once a patient first plays their video, how many more days the link works. Then it pauses, and the clinic can turn it back on for the same number of days again (see Maximum renewals). A clinic can be given its own number. Applies to links made from now on; a link already sent keeps the number it was made with.",
  graceDays: "How many days a clinic keeps using the library after a payment fails, before it is switched off.",
  qrDailyFlag:
    "If one printed QR code gives patients this many links or more in one day (counted from midnight UTC), it is flagged on the clinic's page here for a look. A sign to look, never a limit: nothing is stopped by it. A link is made only when a patient taps Play, so this counts links, not scans and not people.",
  maxRenewals:
    "How many times a clinic can turn a paused patient link back on. 0 means never. Unlike the day counts, this is not copied onto each link: a change applies to every link at once, links already sent included.",
};

/**
 * The settings that are saved but that nothing in the app reads yet, each
 * with the line the settings page shows beside it so nobody takes the number
 * for a live one. When the feature that reads a setting is built, remove its
 * entry here; lib/settings-defaults.test.ts fails until this list matches
 * what the code really reads.
 */
export const SETTINGS_NOT_ACTIVE: Partial<Record<keyof Settings, string>> = {};
