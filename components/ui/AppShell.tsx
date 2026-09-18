"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_GROUP } from "@/lib/categories";
import { LOGO_URL } from "@/lib/brand";
import { ClinicLogo } from "./ClinicLogo";
import { AdminIcon, BooksIcon, CloseIcon, HomeIcon } from "./icons";

/**
 * The frame around every staff-facing page: the library and the admin
 * console. (The patient page at /watch has no frame at all, on purpose.)
 * One navigation model on every screen:
 *
 *   - a thin banner across the top with the clinic's own logo (or its name,
 *     when it has no logo or the logo does not load) and, on the right,
 *     Clerk's user button (the signed-in person's avatar; Sign out lives in
 *     its menu)
 *   - an icon rail down the left: the books icon opens the category drawer,
 *     and the admin icon right below it opens the clinic admin area (the
 *     overview, shared links, people and billing; on phones both icons sit
 *     in the banner instead, so nothing permanent eats the narrow width)
 *   - the category drawer, listing Home and every category from
 *     lib/categories. It floats over the content rather than pushing it, and
 *     closes on outside click, Escape, or choosing a category.
 *
 * It is a client component only because the drawer needs open/closed state.
 * The page content arrives as children and stays server-rendered.
 *
 * The admin icon that opens the admin area is shown only when showAdmin
 * is true, which the server sets for clinic admins. That is a courtesy so
 * members are not offered a page they cannot use; the admin pages check
 * for themselves.
 *
 * THE CLINIC'S BRANDING arrives as `brand`, already worked out and checked
 * on the server (ClinicShell, app/brand-look.ts): the colours as CSS
 * variables and the font's class, both set on the outermost element so
 * every page inside picks them up, plus the clinic's name and logo for the
 * banner. Without it (a page drawn before the clinic is known) the shell is
 * the plain Pulse 3D one. Pulse 3D's own mark moves to the foot of the
 * category drawer, small, as "Powered by".
 */

/** One clinic's look, as plain values the server has already checked. */
export type ShellBrand = {
  /** The brand colours, as CSS variables. */
  style: CSSProperties;
  /** The class that sets the clinic's font. Empty for Inter. */
  fontClass: string;
  clinicName: string;
  logoUrl: string | null;
};

export function AppShell({ children, showAdmin = false, brand }: { children: ReactNode; showAdmin?: boolean; brand?: ShellBrand }) {
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
    <div className={`flex min-h-screen flex-col bg-black text-white ${brand?.fontClass ?? ""}`} style={brand?.style}>
      {/* Banner */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-black px-3 sm:px-4">
        <LibraryButton open={open} onClick={toggle} className="md:hidden" />
        {brand ? (
          <Link href="/library" className="flex min-w-0 items-center" aria-label={`${brand.clinicName}, library home`}>
            {brand.logoUrl ? (
              // On a white chip, because most logos are drawn for a white page and would vanish on this black banner. The box is a fixed size, so a slow or broken logo moves nothing; the name stands in until the picture loads, and for good if it does not.
              <span className="flex items-center rounded-md bg-white px-2 py-1">
                <ClinicLogo
                  src={brand.logoUrl}
                  name={brand.clinicName}
                  boxClassName="h-6 w-[116px]"
                  nameClassName="text-[13px] font-semibold text-[#12202a]"
                />
              </span>
            ) : (
              <span className="max-w-[46vw] truncate text-[15px] font-semibold text-white sm:max-w-xs">{brand.clinicName}</span>
            )}
          </Link>
        ) : (
          <Link href="/library" className="flex items-center" aria-label="Pulse 3D, library home">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
            <img src={LOGO_URL} alt="Pulse 3D" className="h-7 w-auto" />
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-[#667085] sm:inline">
            {onAdmin ? "Clinic admin" : "Patient Education Library"}
          </span>
          {showAdmin && <AdminLink active={onAdmin} className="md:hidden" />}
          {/* Clerk's user button: the signed-in person's avatar, with Sign out in its menu. */}
          <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Rail, tablet and up */}
        <nav
          aria-label="Application"
          className="sticky top-12 hidden h-[calc(100vh-3rem)] w-16 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#07090b] py-3 md:flex"
        >
          <LibraryButton open={open} onClick={toggle} />
          {showAdmin && <AdminLink active={onAdmin} />}
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
            <CategoryDrawer pathname={pathname} onClose={() => setOpen(false)} poweredBy={Boolean(brand)} />
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
        open ? "bg-brand/20 text-brand-bright" : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
      } ${className}`}
    >
      <BooksIcon className="h-6 w-6" />
    </button>
  );
}

/** The icon that opens the clinic admin area (its overview). Same size as the books button so the rail lines up. */
function AdminLink({ active, className = "" }: { active: boolean; className?: string }) {
  return (
    <Link
      href="/admin"
      title="Clinic admin"
      aria-label="Open clinic admin"
      aria-current={active ? "page" : undefined}
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
        active ? "bg-brand/20 text-brand-bright" : "text-[#bfbfbf] hover:bg-white/5 hover:text-white"
      } ${className}`}
    >
      <AdminIcon className="h-6 w-6" />
    </Link>
  );
}

function CategoryDrawer({ pathname, onClose, poweredBy }: { pathname: string; onClose: () => void; poweredBy: boolean }) {
  const onHome = pathname === "/library";
  const itemBase = "flex h-12 items-center gap-3 rounded-lg border-l-2 px-3 text-base transition";
  const idle = "border-transparent text-[#bfbfbf] hover:bg-white/5 hover:text-white";
  const active = "border-brand-bright bg-brand/15 font-medium text-white";

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

      {/* When the banner carries the clinic's logo, Pulse 3D's own mark lives here, small. */}
      {poweredBy && (
        <p className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-[#667085]">
          Powered by
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO_URL} alt="Pulse 3D" className="h-4 w-auto" />
        </p>
      )}
    </aside>
  );
}
