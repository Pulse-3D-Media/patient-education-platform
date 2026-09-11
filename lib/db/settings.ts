import { prisma } from "./client";

/**
 * The platform-wide settings: one row in the AppSettings table, id "default".
 *
 * Every number that used to be a constant in a page lives here, read at
 * request time. The defaults below are the values the app runs with until
 * Pulse staff save the row from /pulse/settings, and they are what the
 * database itself defaults to, so the two can never disagree.
 *
 * Nothing calls the database for a single field: read the whole row once
 * with getSettings() and pass what you need along.
 */

/** The settings, as the rest of the app reads them. */
export type Settings = {
  /** Days a patient link works if nobody ever opens it. */
  unclaimedDays: number;
  /** Days a patient link keeps working after the first view. */
  viewDays: number;
  /** Days a clinic keeps access after a missed payment. */
  graceDays: number;
  /** Scans of one QR code in a day that get flagged for a look. */
  qrDailyFlag: number;
};

/** The id of the one row. Never any other value. */
export const SETTINGS_ID = "default";

/** What the app uses until the row exists. Keep in step with the @default values in prisma/schema.prisma. */
export const SETTINGS_DEFAULTS: Settings = {
  unclaimedDays: 90,
  viewDays: 7,
  graceDays: 14,
  qrDailyFlag: 200,
};

/** The one line a staff member reads beside each setting on /pulse/settings. */
export const SETTINGS_HELP: Record<keyof Settings, string> = {
  unclaimedDays: "How many days a patient link stays open if nobody ever taps it. After that it stops working.",
  viewDays: "Once a patient opens their link, how many more days it keeps working. A clinic can be given its own number.",
  graceDays: "How many days a clinic keeps using the library after a payment fails, before it is switched off.",
  qrDailyFlag: "If one QR code is scanned more than this many times in a day, it is flagged on the reports for a look.",
};

/**
 * The current settings. Returns the row when it exists, and the defaults
 * when it does not, so nothing can break before the row has been saved.
 * Never returns null.
 */
export async function getSettings(): Promise<Settings> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { unclaimedDays: true, viewDays: true, graceDays: true, qrDailyFlag: true },
  });
  return row ?? SETTINGS_DEFAULTS;
}

/**
 * Save all four settings at once, creating the row the first time. Returns
 * the settings as they now are. Callers check the values first (whole
 * numbers, at least 1); this function trusts them.
 */
export async function saveSettings(values: Settings): Promise<Settings> {
  const row = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...values },
    update: values,
    select: { unclaimedDays: true, viewDays: true, graceDays: true, qrDailyFlag: true },
  });
  return row;
}
