import { describe, expect, it } from "vitest";
import {
  CLINIC_NAME_HIDDEN,
  CLINIC_NAME_MAX,
  checkLogoBytes,
  checkLogoSize,
  LOGO_MAX_BYTES,
  LOGO_MISSING,
  LOGO_TOO_LARGE,
  LOGO_WRONG_KIND,
  nameFromClerk,
  readClinicName,
  sniffLogoKind,
} from "./clinic-identity";

/**
 * The rules for the clinic's name and logo on /admin/branding, with plain
 * values. The same functions run in the browser before a form is sent and
 * on the server when it arrives.
 */

/** The first bytes of each kind of picture, followed by some filler. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

const text = (words: string) => new TextEncoder().encode(words);

describe("what kind of picture a file is, by its bytes", () => {
  it("knows a PNG, a JPG and a WebP", () => {
    expect(sniffLogoKind(PNG)).toBe("png");
    expect(sniffLogoKind(JPG)).toBe("jpeg");
    expect(sniffLogoKind(WEBP)).toBe("webp");
  });

  it("refuses everything else, whatever the file is called", () => {
    expect(sniffLogoKind(text("just some words, saved as logo.png"))).toBeNull();
    expect(sniffLogoKind(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffLogoKind(text("GIF89a......"))).toBeNull();
    expect(sniffLogoKind(text("%PDF-1.7"))).toBeNull();
    // A RIFF file that is not WebP (a WAV sound).
    expect(sniffLogoKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    // Too short to be anything.
    expect(sniffLogoKind(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffLogoKind(new Uint8Array())).toBeNull();
  });
});

describe("a logo's size", () => {
  it("takes anything from one byte to the limit, and refuses nothing or more", () => {
    expect(checkLogoSize(1)).toBeNull();
    expect(checkLogoSize(LOGO_MAX_BYTES)).toBeNull();
    expect(checkLogoSize(LOGO_MAX_BYTES + 1)).toBe(LOGO_TOO_LARGE);
    expect(checkLogoSize(0)).toBe(LOGO_MISSING);
    expect(checkLogoSize(Number.NaN)).toBe(LOGO_MISSING);
  });

  it("keeps the limit under what a Server Action may receive (1 MiB), leaving room for the rest of the form", () => {
    expect(LOGO_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024 - 40_000);
  });
});

describe("a logo's bytes, checked whole", () => {
  it("says which kind a good picture is", () => {
    expect(checkLogoBytes(PNG)).toEqual({ kind: "png" });
    expect(checkLogoBytes(WEBP)).toEqual({ kind: "webp" });
  });

  it("refuses the wrong kind, an empty file and a file too big, in plain words", () => {
    expect(checkLogoBytes(text("hello"))).toEqual({ error: LOGO_WRONG_KIND });
    expect(checkLogoBytes(new Uint8Array())).toEqual({ error: LOGO_MISSING });
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(PNG);
    expect(checkLogoBytes(big)).toEqual({ error: LOGO_TOO_LARGE });
    expect(LOGO_TOO_LARGE).toContain("1 MB");
  });
});

describe("a clinic name", () => {
  it("is tidied: the ends trimmed and runs of spaces made one", () => {
    expect(readClinicName("  Wasatch   Orthopedics  ")).toEqual({ name: "Wasatch Orthopedics" });
  });

  it("takes exactly the longest name allowed and refuses one character more", () => {
    expect(readClinicName("a".repeat(CLINIC_NAME_MAX))).toEqual({ name: "a".repeat(CLINIC_NAME_MAX) });
    expect(readClinicName("a".repeat(CLINIC_NAME_MAX + 1))).toMatchObject({ error: expect.stringContaining(`${CLINIC_NAME_MAX} characters`) });
  });

  it("refuses an empty name and one with a line break or a tab", () => {
    expect(readClinicName("   ")).toEqual({ error: "The clinic needs a name." });
    expect(readClinicName("Wasatch\nOrthopedics")).toEqual({ error: "Keep the clinic name on one line." });
    expect(readClinicName("Wasatch\tOrthopedics")).toEqual({ error: "Keep the clinic name on one line." });
  });
});

describe("hidden characters in a clinic name", () => {
  // Zero-width characters, and the marks and overrides that change the
  // direction text is drawn in. Written as escapes so the test reads plainly.
  const HIDDEN = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u00ad", "\u200e", "\u200f", "\u061c", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"];

  it.each(HIDDEN)("refuses a name with %j in it", (hidden) => {
    expect(readClinicName(`Wasatch${hidden} Orthopedics`)).toEqual({ error: CLINIC_NAME_HIDDEN });
    expect(readClinicName(`${hidden}Wasatch Orthopedics`)).toEqual({ error: CLINIC_NAME_HIDDEN });
  });

  it("refuses a name made only of hidden characters, and one with spaces around them", () => {
    expect(readClinicName("\u200b\u200b")).toEqual({ error: CLINIC_NAME_HIDDEN });
    expect(readClinicName(" \u202e \u2066 ")).toEqual({ error: CLINIC_NAME_HIDDEN });
  });

  it("refuses the wider control characters too", () => {
    expect(readClinicName("Wasatch\u0085Orthopedics")).toEqual({ error: "Keep the clinic name on one line." });
  });

  it("still takes a name in another alphabet, an accent, an ampersand or a full-width letter", () => {
    expect(readClinicName("Clínica Ortopédica")).toEqual({ name: "Clínica Ortopédica" });
    expect(readClinicName("مركز العظام")).toEqual({ name: "مركز العظام" });
    expect(readClinicName("Foot & Ankle Center")).toEqual({ name: "Foot & Ankle Center" });
  });
});

describe("the name kept from Clerk's copy", () => {
  it("keeps an ordinary name exactly", () => {
    expect(nameFromClerk("Wasatch Orthopedics")).toBe("Wasatch Orthopedics");
  });

  it("cleans instead of refusing, so a clinic keeps a name", () => {
    expect(nameFromClerk("  Wasatch\nOrthopedics\t ")).toBe("Wasatch Orthopedics");
    expect(nameFromClerk("Wasatch\u200b Ortho\u202epedics")).toBe("Wasatch Orthopedics");
    expect(nameFromClerk("\n=HYPERLINK(1)")).toBe("=HYPERLINK(1)");
    expect(nameFromClerk("Wasatch    Orthopedics")).toBe("Wasatch Orthopedics");
  });

  it("cuts a long name to the limit, never in the middle of a character", () => {
    expect(nameFromClerk("a".repeat(CLINIC_NAME_MAX + 20))).toBe("a".repeat(CLINIC_NAME_MAX));
    const emoji = "a".repeat(CLINIC_NAME_MAX - 1) + "\u{1F9B4}";
    expect(nameFromClerk(emoji)).toBe("a".repeat(CLINIC_NAME_MAX - 1));
  });

  it("says null when nothing usable is left", () => {
    expect(nameFromClerk("")).toBeNull();
    expect(nameFromClerk("   ")).toBeNull();
    expect(nameFromClerk("\u200b\u202e\n")).toBeNull();
  });

  it("always gives a name the admin's rename would accept", () => {
    for (const raw of ["\u0000x", "x\u007fy", "\u2066a\u2069", " a ".repeat(80), "a\u00ad".repeat(60)]) {
      const name = nameFromClerk(raw);
      if (name !== null) expect(readClinicName(name)).toEqual({ name });
    }
  });
});
