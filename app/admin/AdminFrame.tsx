import type { ReactNode } from "react";
import { staffLook } from "@/app/brand-look";
import { AdminConsole } from "@/components/ui/AdminConsole";
import type { CurrentClinic } from "@/lib/clinic";

/**
 * The frame every clinic admin page draws itself inside: the admin console
 * (the clinic's logo in the top bar, the left rail with the five sections,
 * Library and the signed-in person at the bottom of the rail; on a phone the
 * sections as a row of pills) in the clinic's own branding, then the page's
 * own title and content.
 *
 * Only the page decides whether the person may see it: this frame is
 * drawn AFTER the page has checked that they are an admin (a member gets
 * <AdminsOnly /> with no frame and no navigation). A closed clinic's admin
 * does get the frame, so the rail (or the row of pills on a phone) is how
 * they reach Billing, the page that stays open when the rest is closed.
 *
 * It takes the clinic the page already fetched (requireClinicPage), so the
 * branding costs no extra read. The look is worked out here, on the server
 * (staffLook()), and only the checked values go to the browser.
 */
export function AdminFrame({
  clinic,
  title,
  intro,
  wide = false,
  children,
}: {
  clinic: CurrentClinic;
  title: string;
  /** One or two plain sentences under the title, or nothing. */
  intro?: ReactNode;
  /** True for the pages that hold lists (shared links), which want the full width. */
  wide?: boolean;
  children: ReactNode;
}) {
  const look = staffLook(clinic);
  return (
    <AdminConsole brand={{ style: look.style, fontClass: look.fontClass, theme: look.theme, clinicName: clinic.name, logoUrl: look.logoUrl }}>
      <main className="px-4 py-6 sm:px-8 sm:py-8">
        <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
          <header>
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            {intro && <p className="mt-1 max-w-2xl text-ink-soft">{intro}</p>}
          </header>
          {children}
        </div>
      </main>
    </AdminConsole>
  );
}
