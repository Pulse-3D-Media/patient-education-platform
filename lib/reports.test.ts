import { describe, expect, it } from "vitest";
import {
  periodStart,
  playedRate,
  presetRange,
  rangeFileTag,
  rangeSentence,
  readReportDays,
  readReportRange,
  REPORT_DEFINITIONS,
  reportHref,
  seatSourceOf,
  utahDateOf,
  utahStartOfDay,
} from "./reports";

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
    const now = new Date("2026-10-07T18:00:00Z");
    expect(rangeSentence(presetRange(30, now))).toBe("Links made in the last 30 days, with the plays and renewals recorded on them so far.");
    expect(rangeSentence(readReportRange({ from: "2026-09-01", to: "2026-09-30" }, now).range)).toBe(
      "Links made from Sep 1, 2026 to Sep 30, 2026, Utah time, with the plays and renewals recorded on them so far.",
    );
  });
});

describe("custom dates", () => {
  // Noon in Utah on Oct 7, 2026 (Utah is 6 hours behind UTC in summer).
  const now = new Date("2026-10-07T18:00:00Z");

  it("are whole days in Utah time: from midnight at the start of the first to midnight at the end of the last", () => {
    const { range, problem } = readReportRange({ from: "2026-09-01", to: "2026-09-30" }, now);
    expect(problem).toBeNull();
    expect(range).toEqual({
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      since: new Date("2026-09-01T06:00:00Z"),
      until: new Date("2026-10-01T06:00:00Z"),
    });
  });

  it("follow the clock change: a range across the first Sunday of November ends at Utah's winter midnight", () => {
    const later = new Date("2026-12-01T00:00:00Z");
    const { range } = readReportRange({ from: "2026-10-31", to: "2026-11-02" }, later);
    expect(range.since).toEqual(new Date("2026-10-31T06:00:00Z"));
    expect(range.until).toEqual(new Date("2026-11-03T07:00:00Z"));
    expect(utahStartOfDay("2027-03-14")).toEqual(new Date("2027-03-14T07:00:00Z"));
    expect(utahStartOfDay("2027-03-15")).toEqual(new Date("2027-03-15T06:00:00Z"));
  });

  it("end now, not tomorrow, when the last day is today; one day is allowed", () => {
    expect(readReportRange({ from: "2026-10-01", to: "2026-10-07" }, now).range.until).toEqual(now);
    const one = readReportRange({ from: "2026-10-03", to: "2026-10-03" }, now).range;
    expect([one.since, one.until]).toEqual([new Date("2026-10-03T06:00:00Z"), new Date("2026-10-04T06:00:00Z")]);
  });

  it("fall back to the last 30 days, with a sentence, when they cannot be used, and never guess", () => {
    const cases: [Record<string, string>, string][] = [
      [{ from: "2026-09-01" }, "Choose both a start date and an end date."],
      [{ to: "2026-09-01" }, "Choose both a start date and an end date."],
      [{ from: "yesterday", to: "2026-09-30" }, "Those dates could not be read."],
      [{ from: "2026-02-30", to: "2026-03-02" }, "Those dates could not be read."],
      [{ from: "2026-9-1", to: "2026-09-30" }, "Those dates could not be read."],
      [{ from: "2023-12-31", to: "2026-09-30" }, "Choose a start date on or after Jan 1, 2024."],
      [{ from: "0001-01-01", to: "2026-09-30" }, "Those dates could not be read."],
      [{ from: "2026-09-30", to: "2026-09-01" }, "The start date is after the end date."],
      [{ from: "2026-10-08", to: "2026-10-09" }, "The start date is in the future."],
    ];
    for (const [params, words] of cases) {
      const { range, problem } = readReportRange(params, now);
      expect(problem).toBe(`${words} Showing the last 30 days instead.`);
      expect(range).toEqual(presetRange(30, now));
    }
  });

  it("read the 30 or 90 days when no dates are given, and ignore ?days when dates are", () => {
    expect(readReportRange({ days: "90" }, now)).toEqual({ range: presetRange(90, now), problem: null });
    expect(readReportRange({ from: "", to: "" }, now)).toEqual({ range: presetRange(30, now), problem: null });
    expect(readReportRange({ days: "90", from: "2026-09-01", to: "2026-09-30" }, now).range.kind).toBe("custom");
  });

  it("go into the address, the next page and the file name", () => {
    const custom = readReportRange({ from: "2026-09-01", to: "2026-09-30" }, now).range;
    expect(reportHref("/pulse/reports", presetRange(30, now))).toBe("/pulse/reports");
    expect(reportHref("/pulse/reports", presetRange(90, now), { page: "2" })).toBe("/pulse/reports?days=90&page=2");
    expect(reportHref("/pulse/reports/export", custom, { table: "clinics" })).toBe("/pulse/reports/export?from=2026-09-01&to=2026-09-30&table=clinics");
    expect(rangeFileTag(custom)).toBe("2026-09-01-to-2026-09-30");
    expect(rangeFileTag(presetRange(30, now))).toBe("2026-09-07-to-2026-10-07");
  });

  it("know Utah's date late in the evening, when UTC is already on the next day", () => {
    expect(utahDateOf(new Date("2026-10-08T05:00:00Z"))).toBe("2026-10-07");
    expect(utahDateOf(new Date("2026-10-08T06:00:00Z"))).toBe("2026-10-08");
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
