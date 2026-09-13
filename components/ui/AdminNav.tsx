"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-nav";

/**
 * The row of section links at the top of every clinic admin page: Overview,
 * Shared links, People, Billing, Reports. One row on every screen size: on
 * a phone it scrolls sideways rather than wrapping or hiding anything, so
 * the current section is always in reach with one thumb.
 *
 * The current section is marked (aria-current, a teal underline) from the
 * address, using the rule in lib/admin-nav.ts. Every link is a real link,
 * so it can be tabbed to and shows a focus ring.
 *
 * This is navigation only. Which pages a person may use is checked on the
 * server by each page; showing a link here grants nothing.
 */
export function AdminNav() {
  const active = activeAdminSection(usePathname());

  return (
    <nav aria-label="Clinic admin" className="-mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max gap-1 border-b border-white/10">
        {ADMIN_SECTIONS.map((section) => {
          const isActive = section.href === active;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px flex h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] transition focus-visible:rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#5fb8d4] ${
                  isActive ? "border-[#5fb8d4] font-medium text-white" : "border-transparent text-[#bfbfbf] hover:border-white/30 hover:text-white"
                }`}
              >
                {section.label}
                {section.coming && <span className="text-xs uppercase tracking-wider text-[#667085]">Coming</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
