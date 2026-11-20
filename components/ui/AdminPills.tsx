"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-nav";

/**
 * The admin pages as a row of pills under the top bar, on a PHONE only (a
 * phone has no side rail, and this keeps every admin page one thumb away,
 * Billing included for a closed clinic). From a tablet up the same pages are
 * under Admin in the side rail (SideRail.tsx).
 *
 * The row scrolls sideways rather than wrapping, and brings the current pill
 * into view (Billing is off the edge otherwise). The list and the rule for
 * which pill is current are lib/admin-nav.ts, the same as the rail's.
 *
 * Navigation only: every admin page checks on the server that the person is
 * an admin before it draws this at all, and a member never sees it.
 */
export function AdminPills() {
  const current = activeAdminSection(usePathname());
  const row = useRef<HTMLElement>(null);

  // Bring the current pill into the middle of the row. Only the row scrolls, never the page.
  useEffect(() => {
    const box = row.current;
    const pill = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !pill) return;
    box.scrollLeft = pill.offsetLeft - box.clientWidth / 2 + pill.offsetWidth / 2;
  }, [current]);

  return (
    <nav
      ref={row}
      aria-label="Clinic admin"
      // The tour's admin stop points here on a phone.
      data-tour="admin-sections"
      data-tour-name={ADMIN_SECTIONS.map((section) => section.label).join(", ")}
      className="relative shrink-0 overflow-x-auto border-b border-line px-4 py-2.5"
    >
      <ul className="flex min-w-max gap-2">
        {ADMIN_SECTIONS.map((section) => {
          const active = section.href === current;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-11 items-center whitespace-nowrap rounded-full border px-4 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright ${
                  active ? "border-transparent bg-brand text-on-brand" : "border-line-strong text-ink-soft hover:bg-wash hover:text-ink"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
