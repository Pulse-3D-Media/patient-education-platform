import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_FONTS,
  BRAND_THEMES,
  DEFAULT_BRAND_FONT,
  DEFAULT_BRAND_THEME,
  PATIENT_GROUND,
  PULSE_PATIENT_THEME,
  PULSE_STAFF_LIGHT_THEME,
  PULSE_STAFF_THEME,
  STAFF_GROUND,
  STAFF_LIGHT_GROUND,
  brandFontLabel,
  brandThemeLabel,
  contrastRatio,
  darkGroundVars,
  parseBrandColor,
  parseBrandFont,
  parseBrandTheme,
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

/**
 * The colour tokens one block of app/globals.css defines, by name. The light
 * mode tests read the stylesheet itself, so the colours that are measured
 * are the colours that ship: change a value there and these tests say
 * whether something stopped being readable.
 */
function tokensIn(selector: string): Record<string, string> {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF line ends
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No "${selector} {" block in app/globals.css`);
  const block = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/(--ui-[a-z-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}
const lightTokens = () => tokensIn('[data-theme="light"]');
const darkTokens = () => tokensIn(':root,\n[data-theme="dark"]');

/** "#rrggbb" laid over "#rrggbb" at `amount` (0 to 1): what a see-through tint ends up as. */
function blend(top: string, under: string, amount: number): string {
  const part = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(part(top, i) * amount + part(under, i) * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

/** The same for a token written as rgba(r, g, b, a). */
function over(rgba: string, under: string): string {
  const parts = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!parts) throw new Error(`Not an rgba() colour: ${rgba}`);
  const top = `#${[1, 2, 3].map((i) => Number(parts[i]).toString(16).padStart(2, "0")).join("")}`;
  return blend(top, under, Number(parts[4]));
}

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

