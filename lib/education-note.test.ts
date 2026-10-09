import { describe, expect, it } from "vitest";
import { DISCLAIMER, EDUCATION_ONLY, isDisclaimerVersionShape, judgeAcceptedVersion } from "./education-note";

/**
 * The "for education only" words: the box's wording and its version kept
 * together, nothing that claims more than the product does, and what the
 * routes make of the version a page sends.
 */

describe("the words", () => {
  it("never mention consent, in the box or under the video", () => {
    for (const words of [DISCLAIMER.text, EDUCATION_ONLY]) {
      expect(words.toLowerCase()).not.toContain("consent");
    }
  });

  it("are the approved wording, with a version shaped as a date", () => {
    expect(DISCLAIMER.text).toBe("I understand this video is for education only. It is not medical advice, and I will ask my doctor about anything I am unsure of.");
    expect(isDisclaimerVersionShape(DISCLAIMER.version)).toBe(true);
  });
});

describe("judgeAcceptedVersion", () => {
  it("knows the current version, a stale one, and junk", () => {
    expect(judgeAcceptedVersion(DISCLAIMER.version)).toBe("current");
    expect(judgeAcceptedVersion("2020-01-01")).toBe("stale");
    for (const junk of [undefined, null, "", "yes", 20261008, "2026-10-8", "2026-10-08 ", ["2026-10-08"]]) {
      expect(judgeAcceptedVersion(junk)).toBe("malformed");
    }
  });
});
