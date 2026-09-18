import { Merriweather, Montserrat, Nunito_Sans, Open_Sans, Source_Sans_3 } from "next/font/google";
import type { BrandFontKey } from "@/lib/branding";

/**
 * The font files behind the short list in lib/branding.ts.
 *
 * Next.js downloads each font from Google once, while the app is being
 * built, and from then on serves it from our own address. A patient's phone
 * never contacts Google, and there is no new package: this is Next.js's
 * built-in font loader, the same one the root layout uses for Inter.
 *
 * Two settings matter for the speed rule, and both are deliberate:
 *
 *   preload: false   Without this, every page that imports this file would
 *                    fetch all five fonts up front. With it, the page only
 *                    carries a few lines of CSS naming each font, and the
 *                    browser downloads a font file only when some text on
 *                    the page actually uses it. So a patient's phone
 *                    fetches one font, the clinic's, and none at all for a
 *                    clinic that kept Inter.
 *
 *   display: "swap"  Text shows at once in a fallback font and changes to
 *                    the clinic's font when it arrives. Nothing on the page
 *                    waits for a font, least of all the video. Next.js sizes
 *                    the fallback to match, so the swap barely moves the
 *                    text.
 *
 * Next.js requires each font to be declared like this, one constant per
 * font at the top of a file, with its options written out; they cannot be
 * built in a loop. The keys below must match BRAND_FONTS in lib/branding.ts,
 * and vitest.fonts.ts needs a line for each font named here.
 *
 * Inter is not declared here. It is the default, loaded by the root layout
 * for every page, so a clinic on Inter needs no class at all.
 */

const openSans = Open_Sans({ subsets: ["latin"], display: "swap", preload: false });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false });
const nunitoSans = Nunito_Sans({ subsets: ["latin"], display: "swap", preload: false });
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", preload: false });

/** The class that sets each font on an element and everything inside it. Inter needs none. */
const FONT_CLASS: Record<BrandFontKey, string> = {
  inter: "",
  "open-sans": openSans.className,
  "source-sans": sourceSans.className,
  montserrat: montserrat.className,
  "nunito-sans": nunitoSans.className,
  merriweather: merriweather.className,
};

/**
 * The class to put on the element that wraps a clinic's screens, so
 * everything inside it is set in the clinic's font. An empty string for
 * Inter, which the whole app already uses.
 */
export function brandFontClass(font: BrandFontKey): string {
  return FONT_CLASS[font] ?? "";
}

/** Clerk renders some panels outside the shell, so it needs the family too. */
export function brandFontFamily(font: BrandFontKey): string {
  return {
    inter: "var(--font-inter), Inter, sans-serif",
    "open-sans": openSans.style.fontFamily,
    "source-sans": sourceSans.style.fontFamily,
    montserrat: montserrat.style.fontFamily,
    "nunito-sans": nunitoSans.style.fontFamily,
    merriweather: merriweather.style.fontFamily,
  }[font];
}
