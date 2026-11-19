import type { ReactNode } from "react";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";
import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { PULSE_STAFF_LIGHT_THEME, themeVars } from "@/lib/branding";
import { LANDING_SUBTITLE, SITE_ORIGIN, tabHref } from "@/lib/landing";
import { BOX_LOCALIZATION } from "./clerk-look";
import { SiteNav } from "./SiteNav";
import { WaysSection } from "./WaysSection";

/**
 * The landing page's frame (the approved design, screens 01, 02-signup-1
 * and 1b): the website's navigation across the top, a heading and the
 * website's "three ways" pictures on the left, and the box with its two tabs,
 * Sign in and Set up a clinic, on the right. On a phone the heading comes
 * first, then the box, then the pictures.
 *
 * The bare address (app/page.tsx), /sign-in and /sign-up all draw it; only
 * what is inside the box changes. It is light, in the staff screens' fonts
 * (app/staff-fonts.ts) and the Pulse light colours, like every other page
 * before a clinic has chosen its own.
 */

/** Clerk's provider and the staff fonts, for the three pages that draw the frame. */
export function LandingProviders({ children }: { children: ReactNode }) {
  return (
    <StaffClerkProvider theme="light" fontFamily={STAFF_TEXT_FAMILY} accent={PULSE_STAFF_LIGHT_THEME.accent} onAccent={PULSE_STAFF_LIGHT_THEME.onAccent} localization={BOX_LOCALIZATION}>
      <div data-theme="light" className={`${STAFF_TYPE_CLASS} staff-headings contents`}>
        {children}
      </div>
    </StaffClerkProvider>
  );
}

export function LandingFrame({
  tab,
  redirectUrl,
  children,
}: {
  /** Which tab is open: "sign-in" ("Welcome back.") or "set-up" ("Set up your clinic."). */
  tab: "sign-in" | "set-up";
  /** The page someone was sent from, carried to the other tab (lib/landing.ts, tabHref()). */
  redirectUrl?: unknown;
  children: ReactNode;
}) {
  const signIn = tab === "sign-in";
  const tabClass = "grid min-h-11 place-items-center rounded-full px-2 text-center font-semibold no-underline";
  const openTab = `${tabClass} bg-surface text-ink shadow-[0_1px_3px_var(--ui-wash-strong)]`;
  const closedTab = `${tabClass} text-ink-muted hover:text-ink`;

  return (
    <div className="flex min-h-screen flex-col bg-ground text-[1rem] leading-[1.55] text-ink-soft min-[860px]:text-[1.0625rem]" style={themeVars(PULSE_STAFF_LIGHT_THEME)}>
      <SiteNav />

      <main className="mx-auto grid w-full max-w-[1180px] flex-1 content-center items-center gap-8 px-4 pb-12 pt-7 [grid-template-areas:'head'_'box'_'ways'] min-[860px]:grid-cols-[minmax(0,1.25fr)_440px] min-[860px]:gap-x-14 min-[860px]:gap-y-8 min-[860px]:p-14 min-[860px]:[grid-template-areas:'head_box'_'ways_box']">
        <div className="[grid-area:head] min-[860px]:self-end">
          <h1 className="text-[2.5rem] font-medium leading-[1.04] tracking-[-0.025em] text-ink min-[860px]:text-[4rem]">
            {signIn ? (
              <>
                Welcome <span className="text-brand-bright">back.</span>
              </>
            ) : (
              <>
                Set up your <span className="text-brand-bright">clinic.</span>
              </>
            )}
          </h1>
          <p className="mt-[18px] font-[family-name:var(--font-schibsted)] text-[1.25rem] leading-[1.3] text-ink min-[860px]:text-[1.375rem]">
            {LANDING_SUBTITLE.said} <span className="text-brand-bright">{LANDING_SUBTITLE.answer}</span>
          </p>
        </div>

        <section aria-label={signIn ? "Sign in" : "Set up a clinic"} className="min-w-0 rounded-3xl border border-line bg-surface p-5 shadow-lift [grid-area:box] min-[860px]:row-span-2 min-[860px]:self-center min-[860px]:p-7">
          <nav aria-label="Sign in or set up a clinic" className="mb-6 grid grid-cols-2 rounded-full bg-sunken p-1">
            <a href={tabHref("/sign-in", redirectUrl)} aria-current={signIn ? "page" : undefined} className={signIn ? openTab : closedTab}>
              Sign in
            </a>
            <a href={tabHref("/sign-up", redirectUrl)} aria-current={signIn ? undefined : "page"} className={signIn ? closedTab : openTab}>
              Set up a clinic
            </a>
          </nav>
          {children}
        </section>

        <div className="min-w-0 [grid-area:ways] min-[860px]:self-start">
          <WaysSection />
        </div>
      </main>

      <footer className="flex flex-wrap items-center gap-x-[22px] gap-y-1.5 border-t border-line px-4 py-4 text-[0.9375rem] text-ink-muted min-[860px]:px-14 min-[860px]:pb-[30px] min-[860px]:pt-[22px]">
        <a href={SITE_ORIGIN} className="inline-flex min-h-11 items-center gap-1 text-ink-muted no-underline hover:text-ink">
          pulse3dmedia.com
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
        <span className="basis-full min-[860px]:ml-auto min-[860px]:basis-auto">© {new Date().getFullYear()} Pulse 3D Media</span>
      </footer>
    </div>
  );
}

