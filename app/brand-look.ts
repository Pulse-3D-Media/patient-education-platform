import type { CSSProperties } from "react";
import { BRAND_FONTS, darkGroundVars, parseLogoUrl, patientTheme, readBranding, staffTheme, themeVars, type BrandFontKey, type BrandTheme } from "@/lib/branding";
import { formatUsPhone, telHref } from "@/lib/phone";
import { brandFontClass } from "./brand-fonts";

/**
 * A clinic's stored branding, turned into what a screen actually uses: the
 * colours as CSS variables, the class that sets the font, a checked logo
 * address, and the phone as a tap-to-call link.
 *
 * Every stored value is checked on the way through (lib/branding.ts and
 * lib/phone.ts), here as well as when it was saved. So a value this app
 * does not understand (a hand edit, a font taken off the list later) gives
 * the Pulse look, no logo, or no call link. It never gives a broken page,
 * and nothing but a plain hex colour can reach a style attribute.
 *
 * Runs on the server, in the pages and layouts. The result is plain data,
 * so it can be handed to a client component such as AppShell.
 */

/** The stored values a look is made from. Any of them may be missing. */
type StoredBranding = {
  logoUrl?: string | null;
  phone?: string | null;
  brandColor?: string | null;
  brandFont?: string | null;
  brandTheme?: string | null;
};

export type Look = {
  /** The brand colours, as CSS variables for the element that wraps the clinic's screens. */
  style: CSSProperties;
  /** The class that sets the clinic's font on everything inside that element. Empty for Inter. */
  fontClass: string;
  /**
   * Light or dark, for the data-theme attribute on the element that wraps the
   * clinic's staff screens. The patient page is always "light" here and
   * ignores the clinic's choice; its colours are its own, not the staff tokens.
   */
  theme: BrandTheme;
  /** The logo's address, checked, or null. */
  logoUrl: string | null;
  /** The clinic's phone as a tap-to-call link, or null when there is no valid number. */
  call: { href: string; label: string } | null;
};

function lookFrom(stored: StoredBranding | null | undefined, surface: "patient" | "staff"): Look {
  const branding = readBranding(stored);
  const theme = surface === "patient" ? patientTheme(branding.color) : staffTheme(branding.color, branding.theme);
  const href = telHref(stored?.phone);
  return {
    // The staff screens also carry the dark-ground shades, for the video player, which is black in both modes.
    style: (surface === "patient" ? themeVars(theme) : { ...themeVars(theme), ...darkGroundVars(branding.color) }) as CSSProperties,
    fontClass: brandFontClass(branding.font),
    theme: surface === "patient" ? "light" : branding.theme,
    logoUrl: parseLogoUrl(stored?.logoUrl),
    call: href ? { href, label: formatUsPhone(stored?.phone) } : null,
  };
}

/** The look of the patient page (light ground) for one clinic. Null, for a link that does not exist, gives the Pulse look. */
export function patientLook(clinic: StoredBranding | null | undefined): Look {
  return lookFrom(clinic, "patient");
}

/**
 * The look of the staff screens (/library and /admin) for one clinic, dark
 * or light as the clinic chose. Takes the clinic as lib/clinic.ts returns
 * it, whose colour, font and mode are already checked.
 */
export function staffLook(clinic: { logoUrl: string | null; phone: string | null; branding: { color: string | null; font: BrandFontKey; theme: BrandTheme } } | null | undefined): Look {
  return lookFrom(
    clinic ? { logoUrl: clinic.logoUrl, phone: clinic.phone, brandColor: clinic.branding.color, brandFont: clinic.branding.font, brandTheme: clinic.branding.theme } : null,
    "staff",
  );
}

/** The class for every font on the list, so the branding form can show each choice in its own letters. */
export function allFontClasses(): Record<BrandFontKey, string> {
  return Object.fromEntries(BRAND_FONTS.map((font) => [font.key, brandFontClass(font.key)])) as Record<BrandFontKey, string>;
}
