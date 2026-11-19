"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { ConsoleShell } from "./ConsoleShell";
import { AlertIcon, CardIcon, ChartIcon, DotsIcon, HomeIcon, VideoIcon } from "./icons";

/**
 * The frame around every page of the Pulse 3D master dashboard (/pulse).
 * Staff only; the layout has already checked that before this renders, and
 * every page and action checks again for itself.
 *
 * The same console layout as the clinic's admin area (ConsoleShell, from the
 * approved design of 2026-11-18), ALWAYS DARK: it says data-theme="dark"
 * itself, so it never depends on the staff screens' default, which is light.
 * The top bar has the Pulse 3D mark, a "Staff" label and, when the layout
 * hands it an address, "Open demo site". The rail has the six sections, then
 * Library and the signed-in person at the bottom; on a phone the
 * sections are a row of pills and the avatar sits in the top bar (the
 * library stays on the rail, which a phone does not show).
 *
 * Nothing here is ever drawn for a clinic: the layout answers not-found to
 * anyone who is not Pulse staff before this component is reached.
 * A client component only because the current section comes from the address.
 */

const SECTIONS: { href: string; label: string; icon: ReactNode; matches: (path: string) => boolean }[] = [
  { href: "/pulse", label: "Clinics", icon: <HomeIcon className="h-5 w-5" />, matches: (p) => p === "/pulse" || p.startsWith("/pulse/clinics") },
  { href: "/pulse/videos", label: "Videos", icon: <VideoIcon className="h-5 w-5" />, matches: (p) => p.startsWith("/pulse/videos") },
  { href: "/pulse/pricing", label: "Pricing", icon: <CardIcon className="h-5 w-5" />, matches: (p) => p.startsWith("/pulse/pricing") },
  { href: "/pulse/settings", label: "Settings", icon: <DotsIcon className="h-5 w-5" />, matches: (p) => p.startsWith("/pulse/settings") },
  { href: "/pulse/billing", label: "Billing", icon: <AlertIcon className="h-5 w-5" />, matches: (p) => p.startsWith("/pulse/billing") },
  { href: "/pulse/reports", label: "Reports", icon: <ChartIcon className="h-5 w-5" />, matches: (p) => p.startsWith("/pulse/reports") },
];

/**
 * `demoSiteUrl` is the demo site's address, already checked on the server by
 * demoSiteUrl() in lib/demo-site.ts, or null, and then there is no link. It
 * opens in a new tab, so a sales call keeps this dashboard open beside it.
 */
export function PulseShell({ children, demoSiteUrl }: { children: ReactNode; demoSiteUrl: string | null }) {
  const pathname = usePathname();

  return (
    <ConsoleShell
      theme="dark"
      navLabel="Dashboard"
      mark={
        <div className="flex items-center gap-3">
          <Link href="/pulse" className="flex items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-bright" aria-label="Pulse 3D, clinics">
            {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
            <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="h-9 w-auto" />
          </Link>
          <span className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-bold text-ink-soft">Staff</span>
        </div>
      }
      topEnd={
        demoSiteUrl && (
          <a
            href={demoSiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center rounded-xl border border-line-strong px-3 text-sm font-medium text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
          >
            {/* Short on a phone, where the top bar also holds the library and the avatar. */}
            <span className="hidden sm:inline">Open demo site</span>
            <span className="sm:hidden">Demo</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      }
      sections={SECTIONS.map((section) => ({ href: section.href, label: section.label, icon: section.icon, active: section.matches(pathname) }))}
      // Not in the phone's top bar, as in the design: there it holds the mark, "Staff", the demo site and the avatar, and no more fits.
      library={{ href: "/library", label: "Library", inPhoneBar: false }}
    >
      {children}
    </ConsoleShell>
  );
}
