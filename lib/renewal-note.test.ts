import { describe, expect, it } from "vitest";
import { linkNoteName, readOldRenewalNote, scrubbedRenewalNote } from "./renewal-note";

// Made-up codes and ids only.
const OLD = "Link k7m2xq9p4a (Total Knee Replacement) turned back on: renewal 1 of 3. It works until Friday, October 18.";

describe("the clinic log's name for a link", () => {
  it("names the video and the row id, or the video alone", () => {
    expect(linkNoteName("Total Knee Replacement", "ckshare123")).toBe("A link for Total Knee Replacement (link id ckshare123)");
    expect(linkNoteName("Total Knee Replacement", null)).toBe("A link for Total Knee Replacement");
  });
});

describe("old reactivation entries", () => {
  it("reads the code, the video and the rest", () => {
    expect(readOldRenewalNote(OLD)).toEqual({
      code: "k7m2xq9p4a",
      videoTitle: "Total Knee Replacement",
      rest: "renewal 1 of 3. It works until Friday, October 18.",
    });
  });

  it("reads six- and sixteen-character codes, and a video name with brackets in it", () => {
    expect(readOldRenewalNote("Link abc123 (Knee (left)) turned back on: renewal 2 of 3.")).toEqual({
      code: "abc123",
      videoTitle: "Knee (left)",
      rest: "renewal 2 of 3.",
    });
    expect(readOldRenewalNote("Link abcdefgh12345678 (Hip) turned back on: renewal 1 of 1.")?.code).toBe("abcdefgh12345678");
  });

  it("leaves every other entry alone, today's words included", () => {
    expect(readOldRenewalNote("A link for Total Knee Replacement (link id ckshare123) turned back on: renewal 1 of 3.")).toBeNull();
    expect(readOldRenewalNote("Printed QR code made for Hip, from Dr. Jane Smith.")).toBeNull();
    expect(readOldRenewalNote("Link K7M2XQ (Knee) turned back on: renewal 1 of 3.")).toBeNull();
    expect(readOldRenewalNote("A staff note: Link k7m2xq (Knee) turned back on: renewal 1 of 3.")).toBeNull();
    expect(readOldRenewalNote("")).toBeNull();
  });

  it("rewrites one with the row id, or without it, keeping everything after 'turned back on:' and dropping the code", () => {
    const old = readOldRenewalNote(OLD)!;
    const withId = scrubbedRenewalNote(old, "ckshare123");
    expect(withId).toBe("A link for Total Knee Replacement (link id ckshare123) turned back on: renewal 1 of 3. It works until Friday, October 18.");
    expect(withId).not.toContain("k7m2xq9p4a");
    const withoutId = scrubbedRenewalNote(old, null);
    expect(withoutId).toBe("A link for Total Knee Replacement turned back on: renewal 1 of 3. It works until Friday, October 18.");
    // A rewritten entry is never read as an old one again, so a second run changes nothing.
    expect(readOldRenewalNote(withId)).toBeNull();
    expect(readOldRenewalNote(withoutId)).toBeNull();
  });
});
