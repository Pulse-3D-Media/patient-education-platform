import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS, SETTINGS_HELP, SETTINGS_NOT_ACTIVE, type Settings } from "./settings-defaults";

/**
 * The settings page must not claim a number is live when nothing reads it.
 * This test reads the app's own source and checks that the list of "not
 * active yet" settings is exactly the settings no code uses. So the day a
 * feature starts reading one (the QR flag, say), this fails until its "not
 * active" line is taken off the page, and the day a new setting is added
 * that nothing reads, it fails until the page says so.
 */

const SETTING_NAMES = Object.keys(SETTINGS_DEFAULTS) as (keyof Settings)[];

/** Files that only define, save or draw the settings. Mentioning a setting here is not using it. */
const NOT_A_READER = ["lib/settings-defaults.ts", "lib/db/settings.ts", "app/pulse/actions.ts", "app/pulse/settings/SettingsForm.tsx", "app/pulse/settings/page.tsx"];

/** Every .ts and .tsx file under a folder that is part of the running app (no tests). */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(path.replace(/\\/g, "/"));
  }
  return found;
}

/** The settings some part of the app reads off a settings object: "settings.viewDays", "terms.maxRenewals" and the like. */
function settingsInUse(): Set<keyof Settings> {
  const used = new Set<keyof Settings>();
  for (const path of [...sourceFiles("lib"), ...sourceFiles("app")]) {
    if (NOT_A_READER.includes(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const name of SETTING_NAMES) {
      if (new RegExp(`settings\\.${name}\\b`).test(text)) used.add(name);
    }
  }
  return used;
}

describe("settings that are saved but not active yet", () => {
  it("are exactly the settings nothing in the app reads", () => {
    const used = settingsInUse();
    const unread = SETTING_NAMES.filter((name) => !used.has(name)).sort();
    expect(Object.keys(SETTINGS_NOT_ACTIVE).sort()).toEqual(unread);
  });

  it("today that is the QR flag alone, and the four link and billing numbers are live", () => {
    expect(Object.keys(SETTINGS_NOT_ACTIVE)).toEqual(["qrDailyFlag"]);
    expect([...settingsInUse()].sort()).toEqual(["graceDays", "maxRenewals", "unclaimedDays", "viewDays"]);
  });

  it("each one says so in plain words", () => {
    for (const line of Object.values(SETTINGS_NOT_ACTIVE)) {
      expect(line).toMatch(/not active yet/i);
    }
  });

  it("every setting has a default and a help sentence", () => {
    expect(Object.keys(SETTINGS_HELP).sort()).toEqual([...SETTING_NAMES].sort());
    for (const name of SETTING_NAMES) expect(Number.isInteger(SETTINGS_DEFAULTS[name])).toBe(true);
  });
});
