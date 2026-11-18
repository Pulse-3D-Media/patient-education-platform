import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS, type Settings } from "./settings-defaults";
import { settingsChangeWords, settingsWarnings } from "./settings-warnings";

/** The yes asked before a settings save, and the server log line for it (lib/settings-warnings.ts). Pure. */

const BEFORE: Settings = { unclaimedDays: 365, viewDays: 10, graceDays: 14, qrDailyFlag: 100, qrDailyCap: 200, maxRenewals: 3 };
const change = (over: Partial<Settings>) => settingsWarnings(BEFORE, { ...BEFORE, ...over });

describe("settingsWarnings", () => {
  it("asks nothing when nothing changes", () => {
    expect(change({})).toEqual([]);
  });

  it("renewals to 0: says every paused link everywhere is finished at once, sent links included", () => {
    const [sentence] = change({ maxRenewals: 0 });
    expect(sentence).toContain("Maximum renewals 3 to 0");
    expect(sentence).toContain("links already sent included");
    expect(sentence).toContain("Every paused link at every clinic is finished at once");
  });

  it("renewals lowered but not to 0: says it applies at once, to sent links too; raised: asks nothing", () => {
    expect(change({ maxRenewals: 1 })).toEqual([expect.stringContaining("turned back on 1 time or more is finished")]);
    expect(change({ maxRenewals: 5 })).toEqual([]);
  });

  it("the printed-code limit or flag lowered: one sentence each; raised: nothing", () => {
    expect(change({ qrDailyCap: 150 })).toEqual([expect.stringContaining("at most 150 links a day")]);
    expect(change({ qrDailyFlag: 50 })).toEqual([expect.stringContaining("flagged to Pulse staff at 50 links a day")]);
    expect(change({ qrDailyCap: 300, qrDailyFlag: 150 })).toEqual([]);
  });

  it("any change to the three day counts, up or down, says what happens to new links and to links or clinics already running", () => {
    expect(change({ unclaimedDays: 90 })).toEqual([expect.stringMatching(/stops after 90 days if nobody plays it\. Links already sent keep/)]);
    expect(change({ viewDays: 14 })).toEqual([expect.stringMatching(/works for 14 days after its first play.*Links already sent keep theirs/)]);
    expect(change({ graceDays: 1 })).toEqual([expect.stringMatching(/for 1 day before it is switched off\. A clinic already in its grace period keeps/)]);
  });

  it("several changes give one sentence each, in the form's order", () => {
    const sentences = change({ qrDailyFlag: 50, unclaimedDays: 90, maxRenewals: 0 });
    expect(sentences.map((s) => s.split(" ")[0])).toEqual(["Unclaimed", "Maximum", "Printed-code"]);
  });

  it("never uses an em dash", () => {
    const all = change({ unclaimedDays: 1, viewDays: 1, graceDays: 2, qrDailyCap: 2, qrDailyFlag: 1, maxRenewals: 0 });
    expect(all).toHaveLength(6);
    for (const sentence of all) expect(sentence).not.toContain("—");
  });
});

describe("settingsChangeWords", () => {
  it("names only what changed, from what to what, with numbers only", () => {
    expect(settingsChangeWords(SETTINGS_DEFAULTS, { ...SETTINGS_DEFAULTS, viewDays: 10, maxRenewals: 0 })).toBe("viewDays 7 -> 10, maxRenewals 3 -> 0");
    expect(settingsChangeWords(BEFORE, BEFORE)).toBe("");
  });
});
