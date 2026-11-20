import { describe, expect, it } from "vitest";
import { formatUsPhone, normalizeUsPhone, telHref } from "./phone";

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

describe("telHref", () => {
  it("turns ten stored digits into a tap-to-call address with the US country code", () => {
    expect(telHref("8015550123")).toBe("tel:+18015550123");
  });

  it("gives no link for no phone or anything that is not exactly ten digits", () => {
    for (const stored of [null, undefined, "", "555-0123", "(801) 555-0123", "80155501234", "8015550123; ext"]) {
      expect(telHref(stored)).toBeNull();
    }
  });
});

describe("typedUsPhone and typedPhoneProblem: the phone box as someone types (Evan, 2026-11-19)", () => {
  it("takes ten digits and no more, shown as they arrive", async () => {
    const { typedUsPhone } = await import("./phone");
    expect(typedUsPhone("8")).toBe("(8");
    expect(typedUsPhone("8015")).toBe("(801) 5");
    expect(typedUsPhone("8015550123")).toBe("(801) 555-0123");
    // What Evan typed: an eleventh digit and more are simply not taken.
    expect(typedUsPhone("80184454545 124")).toBe("(801) 844-5454");
  });

  it("handles spaces, dashes, brackets, dots and a leading +1 or 1, typed or pasted", async () => {
    const { typedUsPhone } = await import("./phone");
    for (const typed of ["+1 801 555 0123", "1-801-555-0123", "(801) 555-0123", "801.555.0123", "  801 555 0123  "]) expect(typedUsPhone(typed), typed).toBe("(801) 555-0123");
    expect(typedUsPhone("")).toBe("");
    expect(typedUsPhone("abc")).toBe("");
  });

  it("says what is wrong before Enter, and nothing for an empty or complete box", async () => {
    const { typedPhoneProblem } = await import("./phone");
    expect(typedPhoneProblem("(801) 55")).toBe("That is 5 of the 10 digits. Enter the whole number, like (801) 555-0123.");
    expect(typedPhoneProblem("")).toBeNull();
    expect(typedPhoneProblem("(801) 555-0123")).toBeNull();
  });
});
