"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-nav";
import { CATEGORIES, CATEGORY_GROUP } from "@/lib/categories";
import { LOGO_URL } from "@/lib/brand";
import { ClinicLogo } from "./ClinicLogo";
import { AdminIcon, BooksIcon, CloseIcon, HomeIcon } from "./icons";

/**
 * The frame around every staff-facing page: the library and the admin
 * console. (The patient page at /watch has no frame at all, on purpose.)
 * One navigation model on every screen:
 *
 *   - a banner across the very top of the screen with the clinic's own logo
 *     at its left, as it is (no chip behind it). The logo's box is wide, so
 *     a wordmark can stretch out sideways instead of being squeezed into a
 *     square. A clinic with no logo gets its name there in words.
 *   - an icon rail down the left, under the banner: the books icon that
 *     opens the category menu, the admin icon that opens the admin menu, and
 *     below them Clerk's user button (the signed-in person's avatar; Sign
 *     out lives in its menu). On phones there is no rail: the same three
 *     things sit in the banner instead, so nothing permanent eats the narrow
 *     width
 *   - two pull-out menus that work the same way. The category menu lists
 *     Home and every category from lib/categories. The admin menu lists
 *     every section of the clinic admin area from lib/admin-nav (overview,
 *     shared links, people, branding, billing, reports). Each floats over
 *     the content rather than pushing it, and closes on outside click,
 *     Escape, or choosing something. Only one is open at a time.
 *
 * It is a client component only because the menus need open/closed state.
 * The page content arrives as children and stays server-rendered.
 *
 * The admin icon is shown only when showAdmin is true, which the server
 * sets for clinic admins. That is a courtesy so members are not offered
 * pages they cannot use; the admin pages check for themselves.
 *
 * THE CLINIC'S BRANDING arrives as `brand`, already worked out and checked
 * on the server (ClinicShell, app/brand-look.ts): the colours as CSS
 * variables and the font's class, both set on the outermost element so
 * every page inside picks them up, plus the clinic's name and logo. Without
 * it (a page drawn before the clinic is known) the shell is the plain
 * Pulse 3D one. Pulse 3D's own mark moves to the foot of the category menu,
 * small, as "Powered by".
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

/** Which pull-out menu is showing, if any. */
type Menu = "library" | "admin" | null;

