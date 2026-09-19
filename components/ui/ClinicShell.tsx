import type { ReactNode } from "react";
import { staffLook } from "@/app/brand-look";
import type { CurrentClinic } from "@/lib/clinic";
import { AppShell } from "./AppShell";

/**
 * The app shell, dressed in one clinic's branding: its colour, its font,
 * light or dark as the clinic chose, and its logo (or name) in the banner.
 *
 * A server component, so the look is worked out on the server from the
 * clinic the server itself found for the signed-in person (lib/clinic.ts),
 * and only the finished, checked values go to the browser. AppShell is the
 * client piece underneath; it just draws what it is given.
 *
 * A clinic that has set nothing gets the Pulse colours and Inter, with its
 * own name in the banner where a logo would be.
 */
export function ClinicShell({ clinic, showAdmin = false, children }: { clinic: CurrentClinic; showAdmin?: boolean; children: ReactNode }) {
  const look = staffLook(clinic);
  return (
    <AppShell showAdmin={showAdmin} brand={{ style: look.style, fontClass: look.fontClass, theme: look.theme, clinicName: clinic.name, logoUrl: look.logoUrl }}>
      {children}
    </AppShell>
  );
}
