import { describe, expect, it } from "vitest";
import { formatUsPhone, normalizeUsPhone } from "./phone";

/** Phone numbers in, digits out, and back again. Pure, no database. */
describe("normalizeUsPhone", () => {
  it("accepts the usual US formats and keeps ten digits", () => {
    for (const typed of ["8015550123", "801-555-0123", "(801) 555-0123", "801.555.0123", "+1 801 555 0123", "1-801-555-0123"]) {
      expect(normalizeUsPhone(typed)).toBe("8015550123");
    }
  });

  it("returns null for anything that is not a ten-digit US number", () => {
    for (const typed of ["", "555-0123", "80155501234", "call the office", "+44 20 7946 0958"]) {
      expect(normalizeUsPhone(typed)).toBeNull();
    }
  });
});

describe("formatUsPhone", () => {
  it("shows stored digits as (801) 555-0123", () => {
    expect(formatUsPhone("8015550123")).toBe("(801) 555-0123");
  });

  it("shows nothing for no phone, and leaves anything unexpected as it is", () => {
    expect(formatUsPhone(null)).toBe("");
    expect(formatUsPhone("")).toBe("");
    expect(formatUsPhone("12345")).toBe("12345");
  });
});
