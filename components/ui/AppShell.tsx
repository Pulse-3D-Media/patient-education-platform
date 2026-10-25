"use client";

import type { Category } from "@prisma/client";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-nav";
import { CATEGORY_GROUP } from "@/lib/categories";
import { LOGO_URL } from "@/lib/brand";
import { SEARCH_MAX_LENGTH, SEARCH_PATH } from "@/lib/library-rows";
import { ClinicLogo } from "./ClinicLogo";
import { AdminIcon, ArrowLeftIcon, BooksIcon, CloseIcon, HomeIcon, MenuIcon, SearchIcon } from "./icons";

/**
 * The frame around every staff-facing page: the library and the admin
 * console. (The patient page at /watch has no frame at all, on purpose.)
 * Laid out the way YouTube does it (decided by Evan on 2026-10-15):
 *
 *   - THE TOP BAR, at every width: the menu button (three lines) and the
 *     clinic's logo at the left, and a "Search" box at the right that
 *     searches the whole library (/library/search; on a phone it is a
 *     magnifier that opens the box across the bar).
 *   - CLERK'S USER BUTTON (the signed-in person's avatar, with Sign out in
 *     its menu) at the foot of the rail, or of the full sidebar, as it
 *     always was. A phone has no rail, so there it rides in the top bar.
 *   - THE MENU BUTTON folds the sidebar away and brings it back, on every
 *     screen. On a wide screen (1280px and up) it switches between the full
 *     sidebar and the narrow rail, and the choice is remembered on that
 *     device (a convenience: browser storage, nothing on the server). On a
 *     tablet or a phone it slides the full sidebar out over the page.
 *   - THE FULL SIDEBAR: Home, the categories on the clinic's plan (each with
 *     its initials in a small round badge), and Admin for admins. Home is the
 *     library home, where "My favorites" is.
 *   - THE NARROW RAIL (a tablet, or a wide screen with the sidebar folded):
 *     Home, Library (which pulls out the list of categories) and Admin
 *     (which pulls out the admin sections), each icon with a small label.
 *     A phone has no rail.
 *
 * The clinic's logo sits on the bar as it is (no chip behind it; Van,
 * 2026-09-21), in a box of fixed size, with the clinic's name standing in
 * when there is none. The bar is the page's own colour with one hairline
 * under it, 64px tall, the same as the rail is wide. A logo saved with a
 * background of its own still shows it; on the white light-mode bar a
 * white one disappears, which is why the Branding form says a white or
 * pale logo suits Dark.
 *
 * The pull-outs float over the content, close on outside click, Escape, or
 * choosing something, and only one is open at a time.
 *
 * Which categories are listed is navigation only, so a courtesy: the plan's
 * categories (`categories`, from the clinic the server found for this
 * person). Without a clinic (a page drawn before the clinic is known) every
 * category is listed. A category not on the plan is still reached from
 * "More categories" on the library home, and its page says it is not on
 * the plan. The search box is plain HTML (a form that asks for
 * /library/search?q=...), so it works before the page has woken up; the
 * results page decides on the server what the clinic may see.
 *
 * It is a client component only because the pull-outs and the fold need
 * state. The page content arrives as children and stays server-rendered.
 *
 * The Admin line and icon are shown only when showAdmin is true, which the
 * server sets for clinic admins. That is a courtesy so members are not
 * offered pages they cannot use; the admin pages check for themselves.
 *
 * THE CLINIC'S BRANDING arrives as `brand`, already worked out and checked
 * on the server (ClinicShell, app/brand-look.ts): the colours as CSS
 * variables and the font's class, both set on the outermost element so
 * every page inside picks them up, plus the clinic's name and logo. Without
 * it the shell is the plain Pulse 3D one, in dark.
 *
 * LIGHT OR DARK is the clinic's saved choice and arrives the same way. It
 * becomes the data-theme attribute on the outermost element, and that is
 * all it takes: every colour inside is a named token (app/globals.css) with
 * a dark value and a light one. The server writes the attribute, so there
 * is no flash of the wrong mode. Pulse 3D's own mark sits at the foot of
 * the sidebar and the category pull-out, small, as "Powered by".
 */

/** One clinic's look, as plain values the server has already checked. */
export type ShellBrand = {
  /** The brand colours, as CSS variables. */
  style: CSSProperties;
  /** The class that sets the clinic's font. Empty for Inter. */
  fontClass: string;
  /** Light or dark, the clinic's saved choice. Written into the page by the server, so the first paint is already right. */
  theme: "dark" | "light";
  clinicName: string;
  logoUrl: string | null;
};

