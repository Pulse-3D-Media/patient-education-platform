import type { ReactNode } from "react";
import { staffLook } from "@/app/brand-look";
import type { CurrentClinic } from "@/lib/clinic";
import { setupReminder } from "@/lib/setup";
import { AppShell } from "./AppShell";

/**
 * The app shell, dressed in one clinic's branding: its colour, its font,
 * light or dark as the clinic chose, and its logo (or name) in the banner.
 * The library's layout and every admin page (AdminFrame) draw it, so both
 * have the same side rail (Evan, 2026-11-20).
 *
 * A server component, so the look is worked out on the server from the
 * clinic the server itself found for the signed-in person (lib/clinic.ts),
 * and only the finished, checked values go to the browser. AppShell is the
 * client piece underneath; it just draws what it is given.
 *
 * A clinic that has set nothing gets the Pulse colours and the staff fonts,
 * with its own name in the banner where a logo would be.
 */
export function ClinicShell({
  clinic,
  showAdmin = false,
  phoneNav,
  children,
}: {
  clinic: CurrentClinic;
  showAdmin?: boolean;
  /** Drawn under the top bar on a phone only (the admin pages' row of pills). */
  phoneNav?: ReactNode;
  children: ReactNode;
}) {
  const look = staffLook(clinic);
  return (
    <AppShell
      showAdmin={showAdmin}
      categories={clinic.planCategories}
      // "Finish setup" in the menu: for the clinic's office admins only, until nothing is left undone (setupReminder in lib/setup.ts).
      setup={clinic.isAdmin ? setupReminder(clinic.setup) : null}
      brand={{ style: look.style, fontClass: look.fontClass, theme: look.theme, clinicName: clinic.name, logoUrl: look.logoUrl }}
      phoneNav={phoneNav}
    >
      {children}
    </AppShell>
  );
}
