import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { brandFontFamily } from "@/app/brand-fonts";
import { staffTheme } from "@/lib/branding";
import { getCurrentClinic } from "@/lib/clinic";

/**
 * Every admin page (the console, the printable pamphlet) gets Clerk's
 * provider, so the user button and sign-out work there. The console draws
 * its own shell inside this, as before.
 *
 * The one thing read here is the clinic's brand colour, so Clerk's own
 * pieces (the user menu, the People panel) match the screens around them.
 * That is about looks only; who may see an admin page is checked by each
 * page. getCurrentClinic() is cached for the length of a request and every
 * admin page calls it too, so this costs no extra read. No clinic yet means
 * the Pulse teal.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const clinic = await getCurrentClinic();
  return <StaffClerkProvider accent={staffTheme(clinic?.branding.color ?? null).accent} fontFamily={brandFontFamily(clinic?.branding.font ?? "inter")}>{children}</StaffClerkProvider>;
}
