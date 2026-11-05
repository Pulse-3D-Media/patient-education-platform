import { describe, expect, it } from "vitest";
import { isAcceptedShareCode, isShareCodeShape, SHARE_CODE_LENGTH } from "./share-link";

/**
 * Which codes a patient link may be opened with. Plain values, no database.
 * The database lookups that ask this are tested in lib/db/shares.test.ts.
 */
describe("isAcceptedShareCode", () => {
  it("accepts today's ten-character codes and a printed code's sixteen-character links", () => {
    expect(SHARE_CODE_LENGTH).toBe(10);
    expect(isAcceptedShareCode("k7m2xq4v9p")).toBe(true);
    expect(isAcceptedShareCode("a1b2c3d4e5f6a7b8")).toBe(true);
    expect(isAcceptedShareCode("a".repeat(20))).toBe(true);
  });

  it("refuses a code shorter than ten characters, the old six-character ones included", () => {
    expect(isAcceptedShareCode("k7m2xq")).toBe(false);
    expect(isAcceptedShareCode("k7m2xq4v9")).toBe(false);
    expect(isAcceptedShareCode("a")).toBe(false);
    expect(isAcceptedShareCode("")).toBe(false);
  });

  it("refuses anything that is not a code's shape at all", () => {
    for (const junk of ["a".repeat(21), "k7m2xq4v9p!", "k7m2xq 4v9p", "k7m2xq/4v9p", null, undefined, 1234567890, {}]) {
      expect(isAcceptedShareCode(junk)).toBe(false);
    }
  });

  it("leaves the plain shape check as it was: short codes are still a code's shape, so the routes answer them like an unknown link, not with a 400", () => {
    expect(isShareCodeShape("k7m2xq")).toBe(true);
    expect(isAcceptedShareCode("k7m2xq")).toBe(false);
  });
});
