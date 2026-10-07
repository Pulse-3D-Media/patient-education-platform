import { describe, expect, it } from "vitest";
import { periodSentence, periodStart, playedRate, readReportDays, REPORT_DEFINITIONS, seatSourceOf } from "./reports";

describe("the period", () => {
  it("is 30 days unless the address says exactly 90", () => {
    expect(readReportDays("90")).toBe(90);
    expect(readReportDays("30")).toBe(30);
    for (const junk of [undefined, "", "7", "90 ", "365", ["90"], 90, "abc"]) expect(readReportDays(junk)).toBe(30);
  });

  it("starts exactly that many 24-hour days before now", () => {
    const now = new Date("2026-10-07T18:00:00Z");
    expect(periodStart(now, 30)).toEqual(new Date("2026-09-07T18:00:00Z"));
    expect(periodStart(now, 90)).toEqual(new Date("2026-07-09T18:00:00Z"));
  });

  it("is described as a group of links made in it, not as activity in it", () => {
    expect(periodSentence(30)).toBe("Links made in the last 30 days, with the plays and renewals recorded on them so far.");
  });
});

describe("the played rate", () => {
  it("is played over made, as a whole percent", () => {
    expect(playedRate({ made: 8, played: 5 })).toBe("63%");
    expect(playedRate({ made: 3, played: 0 })).toBe("0%");
    expect(playedRate({ made: 4, played: 4 })).toBe("100%");
  });

  it("is a dash, not zero, when no links were made", () => {
    expect(playedRate({ made: 0, played: 0 })).toBe("–");
  });
});

describe("who provides a clinic's seats", () => {
  it("is Pulse for a managed clinic or one opened by hand, and the card otherwise", () => {
    expect(seatSourceOf({ managedByPulse: true, staffAccess: null })).toBe("pulse");
    expect(seatSourceOf({ managedByPulse: false, staffAccess: "OPEN" })).toBe("pulse");
    expect(seatSourceOf({ managedByPulse: false, staffAccess: null })).toBe("card");
    // Paused or cancelled by hand means closed, and closed clinics are left out of the seat totals before this is asked.
    expect(seatSourceOf({ managedByPulse: false, staffAccess: "PAUSED" })).toBe("card");
  });
});

describe("the definitions", () => {
  it("never call a link a person, a play start a viewer or a watch, or any of it understanding or consent", () => {
    const text = REPORT_DEFINITIONS.map((row) => `${row.term} ${row.meaning}`).join(" ");
    expect(text).toContain("A link is not a person");
    expect(text).toContain("Not unique viewers, not completed watches");
    expect(text).not.toMatch(/consent|watched|viewers? (?!not)|patients reached/i);
    // No em dashes in copy (CLAUDE.md, "Writing copy").
    expect(text).not.toContain("—");
  });
});
