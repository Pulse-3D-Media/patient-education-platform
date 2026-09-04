"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The global app navigation. One item today (My Library) because that is the
 * only surface that exists. Share links, analytics and settings are Phase 2
 * and get added here when their pages are real, never as dead links.
 *
 * Desktop: a full sidebar. Tablet: collapsed to icons so the cards keep their
 * width. Phone: a slim top bar instead of a sidebar.
 */
const NAV = [{ href: "/library", label: "My Library", icon: LibraryIcon }];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Phone: top bar */}
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3 md:hidden">
        <Brand />
      </header>

      {/* Tablet and up: sidebar */}
      <aside className="hidden w-[76px] shrink-0 flex-col border-r border-white/10 bg-[#07090b] py-5 md:flex xl:w-60">
        <div className="px-4 xl:px-6">
          <Brand compact />
        </div>
        <nav className="mt-8 flex flex-col gap-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium transition ${
                  active
                    ? "bg-[#2a829b]/15 text-white"
                    : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
                }`}
              >
                <item.icon className={`h-6 w-6 shrink-0 ${active ? "text-[#5fb8d4]" : ""}`} />
                <span className="hidden xl:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/library" className="flex items-center gap-2" aria-label="Pulse 3D">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2a829b] text-sm font-bold text-white">
        P3
      </span>
      <span className={`text-lg font-semibold tracking-tight text-white ${compact ? "hidden xl:inline" : ""}`}>
        Pulse 3D
      </span>
    </Link>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="3" y="4" width="7" height="7" rx="1.5" />
      <rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="13" width="7" height="7" rx="1.5" />
      <rect x="14" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}
