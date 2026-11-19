import { Hanken_Grotesk, Schibsted_Grotesk } from "next/font/google";

/**
 * The two fonts of the staff screens (decided by Evan on 2026-11-18, from the
 * approved design): Schibsted Grotesk for headings and Hanken Grotesk for
 * everything else. They are the fonts of the Pulse 3D website's early access
 * page.
 *
 * Like every font in the app, Next.js downloads them from Google once, while
 * the app is being built, and serves them from our own address. No new
 * package: this is Next.js's built-in font loader.
 *
 * THE SPEED RULE: preload is OFF, on purpose.
 * Next.js would otherwise tell the browser to fetch both files at once on
 * every page whose CSS mentions them, and the production build puts all of
 * the app's CSS into shared files, so that would include the patient's page
 * (seen in the build on 2026-11-19: about 80 KB more for a patient's phone).
 * With preload off, a browser downloads a font file only when some text on
 * the page actually uses it. The patient's pages (app/watch, app/q) and the
 * calm error pages keep Inter, so a patient's phone never downloads these.
 * A staff page shows its text at once in a matched fallback and swaps to the
 * font when it arrives (display: "swap"); nothing waits for it, least of all
 * a video. This is how the clinics' own fonts are loaded too (app/brand-fonts.ts).
 *
 * HOW A PAGE USES THEM. Only the staff layouts (app/admin, app/library,
 * app/pulse, app/onboarding) and the landing page (LandingProviders in
 * components/landing/LandingFrame.tsx, for /, /sign-in and /sign-up) import this file.
 * Each wraps its pages in an element with STAFF_TYPE_CLASS, which defines the
 * two fonts as CSS variables and sets Hanken Grotesk as the text font (the
 * "staff-type" rule in app/globals.css). The shell then adds
 * "staff-headings" for headings in Schibsted Grotesk, unless the clinic chose
 * a font of its own on its Branding page, in which case the clinic's font is
 * used for everything instead, as before.
 */

const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap", preload: false });
const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap", preload: false });

/** The classes a staff layout puts on the element that wraps its pages: the two font variables and the text font. */
export const STAFF_TYPE_CLASS = `${hanken.variable} ${schibsted.variable} staff-type`;

/**
 * The text font's family by name, for Clerk. Clerk draws some panels (the
 * user menu, a sign-in step) outside our wrapper, where the CSS variable
 * does not reach, so it is given the font's real name instead.
 */
export const STAFF_TEXT_FAMILY = `${hanken.style.fontFamily}, system-ui, sans-serif`;
