"use client";

import type { Category } from "@prisma/client";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ADMIN_SECTIONS, activeAdminSection } from "@/lib/admin-nav";
import { CATEGORIES, CATEGORY_GROUP } from "@/lib/categories";
import { LOGO_URL } from "@/lib/brand";
import { FAVORITES_HREF } from "@/lib/library-rows";
import { ClinicLogo } from "./ClinicLogo";
import { AdminIcon, BooksIcon, CloseIcon, HeartIcon, HomeIcon } from "./icons";

/**
 * The frame around every staff-facing page: the library and the admin
 * console. (The patient page at /watch has no frame at all, on purpose.)
 * Laid out the way YouTube does it (decided by Evan on 2026-10-15), in
 * three widths:
 *
 *   - WIDE SCREENS (a computer, 1280px and up): a sidebar down the left with
 *     an icon and a label on every line: Home, My favorites, the categories
 *     on the clinic's plan (each with its initials in a small round badge),
 *     and Admin for admins. Clerk's user button (the signed-in person's
 *     avatar, with Sign out in its menu) sits at the right of the banner.
 *   - TABLETS (768px to 1279px): the narrow icon rail, each icon with a
 *     small label under it: Home, Favorites, Library (which pulls out the
 *     category menu), Admin (which pulls out the admin menu), and the
 *     avatar at the bottom.
 *   - PHONES: no rail. A Library button in the banner pulls out the same
 *     menu as a drawer; the admin icon and the avatar ride in the banner.
 *
 * A banner runs across the top at every width, with the clinic's own logo at
 * its left, as it is (no chip behind it; Van, 2026-09-21). Its box is wide,
 * so a wordmark can stretch out sideways. A clinic with no logo gets its name
 * there in words. The banner is the page's own colour with one hairline
 * under it, and 64px tall, the same as the rail is wide, so the corner where
 * they meet is square. A logo saved with a background of its own still shows
 * it; on the white light-mode banner a white one disappears, which is why
 * the Branding form says a white or pale logo suits Dark.
 *
 * The two pull-out menus (tablet and phone) float over the content, close
 * on outside click, Escape, or choosing something, and only one is open at
 * a time. The category menu lists Home, My favorites and the categories on
 * the plan; the admin menu every section of the admin area (lib/admin-nav).
 *
 * Which categories are listed is navigation only, so a courtesy: the plan's
 * categories (`categories`, from the clinic the server found for this
 * person). Without a clinic (a page drawn before the clinic is known) every
 * category is listed, as before. A category not on the plan is still reached
 * from "More categories" on the library home, and its page says it is not on
 * the plan.
 *
 * It is a client component only because the menus need open/closed state.
 * The page content arrives as children and stays server-rendered.
 *
 * The admin icon and the Admin line are shown only when showAdmin is true,
 * which the server sets for clinic admins. That is a courtesy so members
 * are not offered pages they cannot use; the admin pages check for themselves.
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
 * the sidebar and the category menu, small, as "Powered by".
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

/** Which pull-out menu is showing, if any. */
type Menu = "library" | "admin" | null;

/** A category as the navigation lists it. */
type NavCategory = (typeof CATEGORIES)[number];

