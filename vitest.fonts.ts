/**
 * A stand-in for "next/font/google", for the tests only.
 *
 * The real module only works inside Next.js's own compiler, which swaps
 * each font call for a generated class name while it builds. Under Vitest
 * there is no compiler, the real module exports nothing, and any page that
 * imports app/brand-fonts.ts would fail to load. vitest.config.mts points
 * "next/font/google" here instead.
 *
 * Each font returns a predictable class name ("font-open-sans"), so a test
 * can check that a clinic's chosen font reached the page. One export per
 * font the app uses; add a line here when app/brand-fonts.ts or
 * app/layout.tsx gains a font.
 */

function font(name: string) {
  return (options: { variable?: string } = {}) => ({
    className: `font-${name}`,
    variable: options.variable ? `variable-${name}` : "",
    style: { fontFamily: name },
  });
}

export const Inter = font("inter");
export const Open_Sans = font("open-sans");
export const Source_Sans_3 = font("source-sans");
export const Montserrat = font("montserrat");
export const Nunito_Sans = font("nunito-sans");
export const Merriweather = font("merriweather");
