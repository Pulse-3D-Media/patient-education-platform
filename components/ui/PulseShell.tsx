"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LOGO_URL } from "@/lib/brand";

/**
 * The frame around every page of the Pulse 3D master dashboard (/pulse).
 * Staff only; the layout has already checked that before this renders.
 *
 * A thin banner across the top (the Pulse 3D mark, a "Staff" label, Clerk's
 * user button) and a left rail with the five sections. Desktop first: the
 * rail is a column of 48px-tall links from tablet width up, and a scrolling
 * row of the same links on a phone so nothing overflows.
 *
 * Sections marked "coming" exist as placeholder pages, so no link here is
 * ever broken. This is a client component only because the active link
 * needs the current path.
 */

const SECTIONS: { href: string; label: string; coming?: boolean; matches: (path: string) => boolean }[] = [
  { href: "/pulse", label: "Clinics", matches: (p) => p === "/pulse" || p.startsWith("/pulse/clinics") },
  { href: "/pulse/videos", label: "Videos", matches: (p) => p.startsWith("/pulse/videos") },
  { href: "/pulse/pricing", label: "Pricing", coming: true, matches: (p) => p.startsWith("/pulse/pricing") },
  { href: "/pulse/settings", label: "Settings", matches: (p) => p.startsWith("/pulse/settings") },
  { href: "/pulse/reports", label: "Reports", coming: true, matches: (p) => p.startsWith("/pulse/reports") },
];

export function PulseShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-black px-3 sm:px-4">
        <Link href="/pulse" className="flex items-center" aria-label="Pulse 3D, clinics">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO_URL} alt="Pulse 3D" className="h-7 w-auto" />
        </Link>
        <span className="rounded-md bg-[#2a829b]/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[#5fb8d4]">
          Staff
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/library" className="hidden text-sm text-[#667085] hover:text-white sm:inline">
            Open the library
          </Link>
          <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Dashboard"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 bg-[#07090b] px-2 py-2 md:sticky md:top-12 md:h-[calc(100vh-3rem)] md:w-52 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-4"
        >
          {SECTIONS.map((section) => {
            const active = section.matches(pathname);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-12 shrink-0 items-center justify-between gap-3 rounded-lg border-l-2 px-3 text-[15px] transition ${
                  active
                    ? "border-[#5fb8d4] bg-[#2a829b]/15 font-medium text-white"
                    : "border-transparent text-[#bfbfbf] hover:bg-white/5 hover:text-white"
                }`}
              >
                {section.label}
                {section.coming && <span className="text-xs uppercase tracking-wider text-[#667085]">Coming</span>}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