export function AppShell({
  children,
  showAdmin = false,
  brand,
  categories,
}: {
  children: ReactNode;
  showAdmin?: boolean;
  brand?: ShellBrand;
  /** The categories on the clinic's plan, for the navigation. Left out, every category is listed. */
  categories?: Category[];
}) {
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
  const onHome = pathname === "/library";
  const listed = categories ? CATEGORIES.filter((c) => categories.includes(c.value)) : CATEGORIES;

  return (
    <div data-theme={brand?.theme ?? "dark"} className={`flex min-h-screen flex-col bg-ground text-ink ${brand?.fontClass ?? ""}`} style={brand?.style}>
      {/* Banner, the full width of the screen */}
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-ground px-3 sm:px-4 md:px-5">
        <MenuButton open={menu === "library"} onClick={() => toggle("library")} className="md:hidden" />
        {brand ? (
          <Link
            href="/library"
            aria-label={`${brand.clinicName}, library home`}
            className="flex min-w-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-bright"
          >
            {/* The logo as it is, with no chip behind it. The box is a fixed size (wide, so a wordmark has room), which means a slow or broken logo moves nothing. Until the picture loads, and for good if there is none, the clinic's name stands in. */}
            <ClinicLogo
              src={brand.logoUrl}
              name={brand.clinicName}
              boxClassName="h-11 w-[160px] sm:w-[260px]"
              nameClassName="text-lg font-semibold tracking-tight text-ink"
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
        {/* On a wide screen the sidebar has no room at its foot for the avatar, so it sits at the banner's right, as on YouTube. */}
        <div className="ml-auto hidden items-center xl:flex">
          <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
        </div>
      </header>

      <div className="flex min-w-0 flex-1">
        {/* The rail, tablets only: icons with small labels. It stays put under the banner while the page scrolls. */}
        <nav
          aria-label="Application"
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-sunken py-2 md:flex xl:hidden"
        >
          <RailLink href="/library" label="Home" active={onHome}>
            <HomeIcon className="h-6 w-6" />
          </RailLink>
          <RailLink href={FAVORITES_HREF} label="Favorites" active={false}>
            <HeartIcon className="h-6 w-6" />
          </RailLink>
          <RailButton label="Library" open={menu === "library"} onClick={() => toggle("library")} controls="category-menu">
            <BooksIcon className="h-6 w-6" />
          </RailButton>
          {showAdmin && (
            <RailButton label="Admin" open={menu === "admin" || onAdmin} onClick={() => toggle("admin")} controls="admin-menu">
              <AdminIcon className="h-6 w-6" />
            </RailButton>
          )}
          {/* Clerk's user button: the signed-in person's avatar, with Sign out in its menu. The box keeps the rail lined up while Clerk loads. */}
          <div className="mt-auto flex h-11 w-11 items-center justify-center">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </nav>

        {/* The sidebar, wide screens only: every line an icon and a label, YouTube-style. */}
        <nav
          aria-label="Library"
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 flex-col border-r border-line bg-sunken xl:flex"
        >
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <ul className="flex flex-col gap-0.5">
              <li>
                <SideLink href="/library" active={onHome} icon={<HomeIcon className="h-6 w-6" />}>
                  Home
                </SideLink>
              </li>
              <li>
                <SideLink href={FAVORITES_HREF} active={false} icon={<HeartIcon className="h-6 w-6" />}>
                  My favorites
                </SideLink>
              </li>
            </ul>

            {listed.length > 0 && (
              <>
                <p className="mt-4 border-t border-line px-3 pt-4 pb-1 text-sm font-semibold text-ink">{CATEGORY_GROUP}</p>
                <ul className="flex flex-col gap-0.5">
                  {listed.map((c) => (
                    <li key={c.value}>
                      <SideLink href={`/library/${c.slug}`} active={pathname === `/library/${c.slug}`} icon={<CategoryBadge category={c} />}>
                        {c.label}
                      </SideLink>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {showAdmin && (
              <ul className="mt-4 flex flex-col gap-0.5 border-t border-line pt-4">
                <li>
                  <SideLink href="/admin" active={onAdmin} icon={<AdminIcon className="h-6 w-6" />}>
                    Admin
                  </SideLink>
                </li>
              </ul>
            )}
          </div>
          {brand && <PoweredBy />}
        </nav>

        {/* The open menu and its backdrop (tablets and phones). On a tablet the backdrop leaves the banner and the rail uncovered, so the other icon can still be pressed. */}
        {menu && (
          <>
            <button
              type="button"
              aria-label="Close the menu"
              onClick={close}
              className="fixed inset-0 z-40 bg-black/60 md:left-16 md:top-16 lg:bg-black/25 xl:hidden"
            />
            {menu === "library" ? (
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
// The tablet rail: icons with a small label under each, at least 44px to tap.
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

/** The phone's Library button in the banner: opens the category drawer. */
function MenuButton({ open, onClick, className = "" }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="category-menu"
      aria-label={open ? "Close the library menu" : "Open the library menu"}
      title="Procedure Library"
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${open ? RAIL_ON : RAIL_OFF} ${className}`}
    >
      <BooksIcon className="h-6 w-6" />
    </button>
  );
}

/** The icon that opens the admin menu on a phone. Lit while the menu is open, and while the person is somewhere in the admin area. */
function AdminButton({ open, active, onClick }: { open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="admin-menu"
      aria-label={open ? "Close the admin menu" : "Open the admin menu"}
      title="Clinic admin"
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${open || active ? RAIL_ON : RAIL_OFF}`}
    >
      <AdminIcon className="h-6 w-6" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The wide sidebar and the pull-out menus share one look for a line.
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
      {/* Lazy: the wide sidebar is in every page's HTML but hidden below 1280px, and a lazy picture that is hidden is never
          fetched (nor preloaded by React), so a phone or a tablet does not download it for nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" loading="lazy" className="h-4 w-auto" />
    </p>
  );
}

// The look of the pull-out menus, shared by both.
const MENU_PANEL =
  "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-overlay shadow-drawer md:left-16 md:top-16 md:w-64 xl:hidden";

/** The title row at the top of a menu. The close button is for phones, where the menu covers the icon that opened it. */
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

function CategoryMenu({ pathname, categories, onClose, poweredBy }: { pathname: string; categories: NavCategory[]; onClose: () => void; poweredBy: boolean }) {
  return (
    <aside id="category-menu" aria-label="Procedure categories" className={MENU_PANEL}>
      <MenuHeading title="Procedure Library" onClose={onClose} />

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="flex flex-col gap-0.5">
          <li>
            <SideLink href="/library" onClick={onClose} active={pathname === "/library"} icon={<HomeIcon className="h-6 w-6" />}>
              Home
            </SideLink>
          </li>
          <li>
            <SideLink href={FAVORITES_HREF} onClick={onClose} active={false} icon={<HeartIcon className="h-6 w-6" />}>
              My favorites
            </SideLink>
          </li>
        </ul>

        {categories.length > 0 && (
          <>
            <p className="mt-4 border-t border-line px-3 pt-4 pb-1 text-sm font-semibold text-ink">{CATEGORY_GROUP}</p>
            <ul className="flex flex-col gap-0.5">
              {categories.map((c) => (
                <li key={c.value}>
                  <SideLink href={`/library/${c.slug}`} onClick={onClose} active={pathname === `/library/${c.slug}`} icon={<CategoryBadge category={c} />}>
                    {c.label}
                  </SideLink>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

      {/* When the banner carries the clinic's logo, Pulse 3D's own mark lives here, small. */}
      {poweredBy && <PoweredBy />}
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
