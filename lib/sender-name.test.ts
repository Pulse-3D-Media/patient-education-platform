import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_NAME, defaultSenderName, effectiveSenderName, parseDisplayName, sentByLine } from "./sender-name";

/** The name rules in lib/sender-name.ts, with plain values. No database, no Clerk. */

describe("defaultSenderName", () => {
  it("is 'Dr. First Last' from the two names", () => {
    expect(defaultSenderName("Jane", "Smith")).toBe("Dr. Jane Smith");
    expect(defaultSenderName("  Jane ", " Smith  ")).toBe("Dr. Jane Smith");
  });

  it("uses whichever name there is when one is missing", () => {
    expect(defaultSenderName("Jane", null)).toBe("Dr. Jane");
    expect(defaultSenderName(undefined, "Smith")).toBe("Dr. Smith");
  });

  it("is null when Clerk has no name at all, never an email or an empty 'Dr.'", () => {
    expect(defaultSenderName(null, null)).toBeNull();
    expect(defaultSenderName("", "   ")).toBeNull();
  });

  it("does not add a second 'Dr.'", () => {
    expect(defaultSenderName("Dr. Jane", "Smith")).toBe("Dr. Jane Smith");
    expect(defaultSenderName("dr", "Smith")).toBe("dr Smith");
    // A name that only starts with the letters is still a name.
    expect(defaultSenderName("Drew", "Barry")).toBe("Dr. Drew Barry");
  });

  it("is never longer than the limit", () => {
    expect(defaultSenderName("A".repeat(60), "B".repeat(60))!.length).toBe(MAX_DISPLAY_NAME);
  });
});

describe("parseDisplayName", () => {
  it("accepts a name with a title, tidied", () => {
    expect(parseDisplayName("  Jane   Smith,  PA-C ")).toEqual({ ok: true, name: "Jane Smith, PA-C" });
    expect(parseDisplayName("Dr. Seán O'Brien-Núñez (NP)")).toEqual({ ok: true, name: "Dr. Seán O'Brien-Núñez (NP)" });
    expect(parseDisplayName("Dr. Nguyễn Văn An")).toEqual({ ok: true, name: "Dr. Nguyễn Văn An" });
  });

  it("treats an empty box as 'use the default'", () => {
    expect(parseDisplayName("")).toEqual({ ok: true, name: null });
    expect(parseDisplayName("   ")).toEqual({ ok: true, name: null });
    expect(parseDisplayName(null)).toEqual({ ok: true, name: null });
    expect(parseDisplayName(undefined)).toEqual({ ok: true, name: null });
  });

  it("turns line breaks and control characters into single spaces", () => {
    expect(parseDisplayName("Jane\n\tSmith\u0007")).toEqual({ ok: true, name: "Jane Smith" });
  });

  it("refuses markup, links, symbols and digits, with a plain sentence", () => {
    for (const bad of ["<b>Jane</b>", "Jane Smith https://example.com", "Jane & Co", "Dr. 123", "@jane", "-Jane"]) {
      const result = parseDisplayName(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/letters/);
    }
  });

  it("refuses a name over the limit, and accepts one at it", () => {
    expect(parseDisplayName("A".repeat(MAX_DISPLAY_NAME))).toEqual({ ok: true, name: "A".repeat(MAX_DISPLAY_NAME) });
    expect(parseDisplayName("A".repeat(MAX_DISPLAY_NAME + 1))).toMatchObject({ ok: false, message: expect.stringContaining(`${MAX_DISPLAY_NAME}`) });
  });

  it("refuses something that is not text", () => {
    expect(parseDisplayName(42)).toMatchObject({ ok: false });
    expect(parseDisplayName({ name: "Jane" })).toMatchObject({ ok: false });
  });
});

describe("effectiveSenderName and sentByLine", () => {
  it("prefers the typed name, then the default, then nothing", () => {
    expect(effectiveSenderName("Jane Smith, PA-C", "Dr. Jane Smith")).toBe("Jane Smith, PA-C");
    expect(effectiveSenderName(null, "Dr. Jane Smith")).toBe("Dr. Jane Smith");
    expect(effectiveSenderName("", "Dr. Jane Smith")).toBe("Dr. Jane Smith");
    expect(effectiveSenderName(null, null)).toBeNull();
  });

  it("says who sent it, or only the clinic for a link with no name", () => {
    expect(sentByLine("Dr. Jane Smith", "Summit Orthopedics")).toBe("Sent by Dr. Jane Smith, Summit Orthopedics");
    expect(sentByLine(null, "Summit Orthopedics")).toBe("From Summit Orthopedics");
    expect(sentByLine("", "Summit Orthopedics")).toBe("From Summit Orthopedics");
  });
});
