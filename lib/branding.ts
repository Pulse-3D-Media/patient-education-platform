/**
 * A clinic's own look: one brand colour and one font from a short list.
 *
 * Pure: no database, no Clerk, no React. Safe for the browser, so the
 * branding form's live preview and the server's check of what was typed
 * use the very same functions. The server always checks again (rule 8);
 * the preview is a courtesy.
 *
 * A clinic picks ONE colour. Everything else is worked out from it here,
 * because a clinic must not be able to make its own screens, or a
 * patient's, hard to read:
 *
 *   - the staff screens (/library, /admin) are near-black by default, so the
 *     colour is lightened until a button made of it stands out from the
 *     ground, and lightened further for the shade used as text. A clinic
 *     that has chosen LIGHT staff screens gets the opposite: the colour is
 *     darkened until it stands out from the light ground, and darkened
 *     further for the shade used as text;
 *   - the patient page is light, so the colour is darkened until it stands
 *     out there;
 *   - the text that sits ON the colour is white or black, whichever reads.
 *
 * The contrast numbers are WCAG's: 4.5:1 for text, 3:1 for the edge of a
 * button or a band. The sums are the standard ones (relative luminance).
 *
 * A clinic with no colour set gets the Pulse 3D colours exactly as they
 * were before branding existed, not a computed version of them, so nothing
 * changes for a clinic that never opens the Branding page.
 *
 * All three stored values (colour, font, light or dark) are checked when
 * they are read as well as when they are saved (readBranding), so a value
 * this file does not understand (a hand edit, a font later taken off the
 * list) falls back to the Pulse look, in dark, and never reaches a style
 * attribute.
 */

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * The fonts a clinic can choose from. All are free Google fonts that Next.js
 * downloads when the app is built and then serves from our own address, so
 * a patient's phone never contacts Google. The font files themselves are
 * declared in app/brand-fonts.ts, which must list exactly these keys.
 *
 * A short list on purpose: every one of these is comfortable to read at the
 * patient page's 20px body size. No script or display faces.
 */
export const BRAND_FONTS = [
  { key: "inter", label: "Inter", note: "The Pulse 3D default. Clean and neutral." },
  { key: "open-sans", label: "Open Sans", note: "Friendly and very widely used." },
  { key: "source-sans", label: "Source Sans", note: "Calm and clinical." },
  { key: "montserrat", label: "Montserrat", note: "Modern, a little wider." },
  { key: "nunito-sans", label: "Nunito Sans", note: "Soft, rounded edges." },
  { key: "merriweather", label: "Merriweather", note: "A serif, for a traditional practice." },
] as const;

export type BrandFontKey = (typeof BRAND_FONTS)[number]["key"];

/** The font a clinic has until it chooses another. */
export const DEFAULT_BRAND_FONT: BrandFontKey = "inter";

/** One of the listed font keys, or null when the value is anything else. */
export function parseBrandFont(input: unknown): BrandFontKey | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase();
  return BRAND_FONTS.find((font) => font.key === key)?.key ?? null;
}

