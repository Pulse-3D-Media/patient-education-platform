import { AppShell } from "@/components/ui/AppShell";
import { brandFontFamily } from "@/app/brand-fonts";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";
import { DEFAULT_BRAND_FONT, DEFAULT_BRAND_THEME, staffTheme } from "@/lib/branding";
import { getClinicForShell } from "@/lib/clinic";
import { RememberLibraryPages } from "./watch/[videoId]/BackLink";

/**
 * Every library page sits inside the shared shell: thin top banner, icon
 * rail, and the category drawer that opens from the books icon. The page
 * itself is server-rendered and passed through as children.
 *
 * Clerk's provider goes around the shell so the user button in the banner
 * works. Signing in itself is checked in proxy.ts and in each page, not
 * here: a layout does not re-run on every navigation, so it is not a safe
 * place for that check.
 *
 * What the layout does read is the clinic, for two things that are about
 * how the shell looks and never about what a person may do:
 *
 *   - the clinic's branding (its colour, font, light or dark, and logo or
 *     name in the banner), so the library is the clinic's own from the first frame;
 *   - whether this person is a clinic admin, so the shell can show or hide
 *     the admin icon. Hiding it is a courtesy, not the check: /admin checks
 *     for itself.
 *
 * getCurrentClinic() is cached for the length of a request, and every
 * library page calls it too (through requireClinicPage), so reading it here
 * costs nothing extra. When there is no clinic yet (the page is about to
 * send the person to onboarding), the plain Pulse 3D shell is drawn.
 *
 * The same plain shell is drawn when the clinic cannot be read at all
 * (sign-in or the database not answering): getClinicForShell() answers
 * null instead of failing, the page inside fails in the same way, and the
 * error page next to it (error.tsx) says so inside this shell, with Try
 * again. A layout that failed would leave no banner and no way back.
 */
export default async function LibraryLayout({ children }: LayoutProps<"/library">) {
  const clinic = await getClinicForShell();
  // Clerk's own pieces take the accent worked out for the clinic's mode, light or dark.
  const theme = clinic?.branding.theme ?? DEFAULT_BRAND_THEME;
  const font = clinic?.branding.font ?? DEFAULT_BRAND_FONT;
  const accent = staffTheme(clinic?.branding.color ?? null, theme);
  return (
    <StaffClerkProvider accent={accent.accent} onAccent={accent.onAccent} theme={theme} fontFamily={font === DEFAULT_BRAND_FONT ? STAFF_TEXT_FAMILY : brandFontFamily(font)}>
      {/* The staff screens' fonts (app/staff-fonts.ts), for every library page. */}
      <div className={`${STAFF_TYPE_CLASS} contents`}>
        {/* Counts the library pages shown in this tab, so the watch page's back arrow knows whether there is one to go back to. Draws nothing. */}
        <RememberLibraryPages />
        {clinic ? (
          <ClinicShell clinic={clinic} showAdmin={clinic.isAdmin}>
            {children}
          </ClinicShell>
        ) : (
          <AppShell>{children}</AppShell>
        )}
      </div>
    </StaffClerkProvider>
  );
}
