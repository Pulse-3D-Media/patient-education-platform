"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_GROUP } from "@/lib/categories";
import { LOGO_URL } from "@/lib/brand";
import { BooksIcon, CloseIcon, HomeIcon, ShareIcon } from "./icons";

/**
 * The frame around every staff-facing page: the library and the admin
 * console. (The patient page at /watch has no frame at all, on purpose.)
 * One navigation model on every screen:
 *
 *   - a thin banner across the top with the Pulse 3D mark
 *   - an icon rail down the left: the books icon opens the category drawer,
 *     and the share icon right below it opens the admin console, where share
 *     links are made (on phones both icons sit in the banner instead, so
 *     nothing permanent eats the narrow width)
 *   - the category drawer, listing Home and every category from
 *     lib/categories. It floats over the content rather than pushing it, and
 *     closes on outside click, Escape, or choosing a category.
 *
 * It is a client component only because the drawer needs open/closed state.
 * The page content arrives as children and stays server-rendered.
 *
 * Phase 2 shows the share icon only to people allowed into the admin console.
 */

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => setOpen((v) => !v);
  const onAdmin = pathname.startsWith("/admin");

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* Banner */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-black px-3 sm:px-4">
        <LibraryButton open={open} onClick={toggle} className="md:hidden" />
        <Link href="/library" className="flex items-center" aria-label="Pulse 3D, library home">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO_URL} alt="Pulse 3D" className="h-7 w-auto" />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-[#667085] sm:inline">
            {onAdmin ? "Admin" : "Patient Education Library"}
          </span>
          <AdminLink active={onAdmin} className="md:hidden" />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Rail, tablet and up */}
        <nav
          aria-label="Application"
          className="sticky top-12 hidden h-[calc(100vh-3rem)] w-16 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#07090b] py-3 md:flex"
        >
          <LibraryButton open={open} onClick={toggle} />
          <AdminLink active={onAdmin} />
        </nav>

        {/* Drawer and its backdrop */}
        {open && (
          <>
            <button
              type="button"
              aria-label="Close the library menu"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 md:top-12 md:left-16 lg:bg-black/25"
            />
            <CategoryDrawer pathname={pathname} onClose={() => setOpen(false)} />
          </>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function LibraryButton({ open, onClick, className = "" }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="category-drawer"
      aria-label={open ? "Close the library menu" : "Open the library menu"}
      title="Procedure Library"
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
        open ? "bg-[#2a829b]/20 text-[#5fb8d4]" : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
      } ${className}`}
    >
      <BooksIcon className="h-6 w-6" />
    </button>
  );
}

/** The share icon that opens the admin console. Same size as the books button so the rail lines up. */
function AdminLink({ active, className = "" }: { active: boolean; className?: string }) {
  return (
    <Link
      href="/admin"
      title="Share links"
      aria-label="Open the admin console"
      aria-current={active ? "page" : undefined}
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
        active ? "bg-[#2a829b]/20 text-[#5fb8d4]" : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
      } ${className}`}
    >
      <ShareIcon className="h-6 w-6" />
    </Link>
  );
}

function CategoryDrawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const onHome = pathname === "/library";
  const itemBase = "flex h-12 items-center gap-3 rounded-lg border-l-2 px-3 text-base transition";
  const idle = "border-transparent text-[#bfbfbf] hover:bg-white/5 hover:text-white";
  const active = "border-[#5fb8d4] bg-[#2a829b]/15 font-medium text-white";

  return (
    <aside
      id="category-drawer"
      aria-label="Procedure categories"
      className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/10 bg-[#0a0d0f] shadow-[8px_0_40px_rgba(0,0,0,.6)] md:top-12 md:left-16 md:w-64"
    >
      <div className="flex h-12 items-center justify-between px-4 md:h-14">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#667085]">Procedure Library</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-[#bfbfbf] hover:bg-white/5 hover:text-white md:hidden"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <Link href="/library" onClick={onClose} aria-current={onHome ? "page" : undefined} className={`${itemBase} ${onHome ? active : idle}`}>
          <HomeIcon className="h-5 w-5 shrink-0" />
          Home
        </Link>

        <p className="mt-5 mb-1 px-3 text-xs font-medium uppercase tracking-wider text-[#667085]">{CATEGORY_GROUP}</p>
        <ul className="flex flex-col gap-0.5">
          {CATEGORIES.map((c) => {
            const isActive = pathname === `/library/${c.slug}`;
            return (
              <li key={c.value}>
                <Link href={`/library/${c.slug}`} onClick={onClose} aria-current={isActive ? "page" : undefined} className={`${itemBase} ${isActive ? active : idle}`}>
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