export function AppShell({ children, showAdmin = false, brand }: { children: ReactNode; showAdmin?: boolean; brand?: ShellBrand }) {
  const [menu, setMenu] = useState<Menu>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Pressing a menu's icon opens it, pressing it again closes it, and pressing the other icon swaps straight over.
  const toggle = (which: Exclude<Menu, null>) => setMenu((now) => (now === which ? null : which));
  const close = () => setMenu(null);
  const onAdmin = pathname.startsWith("/admin");

  return (
    <div className={`flex min-h-screen flex-col bg-black text-white ${brand?.fontClass ?? ""}`} style={brand?.style}>
      {/* Banner, the full width of the screen */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-black px-3 sm:px-4">
        <LibraryButton open={menu === "library"} onClick={() => toggle("library")} className="md:hidden" />
        {brand ? (
          <Link href="/library" aria-label={`${brand.clinicName}, library home`} className="flex min-w-0 items-center rounded-lg">
            {/* The logo as it is, with no chip behind it. The box is a fixed size (wide, so a wordmark has room), which means a slow or broken logo moves nothing. Until the picture loads, and for good if there is none, the clinic's name stands in. */}
            <ClinicLogo
              src={brand.logoUrl}
              name={brand.clinicName}
              boxClassName="h-10 w-[150px] sm:w-[240px]"
              nameClassName="text-base font-semibold text-white"
            />
          </Link>
        ) : (
          <Link href="/library" className="flex items-center" aria-label="Pulse 3D, library home">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
            <img src={LOGO_URL} alt="Pulse 3D" className="h-7 w-auto" />
          </Link>
        )}
        {/* On a phone there is no rail, so the admin icon and the person's avatar ride here. */}
        <div className="ml-auto flex items-center gap-2 md:hidden">
          {showAdmin && <AdminButton open={menu === "admin"} active={onAdmin} onClick={() => toggle("admin")} />}
          <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
        </div>
      </header>

      <div className="flex min-w-0 flex-1">
        {/* Rail, tablet and up. It stays put under the banner while the page scrolls. */}
        <nav
          aria-label="Application"
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-16 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#07090b] py-3 md:flex"
        >
          <LibraryButton open={menu === "library"} onClick={() => toggle("library")} />
          {showAdmin && <AdminButton open={menu === "admin"} active={onAdmin} onClick={() => toggle("admin")} />}
          {/* Clerk's user button: the signed-in person's avatar, with Sign out in its menu. The box keeps the rail lined up while Clerk loads. */}
          <div className="mt-1 flex h-11 w-11 items-center justify-center">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </nav>

        {/* The open menu and its backdrop. On a tablet and up the backdrop leaves the banner and the rail uncovered, so the other icon can still be pressed. */}
        {menu && (
          <>
            <button
              type="button"
              aria-label="Close the menu"
              onClick={close}
              className="fixed inset-0 z-40 bg-black/60 md:left-16 md:top-14 lg:bg-black/25"
            />
            {menu === "library" ? (
              <CategoryMenu pathname={pathname} onClose={close} poweredBy={Boolean(brand)} />
            ) : (
              <AdminMenu pathname={pathname} onClose={close} />
            )}
          </>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

// The look of a rail icon, shared by both so the rail lines up.
const RAIL_BUTTON = "flex h-11 w-11 items-center justify-center rounded-xl transition";
const RAIL_ON = "bg-brand/20 text-brand-bright";
const RAIL_OFF = "text-[#bfbfbf] hover:bg-white/5 hover:text-white";

function LibraryButton({ open, onClick, className = "" }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="category-menu"
      aria-label={open ? "Close the library menu" : "Open the library menu"}
      title="Procedure Library"
      className={`${RAIL_BUTTON} ${open ? RAIL_ON : RAIL_OFF} ${className}`}
    >
      <BooksIcon className="h-6 w-6" />
    </button>
  );
}

/** The icon that opens the admin menu. Lit while the menu is open, and while the person is somewhere in the admin area. */
function AdminButton({ open, active, onClick }: { open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="admin-menu"
      aria-label={open ? "Close the admin menu" : "Open the admin menu"}
      title="Clinic admin"
      className={`${RAIL_BUTTON} ${open || active ? RAIL_ON : RAIL_OFF}`}
    >
      <AdminIcon className="h-6 w-6" />
    </button>
  );
}

// The look of the pull-out menus, shared by both.
const MENU_PANEL =
  "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/10 bg-[#0a0d0f] shadow-[8px_0_40px_rgba(0,0,0,.6)] md:left-16 md:top-14 md:w-64";
const MENU_ITEM = "flex h-12 items-center gap-3 rounded-lg border-l-2 px-3 text-base transition";
const MENU_ITEM_IDLE = "border-transparent text-[#bfbfbf] hover:bg-white/5 hover:text-white";
const MENU_ITEM_ACTIVE = "border-brand-bright bg-brand/15 font-medium text-white";

/** The title row at the top of a menu. The close button is for phones, where the menu covers the icon that opened it. */
function MenuHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between px-4">
      <p className="text-sm font-semibold uppercase tracking-wider text-[#667085]">{title}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-[#bfbfbf] hover:bg-white/5 hover:text-white md:hidden"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

function CategoryMenu({ pathname, onClose, poweredBy }: { pathname: string; onClose: () => void; poweredBy: boolean }) {
  const onHome = pathname === "/library";

  return (
    <aside id="category-menu" aria-label="Procedure categories" className={MENU_PANEL}>
      <MenuHeading title="Procedure Library" onClose={onClose} />

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <Link href="/library" onClick={onClose} aria-current={onHome ? "page" : undefined} className={`${MENU_ITEM} ${onHome ? MENU_ITEM_ACTIVE : MENU_ITEM_IDLE}`}>
          <HomeIcon className="h-5 w-5 shrink-0" />
          Home
        </Link>

        <p className="mt-5 mb-1 px-3 text-xs font-medium uppercase tracking-wider text-[#667085]">{CATEGORY_GROUP}</p>
        <ul className="flex flex-col gap-0.5">
          {CATEGORIES.map((c) => {
            const isActive = pathname === `/library/${c.slug}`;
            return (
              <li key={c.value}>
                <Link
                  href={`/library/${c.slug}`}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
                  className={`${MENU_ITEM} ${isActive ? MENU_ITEM_ACTIVE : MENU_ITEM_IDLE}`}
                >
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

/**
 * The admin menu: every section of the clinic admin area, from the same
 * list the row of tabs on the admin pages uses (lib/admin-nav.ts), with the
 * current one marked by the same rule. Navigation only: each admin page
 * checks on the server who may use it.
 */
function AdminMenu({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const current = activeAdminSection(pathname);

  return (
    <aside id="admin-menu" aria-label="Clinic admin menu" className={MENU_PANEL}>
      <MenuHeading title="Clinic admin" onClose={onClose} />

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="flex flex-col gap-0.5">
          {ADMIN_SECTIONS.map((section) => {
            const isActive = section.href === current;
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
                  className={`${MENU_ITEM} ${isActive ? MENU_ITEM_ACTIVE : MENU_ITEM_IDLE}`}
                >
                  {section.label}
                  {section.coming && <span className="ml-auto text-xs uppercase tracking-wider text-[#667085]">Coming</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