describe("the LIGHT staff screens, for every colour a clinic could pick", () => {
  // The light surfaces an accent can sit on, read from the stylesheet so this cannot drift from what ships.
  const light = lightTokens();
  const surfaces = [light["--ui-ground"], light["--ui-surface"], light["--ui-sunken"], light["--ui-overlay"], light["--ui-field"]];

  it("uses the darkest light surface as the ground the accent is worked out against", () => {
    expect(STAFF_LIGHT_GROUND).toBe(light["--ui-sunken"]);
    for (const surface of surfaces) expect(relativeLuminance(surface), surface).toBeGreaterThanOrEqual(relativeLuminance(STAFF_LIGHT_GROUND));
  });

  it("keeps buttons visible, their text readable, and the link shade readable as text, on every light surface", () => {
    for (const colour of [...everyColour(), null]) {
      const theme = staffTheme(colour, "light");
      for (const surface of surfaces) {
        expect(contrastRatio(theme.accent, surface), `${colour} accent on ${surface}`).toBeGreaterThanOrEqual(3);
        // The shade used for links, the active tab's line and focus rings: a DARK shade on light.
        expect(contrastRatio(theme.accentBright, surface), `${colour} link shade on ${surface}`).toBeGreaterThanOrEqual(7);
        // The same shade on the tint behind an active menu row or an "admin" badge (the accent at 20% over the surface).
        expect(contrastRatio(theme.accentBright, blend(theme.accent, surface, 0.2)), `${colour} link shade on its own tint`).toBeGreaterThanOrEqual(4.5);
        // The page's own ink on that same tint (the active row's words, the selected radio card).
        expect(contrastRatio(light["--ui-ink"], blend(theme.accent, surface, 0.2)), `${colour} ink on the tint`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(theme.onAccent, theme.accent), `${colour} text on accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.onAccent, theme.accentHover), `${colour} text on hover`).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(theme.accentBright), `${colour} link shade is dark, not pale`).toBeLessThan(0.2);
      expect(["#ffffff", "#000000"]).toContain(theme.onAccent);
    }
  });

  it("darkens a colour too pale to see on a light screen, and leaves one that works alone", () => {
    expect(staffTheme("#ffe9a8", "light").accent).not.toBe("#ffe9a8");
    expect(staffTheme("#7a1f2b", "light").accent).toBe("#7a1f2b");
  });

  it("gives the same colour different shades in the two modes, and dark when no mode is given", () => {
    expect(staffTheme("#0a1433", "light").accent).toBe("#0a1433"); // navy is fine on light
    expect(staffTheme("#0a1433", "dark").accent).not.toBe("#0a1433"); // and invisible on black
    expect(staffTheme("#0a1433")).toEqual(staffTheme("#0a1433", "dark"));
    expect(staffTheme(null, "light")).toEqual(PULSE_STAFF_LIGHT_THEME);
    expect(staffTheme(null)).toEqual(PULSE_STAFF_THEME);
  });

  it("keeps the dark-ground shades beside them, for the video player, which is black in both modes", () => {
    for (const colour of [...everyColour(), null]) {
      const vars = darkGroundVars(colour);
      expect(contrastRatio(vars["--brand-dark-accent-bright"], "#000000"), `${colour} scrub bar on black`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(vars["--brand-dark-accent"], "#000000")).toBeGreaterThanOrEqual(3);
      for (const value of Object.values(vars)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(darkGroundVars(null)).toEqual({
      "--brand-dark-accent": "#2a829b",
      "--brand-dark-accent-hover": "#1e5668",
      "--brand-dark-accent-bright": "#5fb8d4",
      "--brand-dark-on-accent": "#ffffff",
    });
  });
});

describe("the light mode colours in app/globals.css", () => {
  const light = lightTokens();
  const grounds = ["--ui-ground", "--ui-surface", "--ui-sunken", "--ui-overlay", "--ui-field"].map((name) => light[name]);
  // A hovered row, a quiet chip: the wash colours laid over each ground.
  const washed = grounds.flatMap((ground) => [ground, over(light["--ui-wash"], ground), over(light["--ui-wash-strong"], ground)]);

  it("has a light value for every token the dark block defines", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(darkTokens()).sort());
  });

  it("keeps every kind of text readable (4.5:1) on every light surface, plain or under a hover wash", () => {
    for (const name of ["--ui-ink", "--ui-ink-soft", "--ui-ink-muted", "--ui-ink-quiet", "--ui-warn", "--ui-warn-bright", "--ui-problem", "--ui-danger"]) {
      for (const ground of washed) expect(contrastRatio(light[name], ground), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps amber text readable on its own amber chip and box (the accent at 20% over 10%)", () => {
    for (const ground of grounds) {
      const box = blend(light["--ui-warn"], ground, 0.1);
      const chip = blend(light["--ui-warn"], box, 0.2);
      expect(contrastRatio(light["--ui-warn"], chip), `amber on its chip over ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light["--ui-ink"], box)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light["--ui-ink-soft"], box)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the edge of a button or a text box visible (3:1) on every light surface", () => {
    for (const name of ["--ui-line-strong", "--ui-line-hover", "--ui-danger-line"]) {
      for (const ground of washed) expect(contrastRatio(light[name], ground), `${name} on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the dimmed library tile's words readable on its pale veil", () => {
    // Worst case behind the words: a black picture at 25% over the white tile, under the veil at its thinnest there (40%).
    const picture = blend("#000000", light["--ui-surface"], 0.25);
    const behind = blend(light["--ui-veil"], picture, 0.4);
    expect(contrastRatio(light["--ui-ink-soft"], behind)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light["--ui-ink-quiet"], behind)).toBeGreaterThanOrEqual(4.5);
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

describe("parseBrandTheme", () => {
  it("accepts the two modes, however they are typed", () => {
    expect(parseBrandTheme("light")).toBe("light");
    expect(parseBrandTheme(" Dark ")).toBe("dark");
  });

  it("refuses anything else, so nothing but a known word reaches the data-theme attribute", () => {
    for (const bad of ["", "sepia", "auto", "system", "light dark", 'light" onload="x', null, undefined, 1, true]) {
      expect(parseBrandTheme(bad), String(bad)).toBeNull();
    }
  });

  it("names them for the form and the clinic log, and dark is the default", () => {
    expect(BRAND_THEMES.map((theme) => theme.key)).toEqual(["dark", "light"]);
    expect(brandThemeLabel("light")).toBe("Light");
    expect(DEFAULT_BRAND_THEME).toBe("dark");
  });
});

describe("readBranding", () => {
  it("passes good stored values through", () => {
    expect(readBranding({ brandColor: "#7A1F2B", brandFont: "merriweather", brandTheme: "light" })).toEqual({ color: "#7a1f2b", font: "merriweather", theme: "light" });
    expect(readBranding({ brandColor: "#7A1F2B", brandFont: "merriweather" })).toEqual({ color: "#7a1f2b", font: "merriweather", theme: "dark" });
  });

  it("falls back to the Pulse look for empty values, junk, and a font no longer on the list", () => {
    expect(readBranding({ brandColor: null, brandFont: null, brandTheme: null })).toEqual({ color: null, font: "inter", theme: "dark" });
    expect(readBranding({ brandColor: "blue", brandFont: "papyrus", brandTheme: "sepia" })).toEqual({ color: null, font: "inter", theme: "dark" });
    expect(readBranding(null)).toEqual({ color: null, font: "inter", theme: "dark" });
    expect(readBranding({})).toEqual({ color: null, font: "inter", theme: "dark" });
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