/** Which pull-out is showing, if any: the full sidebar slid over the page, the categories, or the admin sections. */
type Menu = "guide" | "library" | "admin" | null;

/** A category as the navigation lists it: its current name and address, from the server (getCategoryList()). */
export type NavCategory = { value: Category; label: string; slug: string };

/** Where this device remembers that the wide sidebar was folded. Only a convenience: losing it unfolds the sidebar. */
const FOLD_KEY = "p3-sidebar";

/** The width from which the full sidebar is shown (Tailwind's xl). Below it the menu button slides the sidebar out instead. */
const WIDE_QUERY = "(min-width: 1280px)";

export function AppShell({
  children,
  showAdmin = false,
  brand,
  categories,
}: {
  children: ReactNode;
  showAdmin?: boolean;
  brand?: ShellBrand;
  /** The categories on the clinic's plan, for the navigation, in list order with their current names. Left out, none is listed. */
  categories?: NavCategory[];
}) {
  const [menu, setMenu] = useState<Menu>(null);
  /** The wide sidebar folded down to the rail. Starts unfolded; the device's saved choice is read once the page is awake. */
  const [folded, setFolded] = useState(false);
  /** The phone's search box, open across the top bar. */
  const [searching, setSearching] = useState(false);
  const pathname = usePathname();

  // The choice this device made last time. Read after the first paint, because the server cannot know it.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(FOLD_KEY);
    } catch {
      // Storage blocked (a private window): the sidebar simply starts unfolded.
    }
    if (saved === "rail") {
      const timer = window.setTimeout(() => setFolded(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!menu && !searching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setSearching(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, searching]);

  // Pressing a rail icon opens its pull-out, pressing it again closes it, and pressing the other swaps straight over.
  const toggle = (which: Exclude<Menu, null>) => setMenu((now) => (now === which ? null : which));
  const close = () => setMenu(null);

  /** The menu button: fold or unfold the wide sidebar, or slide the sidebar out on a smaller screen. */
  function pressMenu() {
    if (window.matchMedia(WIDE_QUERY).matches) {
      const next = !folded;
      setFolded(next);
      setMenu(null);
      try {
        window.localStorage.setItem(FOLD_KEY, next ? "rail" : "full");
      } catch {
        // Not remembered; it still folds for now.
      }
    } else {
      toggle("guide");
    }
  }

  const onAdmin = pathname.startsWith("/admin");
  const onHome = pathname === "/library";
  const listed = categories ?? [];

  const logo = brand ? (
    <Link
      href="/library"
      aria-label={`${brand.clinicName}, library home`}
      className="flex min-w-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-bright"
    >
      {/* The logo as it is, with no chip behind it. The box is a fixed size (wide, so a wordmark has room), which means a slow or broken logo moves nothing. Until the picture loads, and for good if there is none, the clinic's name stands in. */}
      <ClinicLogo src={brand.logoUrl} name={brand.clinicName} boxClassName="h-11 w-[140px] sm:w-[180px] lg:w-[240px]" nameClassName="text-lg font-semibold tracking-tight text-ink" />
    </Link>
  ) : (
    <Link href="/library" className="flex items-center" aria-label="Pulse 3D, library home">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="h-7 w-auto" />
    </Link>
  );

  return (
    <div data-theme={brand?.theme ?? "dark"} className={`flex min-h-screen flex-col bg-ground text-ink ${brand?.fontClass ?? ""}`} style={brand?.style}>
      {/* The top bar, the full width of the screen */}
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-ground px-3 sm:px-4">
        <MenuButton open={menu === "guide"} onClick={pressMenu} />
        {logo}
        {/* The search box at the right of the bar, from a small tablet up (Evan, 2026-10-15). */}
        <div className="hidden min-w-0 flex-1 justify-end pl-4 sm:flex">
          <SearchForm pathname={pathname} />
        </div>
        {/* A phone has no rail, so the magnifier and the person's avatar ride in the bar there. */}
        <div className="ml-auto flex items-center gap-1 sm:ml-0 md:hidden">
          {/* On a phone the box would not fit beside the logo, so a magnifier opens it across the bar. */}
          <button
            type="button"
            onClick={() => setSearching(true)}
            aria-label="Search the library"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-wash hover:text-ink sm:hidden"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <div className="flex h-11 w-11 items-center justify-center">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </div>
        {searching && (
          <div className="absolute inset-0 z-10 flex items-center gap-2 bg-ground px-3 sm:hidden">
            <button
              type="button"
              onClick={() => setSearching(false)}
              aria-label="Close the search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-wash hover:text-ink"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <SearchForm pathname={pathname} autoFocus />
          </div>
        )}
      </header>

      <div className="flex min-w-0 flex-1">
        {/* The narrow rail: tablets, and a wide screen with the sidebar folded. Icons with small labels. It stays put while the page scrolls. */}
        <nav
          aria-label="Application"
          className={`sticky top-16 hidden h-[calc(100vh-4rem)] w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-sunken py-2 md:flex ${folded ? "" : "xl:hidden"}`}
        >
          <RailLink href="/library" label="Home" active={onHome}>
            <HomeIcon className="h-6 w-6" />
          </RailLink>
          <RailButton label="Library" open={menu === "library"} onClick={() => toggle("library")} controls="category-menu">
            <BooksIcon className="h-6 w-6" />
          </RailButton>
          {showAdmin && (
            <RailButton label="Admin" open={menu === "admin" || onAdmin} onClick={() => toggle("admin")} controls="admin-menu">
              <AdminIcon className="h-6 w-6" />
            </RailButton>
          )}
          {/* Clerk's user button at the foot of the rail, as it always was: the signed-in person's avatar, with Sign out in its menu. The box keeps the rail lined up while Clerk loads. */}
          <div className="mt-auto flex h-11 w-11 items-center justify-center">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </nav>

        {/* The full sidebar, on a wide screen while it is not folded: every line an icon and a label, YouTube-style. */}
        <nav aria-label="Library" className={`sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 flex-col border-r border-line bg-sunken ${folded ? "" : "xl:flex"}`}>
          <Guide pathname={pathname} categories={listed} showAdmin={showAdmin} />
          {/* The same avatar at the foot of the full sidebar, lined up with where it sits on the rail. */}
          <div className="flex h-14 shrink-0 items-center border-t border-line px-[1.375rem]">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
          {brand && <PoweredBy />}
        </nav>

        {/* The open pull-out and its backdrop. Beside the rail, the backdrop leaves the top bar and the rail uncovered, so another icon can still be pressed. */}
        {menu && (
          <>
            <button
              type="button"
              aria-label="Close the menu"
              onClick={close}
              className={`fixed inset-0 z-40 bg-black/60 lg:bg-black/25 ${menu === "guide" ? "" : "md:left-16 md:top-16"}`}
            />
            {menu === "guide" ? (
              <aside id="guide-menu" aria-label="Library" className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-overlay shadow-drawer">
                <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-3">
                  <MenuButton open onClick={close} />
                  {logo}
                </div>
                <Guide pathname={pathname} categories={listed} showAdmin={showAdmin} onChoose={close} />
                {brand && <PoweredBy />}
              </aside>
            ) : menu === "library" ? (
              <CategoryMenu pathname={pathname} categories={listed} onClose={close} poweredBy={Boolean(brand)} />
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

// ---------------------------------------------------------------------------
// The top bar's pieces.
// ---------------------------------------------------------------------------

/** The three-line menu button. */
function MenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? "Close the menu" : "Show or hide the menu"}
      title="Menu"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink"
    >
      <MenuIcon className="h-6 w-6" />
    </button>
  );
}

/**
 * The search box: one word, "Search", and a magnifier button. A plain form
 * that opens /library/search?q=..., so it works even before the page has
 * woken up. On the results page it shows what was searched for.
 */
function SearchForm({ pathname, autoFocus = false }: { pathname: string; autoFocus?: boolean }) {
  const box = useRef<HTMLInputElement>(null);

  // Keep what was searched for in the box on the results page, and empty it everywhere else.
  useEffect(() => {
    const input = box.current;
    if (!input) return;
    input.value = pathname === SEARCH_PATH ? (new URLSearchParams(window.location.search).get("q") ?? "") : "";
  }, [pathname]);

  return (
    <form action={SEARCH_PATH} method="get" role="search" className="flex w-full max-w-xl">
      <input
        ref={box}
        type="search"
        name="q"
        required
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="Search"
        aria-label="Search the library"
        autoFocus={autoFocus}
        autoComplete="off"
        className="h-10 min-w-0 flex-1 rounded-l-full border border-line-strong bg-field px-4 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="flex h-10 w-14 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line-strong bg-wash text-ink-soft hover:bg-wash-strong hover:text-ink"
      >
        <SearchIcon className="h-5 w-5" />
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The narrow rail: icons with a small label under each, at least 44px to tap.
// ---------------------------------------------------------------------------

const RAIL_ITEM = "flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium leading-none transition";
const RAIL_ON = "bg-wash-strong text-ink";
const RAIL_OFF = "text-ink-soft hover:bg-wash hover:text-ink";

function RailLink({ href, label, active, children }: { href: string; label: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${RAIL_ITEM} ${active ? RAIL_ON : RAIL_OFF}`}>
      {children}
      {label}
    </Link>
  );
}

function RailButton({ label, open, onClick, controls, children }: { label: string; open: boolean; onClick: () => void; controls: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-controls={controls} className={`${RAIL_ITEM} ${open ? RAIL_ON : RAIL_OFF}`}>
      {children}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The full sidebar and the pull-outs share one look for a line.
// ---------------------------------------------------------------------------

const LINE = "flex min-h-11 items-center gap-4 rounded-xl px-3 text-base transition";
const LINE_IDLE = "text-ink-soft hover:bg-wash hover:text-ink";
const LINE_ACTIVE = "bg-wash-strong font-medium text-ink";

function SideLink({ href, active, icon, onClick, children }: { href: string; active: boolean; icon: ReactNode; onClick?: () => void; children: ReactNode }) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={`${LINE} ${active ? LINE_ACTIVE : LINE_IDLE}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

/** The full sidebar's lines: Home, the plan's categories, Admin for admins. Used on a wide screen and slid out on a smaller one. */
function Guide({ pathname, categories, showAdmin, onChoose }: { pathname: string; categories: NavCategory[]; showAdmin: boolean; onChoose?: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <SideLink href="/library" onClick={onChoose} active={pathname === "/library"} icon={<HomeIcon className="h-6 w-6" />}>
        Home
      </SideLink>

      {categories.length > 0 && (
        <>
          <p className="mt-4 border-t border-line px-3 pt-4 pb-1 text-sm font-semibold text-ink">{CATEGORY_GROUP}</p>
          <CategoryLines pathname={pathname} categories={categories} onChoose={onChoose} />
        </>
      )}

      {showAdmin && (
        <div className="mt-4 border-t border-line pt-4">
          <SideLink href="/admin" onClick={onChoose} active={pathname.startsWith("/admin")} icon={<AdminIcon className="h-6 w-6" />}>
            Admin
          </SideLink>
        </div>
      )}
    </div>
  );
}

function CategoryLines({ pathname, categories, onChoose }: { pathname: string; categories: NavCategory[]; onChoose?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {categories.map((c) => (
        <li key={c.value}>
          <SideLink href={`/library/${c.slug}`} onClick={onChoose} active={pathname === `/library/${c.slug}`} icon={<CategoryBadge category={c} />}>
            {c.label}
          </SideLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * A category's initials in a small round badge ("OS" for Orthopedic Spine,
 * "FA" for Foot & Ankle), where YouTube puts a channel's picture. Letters,
 * not the category's picture: the pictures are large stills, and the
 * sidebar is on every page.
 */
function CategoryBadge({ category }: { category: NavCategory }) {
  const initials = category.label
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  return (
    <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-bright">
      {initials}
    </span>
  );
}

function PoweredBy() {
  return (
    <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
      Powered by
      {/* Lazy: the full sidebar is in every page's HTML but hidden on smaller screens, and a lazy picture that is hidden is
          never fetched (nor preloaded by React), so a phone or a tablet does not download it for nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" loading="lazy" className="h-4 w-auto" />
    </p>
  );
}

// The look of the rail's pull-outs, shared by both.
const MENU_PANEL = "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-overlay shadow-drawer md:left-16 md:top-16 md:w-64";

/** The title row at the top of a pull-out. */
function MenuHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between px-4">
      <p className="text-sm font-semibold uppercase tracking-wider text-ink-muted">{title}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-wash hover:text-ink md:hidden"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

/** The rail's Library pull-out: just the categories on the plan. Home is on the rail itself. */
function CategoryMenu({ pathname, categories, onClose, poweredBy }: { pathname: string; categories: NavCategory[]; onClose: () => void; poweredBy: boolean }) {
  return (
    <aside id="category-menu" aria-label="Procedure categories" className={MENU_PANEL}>
      <MenuHeading title={CATEGORY_GROUP} onClose={onClose} />
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <CategoryLines pathname={pathname} categories={categories} onChoose={onClose} />
      </nav>
      {/* When the top bar carries the clinic's logo, Pulse 3D's own mark lives here, small. */}
      {poweredBy && <PoweredBy />}
    </aside>
  );
}

/**
 * The admin pull-out: every section of the clinic admin area, from the same
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
                  className={`${LINE} ${isActive ? LINE_ACTIVE : LINE_IDLE}`}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