/** "Open Sans" for "open-sans". For the clinic log and the forms. */
export function brandFontLabel(key: BrandFontKey): string {
  return BRAND_FONTS.find((font) => font.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Light or dark
// ---------------------------------------------------------------------------

/**
 * Whether a clinic's STAFF screens (/library and /admin) are dark or light.
 * The clinic's setting, chosen on its Branding page: not each person's, and
 * not the computer's own dark-mode setting. The patient page is light for
 * every clinic and /pulse is dark for Pulse staff; neither reads this.
 */
export const BRAND_THEMES = [
  { key: "dark", label: "Dark", note: "White words on black." },
  { key: "light", label: "Light", note: "Dark words on warm white." },
] as const;

export type BrandTheme = (typeof BRAND_THEMES)[number]["key"];

/** The mode a clinic has until it chooses the other. Stored as "nothing set". */
export const DEFAULT_BRAND_THEME: BrandTheme = "dark";

/** "dark" or "light", or null when the value is anything else. */
export function parseBrandTheme(input: unknown): BrandTheme | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase();
  return BRAND_THEMES.find((theme) => theme.key === key)?.key ?? null;
}

/** "Light" for "light". For the clinic log and the forms. */
export function brandThemeLabel(key: BrandTheme): string {
  return BRAND_THEMES.find((theme) => theme.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// The colour
// ---------------------------------------------------------------------------

/**
 * A colour typed in any of the usual ways ("#2A829B", "2a829b", "#28b") as
 * "#rrggbb" in lowercase, or null when it is not a colour. Only six-digit
 * (or three-digit) hex is accepted: no names, no rgb(), no transparency,
 * nothing that could carry anything but a colour into a style attribute.
 */
export function parseBrandColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/.test(text)) return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`;
  return null;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a "#rrggbb" colour: 0 is black, 1 is white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((part) => {
    const channel = part / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two "#rrggbb" colours, from 1 (the same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `amount` of the way from one colour to another: 0 is `from`, 1 is `to`. */
function mix(from: string, to: string, amount: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb);
}

const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * Move a colour toward white or black, a little at a time, until it stands
 * out from `ground` by at least `ratio`. Returned unchanged when it already
 * does. Always ends: white against a dark ground, and black against a light
 * one, clear every ratio asked for in this file.
 */
function standOut(color: string, ground: string, ratio: number, toward: string): string {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(color, toward, step / 50);
    if (contrastRatio(candidate, ground) >= ratio) return candidate;
  }
  return toward;
}

/**
 * The colour of text on top of a fill: white when white reads on it
 * (4.5:1), otherwise black. One of the two always clears 4.5:1, whatever
 * the fill.
 */
function textOn(fill: string): string {
  return contrastRatio(WHITE, fill) >= 4.5 ? WHITE : BLACK;
}

// ---------------------------------------------------------------------------
// The two themes
// ---------------------------------------------------------------------------

/** The lightest dark surface the accent sits on in the staff screens (a card). Black is darker, so clearing this clears black too. */
export const STAFF_GROUND = "#0d1113";

/**
 * The DARKEST light surface the accent sits on in a light-mode clinic's
 * staff screens (the icon rail, --ui-sunken in app/globals.css). The page and the white cards are lighter, so clearing
 * this clears them too. lib/branding.test.ts checks it still matches the
 * stylesheet.
 */
export const STAFF_LIGHT_GROUND = "#f4f1ea";

/** The patient page's warm light ground. */
export const PATIENT_GROUND = "#fbfaf7";

/** The colours of the staff screens (/library, /admin): near-black, or light when the clinic chose light. */
export type StaffTheme = {
  /** Filled buttons, the active pill, borders on hover. At least 3:1 against the ground. */
  accent: string;
  /** The same fill while it is hovered or pressed. */
  accentHover: string;
  /** The shade used as text and icons on the ground: a pale shade on dark, a DARK shade on light. At least 7:1 either way. */
  accentBright: string;
  /** Text on top of `accent` and `accentHover`. White or black, at least 4.5:1. */
  onAccent: string;
};

/** The colours the patient page takes from the clinic. The page's own text stays dark on light whatever the clinic picks. */
export type PatientTheme = {
  /** The band across the top and the call button. At least 3:1 against the page. */
  accent: string;
  /** Text on top of `accent`. White or black, at least 4.5:1. */
  onAccent: string;
};

/** The staff screens exactly as they were before branding. */
export const PULSE_STAFF_THEME: StaffTheme = {
  accent: "#2a829b",
  accentHover: "#1e5668",
  accentBright: "#5fb8d4",
  onAccent: WHITE,
};

/** The patient page's Pulse colours: the deep teal its focus ring already used. */
export const PULSE_PATIENT_THEME: PatientTheme = { accent: "#1e5668", onAccent: WHITE };

/**
 * The Pulse 3D look on LIGHT staff screens, for a clinic that chose light
 * and no colour of its own. The deep teal the patient page already uses:
 * white reads on it, and it reads as text on the light ground.
 */
export const PULSE_STAFF_LIGHT_THEME: StaffTheme = {
  accent: "#1e5668",
  accentHover: "#16414f",
  accentBright: "#1e5668",
  onAccent: WHITE,
};

/**
 * The staff screens' colours for one clinic. `color` is a checked "#rrggbb"
 * or null for the Pulse look. `mode` is the clinic's light-or-dark choice:
 * the same colour gives different shades in each, because what stands out
 * from black and what stands out from near-white are opposites.
 */
export function staffTheme(color: string | null, mode: BrandTheme = DEFAULT_BRAND_THEME): StaffTheme {
  const light = mode === "light";
  const checked = parseBrandColor(color);
  if (!checked) return light ? PULSE_STAFF_LIGHT_THEME : PULSE_STAFF_THEME;

  const ground = light ? STAFF_LIGHT_GROUND : STAFF_GROUND;
  const toward = light ? BLACK : WHITE; // lighten on dark, darken on light
  const accent = standOut(checked, ground, 3, toward);
  const onAccent = textOn(accent);
  return {
    accent,
    // Hover moves away from the text colour, so the text only gets easier to read.
    accentHover: mix(accent, onAccent === WHITE ? BLACK : WHITE, 0.25),
    accentBright: standOut(checked, ground, 7, toward),
    onAccent,
  };
}

/** The patient page's colours for one clinic. `color` is a checked "#rrggbb" or null for the Pulse look. */
export function patientTheme(color: string | null): PatientTheme {
  const checked = parseBrandColor(color);
  if (!checked) return PULSE_PATIENT_THEME;

  const accent = standOut(checked, PATIENT_GROUND, 3, BLACK);
  return { accent, onAccent: textOn(accent) };
}

/**
 * A theme as CSS custom properties, for a style attribute on the element
 * that wraps a clinic's screens. app/globals.css holds the Pulse values as
 * the defaults and maps these onto Tailwind's `brand` colours, so a screen
 * that sets nothing (/pulse, the sign-in page) keeps the Pulse look.
 */
export function themeVars(theme: StaffTheme | PatientTheme): Record<string, string> {
  const vars: Record<string, string> = {
    "--brand-accent": theme.accent,
    "--brand-on-accent": theme.onAccent,
  };
  if ("accentBright" in theme) {
    vars["--brand-accent-hover"] = theme.accentHover;
    vars["--brand-accent-bright"] = theme.accentBright;
  }
  return vars;
}

/**
 * The staff accent as it must be on a DARK ground, under the second set of
 * names app/globals.css keeps for that. The app shell sets these beside the
 * colours for the clinic's own mode, so the one part of a light clinic's
 * library that stays black (the video player, marked data-theme="dark")
 * gets shades that show up on black. In a dark clinic they equal the main
 * four.
 */
export function darkGroundVars(color: string | null): Record<string, string> {
  const theme = staffTheme(color, "dark");
  return {
    "--brand-dark-accent": theme.accent,
    "--brand-dark-accent-hover": theme.accentHover,
    "--brand-dark-accent-bright": theme.accentBright,
    "--brand-dark-on-accent": theme.onAccent,
  };
}

// ---------------------------------------------------------------------------
// Reading what is stored
// ---------------------------------------------------------------------------

/** A clinic's branding as the screens use it: a checked colour or null, a font that is on the list, and light or dark for its staff screens. */
export type Branding = { color: string | null; font: BrandFontKey; theme: BrandTheme };

/** Check the three stored values on the way out of the database. Anything not understood becomes the Pulse look, in dark. */
export function readBranding(stored: { brandColor?: string | null; brandFont?: string | null; brandTheme?: string | null } | null | undefined): Branding {
  return {
    color: parseBrandColor(stored?.brandColor ?? null),
    font: parseBrandFont(stored?.brandFont ?? null) ?? DEFAULT_BRAND_FONT,
    theme: parseBrandTheme(stored?.brandTheme ?? null) ?? DEFAULT_BRAND_THEME,
  };
}

// ---------------------------------------------------------------------------
// The logo address
// ---------------------------------------------------------------------------

/**
 * A logo address Pulse staff typed, checked: a full https:// address with a
 * host, no sign-in details in it, and not absurdly long. Returns the
 * address, or null when it is not one. An empty string is not an address;
 * callers treat empty as "no logo" before asking.
 *
 * The browser loads the logo straight from that address. Our server never
 * fetches it, so there is no list of allowed hosts to keep: a bad address
 * costs a missing picture (the clinic's name shows instead), never a
 * request made from inside our own network.
 */
export function parseLogoUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
