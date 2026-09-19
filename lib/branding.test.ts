import { describe, expect, it } from "vitest";
import {
  BRAND_FONTS,
  DEFAULT_BRAND_FONT,
  PATIENT_GROUND,
  PULSE_PATIENT_THEME,
  PULSE_STAFF_THEME,
  STAFF_GROUND,
  brandFontLabel,
  contrastRatio,
  parseBrandColor,
  parseBrandFont,
  parseLogoUrl,
  patientTheme,
  readBranding,
  relativeLuminance,
  staffTheme,
  themeVars,
} from "./branding";

/**
 * The branding rules, with plain values and no database.
 *
 * The part that matters most is the sweep: whatever colour a clinic picks,
 * the screens made from it have to stay readable. So every theme is worked
 * out for a grid of colours covering the whole colour cube (black, white,
 * pale yellow, navy, everything between) and the contrast promises are
 * checked for each one.
 */

/** Every colour on a 6 x 6 x 6 grid across the cube, 216 in all, from black to white. */
function everyColour(): string[] {
  const steps = [0, 51, 102, 153, 204, 255];
  const colours: string[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) {
    colours.push(`#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`);
  }
  return colours;
}

describe("parseBrandColor", () => {
  it("accepts six-digit hex with or without the hash, in any case, and stores it lowercase", () => {
    expect(parseBrandColor("#2A829B")).toBe("#2a829b");
    expect(parseBrandColor("2a829b")).toBe("#2a829b");
    expect(parseBrandColor("  #2a829b  ")).toBe("#2a829b");
  });

  it("expands three-digit hex", () => {
    expect(parseBrandColor("#28b")).toBe("#2288bb");
  });

  it("refuses everything that is not plain hex, so nothing but a colour can reach a style attribute", () => {
    for (const bad of ["", "teal", "rgb(1,2,3)", "#2a829", "#2a829b80", "#gggggg", "red; background:url(x)", "var(--x)", null, undefined, 42, {}]) {
      expect(parseBrandColor(bad)).toBeNull();
    }
  });
});

describe("parseBrandFont", () => {
  it("accepts exactly the keys on the list", () => {
    for (const font of BRAND_FONTS) expect(parseBrandFont(font.key)).toBe(font.key);
    expect(parseBrandFont(" Open-Sans ")).toBe("open-sans");
  });

  it("refuses a font that is not on the list", () => {
    for (const bad of ["", "comic-sans", "Open Sans", "inter; color:red", null, undefined, 7]) {
      expect(parseBrandFont(bad)).toBeNull();
    }
  });

  it("has Inter as the default, and a label for every key", () => {
    expect(DEFAULT_BRAND_FONT).toBe("inter");
    expect(brandFontLabel("source-sans")).toBe("Source Sans");
  });
});

describe("contrast sums", () => {
  it("gives the standard answers", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#2a829b", "#2a829b")).toBe(1);
    // Order does not matter.
    expect(contrastRatio("#ffffff", "#1e5668")).toBe(contrastRatio("#1e5668", "#ffffff"));
  });
});

describe("a clinic with no colour set", () => {
  it("gets the Pulse colours exactly as they were, not a computed version of them", () => {
    expect(staffTheme(null)).toEqual(PULSE_STAFF_THEME);
    expect(staffTheme(null)).toEqual({ accent: "#2a829b", accentHover: "#1e5668", accentBright: "#5fb8d4", onAccent: "#ffffff" });
    expect(patientTheme(null)).toEqual(PULSE_PATIENT_THEME);
  });

  it("gets them for a stored value that is not a colour, too", () => {
    expect(staffTheme("not a colour")).toEqual(PULSE_STAFF_THEME);
    expect(patientTheme("url(javascript:1)")).toEqual(PULSE_PATIENT_THEME);
  });
});

