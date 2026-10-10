import { describe, expect, it } from "vitest";
import { describeLinkDate, formatDuration, parseDuration } from "./format";

/** describeLinkDate writes a link's deadline for the patient page, in a time zone. Pure, no database. */
describe("describeLinkDate", () => {
  const now = new Date("2026-10-10T18:00:00Z");

  it("is the weekday, month and day, with no year in the same year and no time", () => {
    expect(describeLinkDate(new Date("2026-10-20T18:00:00Z"), now, "America/Denver")).toBe("Tuesday, October 20");
  });

  it("is the day in the zone it is written in: one moment can be two different days", () => {
    // 2am UTC on October 19 is 8pm on October 18 in Utah, and the afternoon of October 19 in Sydney.
    const deadline = new Date("2026-10-19T02:00:00Z");
    expect(describeLinkDate(deadline, now, "America/Denver")).toBe("Sunday, October 18");
    expect(describeLinkDate(deadline, now, "UTC")).toBe("Monday, October 19");
    expect(describeLinkDate(deadline, now, "Australia/Sydney")).toBe("Monday, October 19");
  });

  it("adds the year only when the date is not in this year, judged in the same zone", () => {
    expect(describeLinkDate(new Date("2027-01-04T18:00:00Z"), now, "America/Denver")).toBe("Monday, January 4, 2027");
    // New Year's Eve in Utah, already New Year's Day in UTC.
    const deadline = new Date("2027-01-01T03:00:00Z");
    expect(describeLinkDate(deadline, now, "America/Denver")).toBe("Thursday, December 31");
    expect(describeLinkDate(deadline, now, "UTC")).toBe("Friday, January 1, 2027");
  });
});

/** parseDuration turns what a staff member typed on /pulse/videos into seconds. Pure, no database. */
describe("parseDuration", () => {
  it("reads minutes and seconds, hours too, and plain seconds", () => {
    expect(parseDuration("4:12")).toBe(252);
    expect(parseDuration("0:30")).toBe(30);
    expect(parseDuration("1:04:12")).toBe(3852);
    expect(parseDuration("252")).toBe(252);
    expect(parseDuration("  1:50 ")).toBe(110);
  });

  it("is null for an empty box and undefined for text that is not a length", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
    expect(parseDuration("4:70")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("-5")).toBeUndefined();
    expect(parseDuration("4:1")).toBeUndefined();
  });

  it("round-trips what formatDuration shows", () => {
    for (const seconds of [0, 59, 60, 110, 404, 3600]) {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }
  });
});
