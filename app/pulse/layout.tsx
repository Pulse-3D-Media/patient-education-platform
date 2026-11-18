import { notFound } from "next/navigation";
import { PulseShell } from "@/components/ui/PulseShell";
import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { demoSiteUrl } from "@/lib/demo-site";
import { isPulseStaff } from "@/lib/pulse";

/**
 * Every page of the Pulse 3D master dashboard sits inside this layout.
 *
 * It checks isPulseStaff() itself so that the not-found page a non-staff
 * visitor gets is the plain site one, without the dashboard's rail around
 * it. That check is not the security boundary: a layout does not re-run on
 * every navigation, so every page and every action under /pulse calls
 * requirePulseStaff() for itself as well.
 *
 * Clerk's provider goes around the shell so the user button works.
 *
 * The demo site's address (DEMO_SITE_URL, see lib/demo-site.ts) is read here,
 * on the server and only after the staff check, and handed to the shell for
 * its "Open demo site" link. Unset, or not a plain https address: no link.
 */
export default async function PulseLayout({ children }: LayoutProps<"/pulse">) {
  if (!(await isPulseStaff())) notFound();

  return (
    <StaffClerkProvider>
      <PulseShell demoSiteUrl={demoSiteUrl()}>{children}</PulseShell>
    </StaffClerkProvider>
  );
}
