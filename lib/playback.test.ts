import { describe, expect, it } from "vitest";
import { SLOW_AFTER_MS, playRefusalIsFailure, resumePoint } from "./playback";

/** The players' small decisions, with plain values and no browser. */
describe("playRefusalIsFailure", () => {
  it("treats a video the browser cannot play as a failure", () => {
    expect(playRefusalIsFailure("NotSupportedError")).toBe(true);
  });

  it("treats every 'not yet' refusal as nothing to report, so the Play button simply stays", () => {
    for (const name of ["NotAllowedError", "AbortError", "SomethingNew", "", undefined, null]) {
      expect(playRefusalIsFailure(name)).toBe(false);
    }
  });
});

describe("resumePoint", () => {
  it("picks a video back up where it stopped", () => {
    expect(resumePoint(42.5)).toBe(42.5);
  });

  it("starts from the beginning when nothing, or next to nothing, had played", () => {
    for (const time of [0, 0.4, undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      expect(resumePoint(time)).toBe(0);
    }
  });
});

describe("SLOW_AFTER_MS", () => {
  it("waits long enough that an ordinary pause to buffer never shows the note", () => {
    expect(SLOW_AFTER_MS).toBeGreaterThanOrEqual(5000);
    expect(SLOW_AFTER_MS).toBeLessThanOrEqual(15000);
  });
});
