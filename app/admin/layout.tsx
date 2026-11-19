import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { brandFontFamily } from "@/app/brand-fonts";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";
import { DEFAULT_BRAND_FONT, DEFAULT_BRAND_THEME, staffTheme } from "@/lib/branding";
import { getClinicForShell } from "@/lib/clinic";

/**
 * Every admin page (the console, the printable pamphlet) gets Clerk's
 * provider, so the user button and sign-out work there. The console draws
 * its own shell inside this (AdminFrame).
 *
 * The one thing read here is the clinic's look (colour, font, light or
 * dark), so Clerk's own pieces (the user menu, the People panel) match the
 * screens around them.
 * That is about looks only; who may see an admin page is checked by each
 * page. getCurrentClinic() is cached for the length of a request and every
 * admin page calls it too, so this costs no extra read. No clinic yet means
 * the Pulse teal in light, the default, and so does a clinic that cannot be
 * read right now (getClinicForShell answers null rather than failing; the
 * page inside then fails the same way and its error page, error.tsx, says so).
 *
 * The wrapper sets the staff screens' fonts (app/staff-fonts.ts) for every
 * page inside, including the ones drawn without the shell.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const clinic = await getClinicForShell();
  const theme = clinic?.branding.theme ?? DEFAULT_BRAND_THEME;
  const font = clinic?.branding.font ?? DEFAULT_BRAND_FONT;
  const accent = staffTheme(clinic?.branding.color ?? null, theme);
  return (
    <StaffClerkProvider accent={accent.accent} onAccent={accent.onAccent} theme={theme} fontFamily={font === DEFAULT_BRAND_FONT ? STAFF_TEXT_FAMILY : brandFontFamily(font)}>
      <div className={`${STAFF_TYPE_CLASS} contents`}>{children}</div>
    </StaffClerkProvider>
  );
}
