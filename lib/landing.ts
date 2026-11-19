/**
 * The small rules behind the landing page and its sign-in box (app/page.tsx,
 * app/sign-in, app/sign-up, components/landing). Pure: no database, no Clerk,
 * safe for the browser.
 */

/** The subtitle under the heading, the website's early access wording (approved with the design, 2026-11-19). */
export const LANDING_SUBTITLE = { said: "You explain it once.", answer: "Let the animation re-explain when needed." };

/** The public website, which the navigation across the top and the footer point at. */
export const SITE_ORIGIN = "https://www.pulse3dmedia.com";

/**
 * The website's own navigation, copied from pulse3dmedia.com on 2026-11-19.
 * Portfolio and Services open a menu on the website; here they go to that
 * section's first page, so nothing needs a script. "current" marks the
 * section this app belongs to.
 */
export const SITE_LINKS: { label: string; href: string; current?: boolean }[] = [
  { label: "Home", href: `${SITE_ORIGIN}/` },
  { label: "Portfolio", href: `${SITE_ORIGIN}/portfolio` },
  { label: "Services", href: `${SITE_ORIGIN}/services` },
  { label: "Patient Education", href: `${SITE_ORIGIN}/earlyaccess`, current: true },
  { label: "Process", href: `${SITE_ORIGIN}/our-process` },
  { label: "Contact", href: `${SITE_ORIGIN}/contact` },
  { label: "Blog", href: `${SITE_ORIGIN}/blog` },
];

/** The website's call-to-action button at the end of its navigation. */
export const SITE_CALL = { label: "Schedule a Call", href: `${SITE_ORIGIN}/schedulecall` };

/**
 * The address a tab of the box points at. Only `redirect_url` travels with
 * it (the page someone was sent from, so a sign-up that started on a guarded
 * page returns there); nothing else in the address does, so an invitation
 * ticket never leaks from one tab to the other. Clerk checks `redirect_url`
 * against the allowed addresses itself, and so does safeReturnPath() below.
 */
export function tabHref(base: "/sign-in" | "/sign-up", redirectUrl: unknown): string {
  if (typeof redirectUrl !== "string" || redirectUrl === "") return base;
  return `${base}?${new URLSearchParams({ redirect_url: redirectUrl }).toString()}`;
}

/**
 * Where the new account goes once sign-up is finished: the page it started
 * from when that page is on this same site, otherwise /onboarding (which
 * routes everyone, as before this page existed). A full address on another
 * site, a "//" address (which a browser reads as another site) and anything
 * that cannot be read all fall back to /onboarding.
 *
 * `origin` is this page's own origin (window.location.origin).
 */
export function safeReturnPath(raw: unknown, origin: string): string {
  const fallback = "/onboarding";
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    // Never send someone back to the sign-in or sign-up pages themselves.
    if (/^\/sign-(in|up)(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * "Your name" is one box, and Clerk keeps a first and a last name. The last
 * word is the last name and everything before it the first name, so
 * "Mary Ann Lee" is "Mary Ann" and "Lee". One word alone is not enough:
 * Clerk asks for both, so the person is asked for both.
 */
export function splitFullName(name: string): { firstName: string; lastName: string } | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** A light check before asking Clerk, which makes the real one. Something, an @, something, a dot, something. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** A six-digit code, with spaces a person may type taken out. */
export function cleanCode(code: string): string {
  return code.replace(/\s+/g, "");
}
