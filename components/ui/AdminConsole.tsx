"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ADMIN_SECTIONS, activeAdminSection, type AdminSection } from "@/lib/admin-nav";
import { ClinicLogo } from "./ClinicLogo";
import { ConsoleShell } from "./ConsoleShell";
import { TourHost } from "@/components/tour/TourHost";
import type { ShellBrand } from "./AppShell";
import { CardIcon, HomeIcon, LinkIcon, PaletteIcon, PeopleIcon } from "./icons";

/** Each admin section's icon on the rail. */
const ICONS: Record<AdminSection["href"], ReactNode> = {
  "/admin": <HomeIcon className="h-5 w-5" />,
  "/admin/links": <LinkIcon className="h-5 w-5" />,
  "/admin/people": <PeopleIcon className="h-5 w-5" />,
  "/admin/branding": <PaletteIcon className="h-5 w-5" />,
  "/admin/billing": <CardIcon className="h-5 w-5" />,
};

/**
 * The clinic admin console's frame: the console layout (ConsoleShell) in the
 * clinic's own look, with the five admin sections from lib/admin-nav.ts and
 * the current one marked by the same rule the rest of the app uses.
 *
 * `brand` is worked out and checked on the server (AdminFrame, staffLook()).
 * A client component only because the current section comes from the address.
 *
 * Navigation only: every admin page checks on the server that the person is
 * an admin before it draws this frame at all, and a member never sees it.
 * An admin of a closed clinic does, so Billing is always one tap away.
 */
export function AdminConsole({ brand, children }: { brand: ShellBrand; children: ReactNode }) {
  const current = activeAdminSection(usePathname());

  return (
    <ConsoleShell
      theme={brand.theme}
      style={brand.style}
      fontClass={brand.fontClass}
      navLabel="Clinic admin"
      mark={
        // The clinic's logo as it is, or its name until the picture loads and for good if there is none. A fixed box, so nothing moves.
        <Link href="/admin" aria-label={`${brand.clinicName}, admin overview`} className="flex min-w-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-bright">
          <ClinicLogo src={brand.logoUrl} name={brand.clinicName} boxClassName="h-10 w-[150px] sm:w-[220px]" nameClassName="text-base font-semibold tracking-tight text-ink" />
        </Link>
      }
      sections={ADMIN_SECTIONS.map((section) => ({ href: section.href, label: section.label, icon: ICONS[section.href], active: section.href === current }))}
      library={{ href: "/library", label: "Library" }}
      tour
    >
      {children}
      {/* The tour's admin stop (only an admin reaches these pages). Draws nothing, and loads none of its code, without ?tour= in the address. */}
      <TourHost isAdmin />
    </ConsoleShell>
  );
}
