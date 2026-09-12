import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_DEFAULTS, SETTINGS_ID, getSettings, saveSettings } from "./settings";

/**
 * getSettings() and saveSettings(), against a stand-in for the one
 * AppSettings row instead of the test database.
 *
 * Why not the real database like the other lib/db tests: AppSettings has a
 * single shared row, id "default", that belongs to the app, not to any
 * test. The other suites create their own rows and delete them by id; this
 * one cannot, because there is only one row and it is not ours. The earlier
 * version of this file deleted it before and after each run, which wiped
 * whatever settings had been saved on the testing branch (rule: tests never
 * touch rows they did not make). So the Prisma client is replaced here with
 * a tiny in-memory table holding at most one row, and the tests check the
 * same things: the defaults come back when the row is missing, the saved
 * values come back once it exists, and saving twice updates one row instead
 * of adding a second.
 */

type Row = Record<string, unknown> & { id: string };

// vi.hoisted runs before the mock below is installed, so the mock can reach it.
const table = vi.hoisted(() => ({ row: null as Row | null }));

/** Only the columns the caller asked for, as Prisma's `select` returns. */
function pick(row: Row, select: Record<string, boolean> | undefined) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

vi.mock("./client", () => ({
  prisma: {
    appSettings: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) =>
        table.row && table.row.id === where.id ? pick(table.row, select) : null,
      upsert: async ({
        where,
        create,
        update,
        select,
      }: {
        where: { id: string };
        create: Row;
        update: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        table.row = table.row && table.row.id === where.id ? { ...table.row, ...update } : { ...create };
        return pick(table.row, select);
      },
      count: async () => (table.row ? 1 : 0),
    },
  },
}));

beforeEach(() => {
  table.row = null;
});

describe("getSettings", () => {
  it("returns the defaults when the row does not exist", async () => {
    expect(await getSettings()).toEqual(SETTINGS_DEFAULTS);
  });

  it("returns the saved values once the row exists", async () => {
    const values = { unclaimedDays: 60, viewDays: 10, graceDays: 21, qrDailyFlag: 500 };
    expect(await saveSettings(values)).toEqual(values);
    expect(table.row?.id).toBe(SETTINGS_ID);
    expect(await getSettings()).toEqual(values);
  });

  it("saving again updates the one row instead of adding a second", async () => {
    await saveSettings({ ...SETTINGS_DEFAULTS, viewDays: 3 });
    await saveSettings({ ...SETTINGS_DEFAULTS, viewDays: 4 });
    expect(table.row?.id).toBe(SETTINGS_ID);
    expect((await getSettings()).viewDays).toBe(4);
  });

  it("never returns null, even before anything was saved", async () => {
    const settings = await getSettings();
    expect(settings).not.toBeNull();
    expect(Object.keys(settings).sort()).toEqual(["graceDays", "qrDailyFlag", "unclaimedDays", "viewDays"]);
  });
});
