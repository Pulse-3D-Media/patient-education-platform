import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./format";

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