describe("the staff screens, for every colour a clinic could pick", () => {
  it("keeps buttons visible, their text readable, and the bright shade readable as text", () => {
    for (const colour of everyColour()) {
      const theme = staffTheme(colour);
      // A filled button stands out from the dark ground (and so from black, which is darker still).
      expect(contrastRatio(theme.accent, STAFF_GROUND), `${colour} accent on the ground`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.accent, "#000000"), `${colour} accent on black`).toBeGreaterThanOrEqual(3);
      // The words on a button read, at rest and while hovered.
      expect(contrastRatio(theme.onAccent, theme.accent), `${colour} text on accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.onAccent, theme.accentHover), `${colour} text on hover`).toBeGreaterThanOrEqual(4.5);
      // The shade used as text on the dark ground.
      expect(contrastRatio(theme.accentBright, STAFF_GROUND), `${colour} bright on the ground`).toBeGreaterThanOrEqual(7);
      expect(["#ffffff", "#000000"]).toContain(theme.onAccent);
    }
  });

  it("leaves a colour that already works alone", () => {
    // A mid blue that clears 3:1 on the dark ground is used as picked.
    expect(staffTheme("#3b82f6").accent).toBe("#3b82f6");
  });

  it("lightens a colour too dark to see on the dark screens, such as navy or black", () => {
    expect(staffTheme("#0a1f44").accent).not.toBe("#0a1f44");
    expect(contrastRatio(staffTheme("#000000").accent, STAFF_GROUND)).toBeGreaterThanOrEqual(3);
  });

  it("puts black text on a light colour and white on a dark one", () => {
    expect(staffTheme("#ffe27a").onAccent).toBe("#000000");
    expect(staffTheme("#7a1f2b").onAccent).toBe("#ffffff");
  });
});

describe("the patient page, for every colour a clinic could pick", () => {
  it("keeps the band and the call button visible on the light page, and the words on them readable", () => {
    for (const colour of everyColour()) {
      const theme = patientTheme(colour);
      expect(contrastRatio(theme.accent, PATIENT_GROUND), `${colour} accent on the page`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.onAccent, theme.accent), `${colour} text on accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens a colour too pale to see on the light page, such as white or pale yellow", () => {
    expect(patientTheme("#ffffff").accent).not.toBe("#ffffff");
    expect(patientTheme("#fff3a0").accent).not.toBe("#fff3a0");
  });

  it("leaves a colour that already works alone", () => {
    expect(patientTheme("#7a1f2b").accent).toBe("#7a1f2b");
  });
});

describe("themeVars", () => {
  it("names the four staff values and the two patient values", () => {
    expect(themeVars(PULSE_STAFF_THEME)).toEqual({
      "--brand-accent": "#2a829b",
      "--brand-on-accent": "#ffffff",
      "--brand-accent-hover": "#1e5668",
      "--brand-accent-bright": "#5fb8d4",
    });
    expect(Object.keys(themeVars(PULSE_PATIENT_THEME)).sort()).toEqual(["--brand-accent", "--brand-on-accent"]);
  });

  it("only ever holds plain hex, whatever went in", () => {
    for (const colour of [...everyColour(), "junk", "#fff; x"]) {
      for (const value of Object.values(themeVars(staffTheme(colour)))) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("readBranding", () => {
  it("passes good stored values through", () => {
    expect(readBranding({ brandColor: "#7A1F2B", brandFont: "merriweather" })).toEqual({ color: "#7a1f2b", font: "merriweather" });
  });

  it("falls back to the Pulse look for empty values, junk, and a font no longer on the list", () => {
    expect(readBranding({ brandColor: null, brandFont: null })).toEqual({ color: null, font: "inter" });
    expect(readBranding({ brandColor: "blue", brandFont: "papyrus" })).toEqual({ color: null, font: "inter" });
    expect(readBranding(null)).toEqual({ color: null, font: "inter" });
    expect(readBranding({})).toEqual({ color: null, font: "inter" });
  });
});

describe("parseLogoUrl", () => {
  it("accepts a full https address, from any host", () => {
    expect(parseLogoUrl("https://img.clerk.com/abc123")).toBe("https://img.clerk.com/abc123");
    expect(parseLogoUrl("  https://cdn.example.org/logos/summit.png?v=2  ")).toBe("https://cdn.example.org/logos/summit.png?v=2");
  });

  it("refuses anything a browser would warn about or that is not a web address", () => {
    for (const bad of [
      "",
      "http://example.com/logo.png",
      "example.com/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:secret@example.com/logo.png",
      "https://",
      `https://example.com/${"a".repeat(2100)}`,
      null,
      undefined,
    ]) {
      expect(parseLogoUrl(bad), String(bad).slice(0, 40)).toBeNull();
    }
  });
});
