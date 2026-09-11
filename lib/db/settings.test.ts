import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { SETTINGS_DEFAULTS, SETTINGS_ID, getSettings, saveSettings } from "./settings";

/**
 * getSettings() against the real test database. The AppSettings table has
 * one row at most, so these tests remove it, check the defaults come back,
 * save a row, check its values come back, and remove it again afterwards.
 */

beforeAll(async () => {
  await prisma.appSettings.deleteMany({ where: { id: SETTINGS_ID } });
});

afterAll(async () => {
  await prisma.appSettings.deleteMany({ where: { id: SETTINGS_ID } });
  await prisma.$disconnect();
});

describe("getSettings", () => {
  it("returns the defaults when the row does not exist", async () => {
    expect(await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } })).toBeNull();
    expect(await getSettings()).toEqual(SETTINGS_DEFAULTS);
  });

  it("returns the saved values once the row exists", async () => {
    const saved = await saveSettings({ unclaimedDays: 60, viewDays: 10, graceDays: 21, qrDailyFlag: 500 });
    expect(saved).toEqual({ unclaimedDays: 60, viewDays: 10, graceDays: 21, qrDailyFlag: 500 });

    expect(await getSettings()).toEqual({ unclaimedDays: 60, viewDays: 10, graceDays: 21, qrDailyFlag: 500 });
  });

  it("saving again updates the one row instead of adding a second", async () => {
    await saveSettings({ ...SETTINGS_DEFAULTS, viewDays: 3 });
    expect(await prisma.appSettings.count()).toBe(1);
    expect((await getSettings()).viewDays).toBe(3);
  });
});
