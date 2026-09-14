import type { Prisma } from "@prisma/client";
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
 * with getSettings() and pass what you need along. A link being made reads
 * them with lockSettings() instead, inside its own transaction, so that a
 * save landing at the same moment cannot give it stale numbers (see below).
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
  unclaimedDays: "How many days a patient link stays open if nobody ever plays it. After that it stops working. Applies to links made from now on.",
  viewDays:
    "Once a patient first plays their video, how many more days the link keeps working. A clinic can be given its own number. Applies to links made from now on; a link already sent keeps the number it was made with.",
  graceDays: "How many days a clinic keeps using the library after a payment fails, before it is switched off.",
  qrDailyFlag: "If one QR code is scanned more than this many times in a day, it is flagged on the reports for a look.",
};

/** The four columns, as every read here asks for them. */
const SETTINGS_SELECT = { unclaimedDays: true, viewDays: true, graceDays: true, qrDailyFlag: true } as const;

/**
 * The current settings. Returns the row when it exists, and the defaults
 * when it does not, so nothing can break before the row has been saved.
 * Never returns null.
 */
export async function getSettings(): Promise<Settings> {
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
  return row ?? SETTINGS_DEFAULTS;
}

// ---------------------------------------------------------------------------
// The settings lock.
//
// A share link copies the settings onto itself when it is made (lib/expiry.ts),
// so the read and the insert have to see the same settings. A save that
// commits between the two would leave the link carrying numbers that were
// already out of date the moment it was written. Postgres lets a transaction
// hold a named lock until it ends, and that is what keeps the two apart:
//
//   - a link being made takes the lock SHARED (lockSettings, inside the
//     createShare transaction). Any number of links can be made at once;
//     shared holders do not block each other.
//   - a save takes the lock EXCLUSIVELY (saveSettings). It waits until no
//     link is mid-creation, and while it holds the lock no link can start
//     reading. So a save either landed before a link read the settings, or
//     waits until that link is written.
//
// A named lock rather than locking the settings row itself, because the row
// may not exist yet (the app runs on the defaults until the first save), and
// a row that is not there cannot be locked. The lock is released with the
// transaction, so it is safe through the connection pooler too. The lock
// statements run through $executeRaw because the lock functions return
// nothing (Postgres's "void"), which $queryRaw cannot read back.
// ---------------------------------------------------------------------------

/** The number that names the settings lock in Postgres. Nothing else in the app takes an advisory lock. */
const SETTINGS_LOCK_KEY = 20260914;

/**
 * The settings for a link being made, read inside that link's transaction
 * with the shared settings lock held. What comes back is exactly what the
 * link will carry, and no save can change it until the link is written.
 * Returns the defaults when the row does not exist, like getSettings().
 */
export async function lockSettings(tx: Prisma.TransactionClient): Promise<Settings> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${SETTINGS_LOCK_KEY}::bigint)`;
  const row = await tx.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
  return row ?? SETTINGS_DEFAULTS;
}

/**
 * Save all four settings at once, creating the row the first time. Returns
 * the settings as they now are. Callers check the values first (whole
 * numbers, at least 1, and the day counts no more than a year, see
 * lib/expiry.ts); this function trusts them.
 *
 * The write waits for the exclusive settings lock (see above), so it never
 * lands in the middle of a link being made.
 */
export async function saveSettings(values: Settings): Promise<Settings> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETTINGS_LOCK_KEY}::bigint)`;
    return tx.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...values },
      update: values,
      select: SETTINGS_SELECT,
    });
  });
}
