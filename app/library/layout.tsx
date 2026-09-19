import { AppShell } from "@/components/ui/AppShell";
import { brandFontFamily } from "@/app/brand-fonts";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { staffTheme } from "@/lib/branding";
import { getCurrentClinic } from "@/lib/clinic";

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
 *   - the clinic's branding (its colour, font, and logo or name in the
 *     banner), so the library is the clinic's own from the first frame;
 *   - whether this person is a clinic admin, so the shell can show or hide
 *     the admin icon. Hiding it is a courtesy, not the check: /admin checks
 *     for itself.
 *
 * getCurrentClinic() is cached for the length of a request, and every
 * library page calls it too (through requireClinicPage), so reading it here
 * costs nothing extra. When there is no clinic yet (the page is about to
 * send the person to onboarding), the plain Pulse 3D shell is drawn.
 */
export default async function LibraryLayout({ children }: LayoutProps<"/library">) {
  const clinic = await getCurrentClinic();
  return (
    <StaffClerkProvider accent={staffTheme(clinic?.branding.color ?? null).accent} fontFamily={brandFontFamily(clinic?.branding.font ?? "inter")}>
      {clinic ? (
        <ClinicShell clinic={clinic} showAdmin={clinic.isAdmin}>
          {children}
        </ClinicShell>
      ) : (
        <AppShell>{children}</AppShell>
      )}
    </StaffClerkProvider>
  );
}
