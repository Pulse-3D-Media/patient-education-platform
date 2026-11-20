"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_BRAND_THEME } from "@/lib/branding";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { SEARCH_MAX_LENGTH, SEARCH_PATH } from "@/lib/library-rows";
import type { SetupReminder } from "@/lib/setup";
import { ClinicLogo } from "./ClinicLogo";
import { AccountButton } from "./AccountButton";
import { SideRail, useRail, type NavCategory } from "./SideRail";
import { TourHost } from "@/components/tour/TourHost";
import { ArrowLeftIcon, MenuIcon, SearchIcon } from "./icons";

export type { NavCategory } from "./SideRail";

/**
 * The frame around every staff-facing page of a clinic: the library AND the
 * admin pages, the same frame on both since Evan's notes of 2026-11-20.
 * (The patient page at /watch has no frame at all, on purpose, and the
 * Pulse 3D dashboard has its own, PulseShell.)
 *
 *   - THE TOP BAR, at every width: the clinic's logo at the left (it leads
 *     to the library home), and a "Search" box at the right that searches
 *     the whole library (/library/search; on a phone it is a magnifier that
 *     opens the box across the bar).
 *   - THE SIDE RAIL down the left (SideRail.tsx): the three lines at its top,
 *     then Home, Library and Admin as icons, and the signed-in person at the
 *     foot. It opens into the full menu over the page: with a mouse when the
 *     pointer rests on it, with touch from the three lines, with the keyboard
 *     when the focus moves in. A phone has no rail: the three lines and the
 *     person's avatar ride in the top bar there, and the menu slides out.
 *   - `phoneNav`, under the top bar on a phone only: the admin pages draw
 *     their row of section pills there, so every admin page is one thumb away.
 *
 * The clinic's logo sits on the bar as it is (no chip behind it; Van,
 * 2026-09-21), in a box of fixed size, with the clinic's name standing in
 * when there is none. The bar is the page's own colour with one hairline
 * under it, 64px tall, the same as the rail is wide. A logo saved with a
 * background of its own still shows it; on the white light-mode bar a
 * white one disappears, which is why the Branding form says a white or
 * pale logo suits Dark.
 *
 * NOTHING MOVES: the rail is fixed to the left edge and the page keeps a
 * 64px margin for it from a tablet up, both drawn by the server, so the
 * first paint is final and opening the rail lays it over the page.
 *
 * Which categories are listed is navigation only, so a courtesy: the plan's
 * categories (`categories`, from the clinic the server found for this
 * person). A category not on the plan is still reached from "More
 * categories" on the library home, and its page says it is not on the plan.
 * The search box is plain HTML (a form that asks for /library/search?q=...),
 * so it works before the page has woken up; the results page decides on the
 * server what the clinic may see.
 *
 * The Admin heading and its pages are shown only when showAdmin is true,
 * which the server sets for clinic admins. That is a courtesy so members are
 * not offered pages they cannot use; the admin pages check for themselves.
 *
 * THE CLINIC'S BRANDING arrives as `brand`, already worked out and checked
 * on the server (ClinicShell, app/brand-look.ts): the colours as CSS
 * variables and the font's class, both set on the outermost element so
 * every page inside picks them up, plus the clinic's name and logo. Without
 * it the shell is the plain Pulse 3D one, in light (the staff screens'
 * default since 2026-11-18), in the staff fonts with Schibsted Grotesk
 * headings ("staff-headings"; a clinic's own font replaces both).
 *
 * LIGHT OR DARK is the clinic's saved choice and arrives the same way. It
 * becomes the data-theme attribute on the outermost element, and that is
 * all it takes: every colour inside is a named token (app/globals.css) with
 * a dark value and a light one. The server writes the attribute, so there
 * is no flash of the wrong mode.
 *
 * THE QUICK TOUR (components/tour): the rail's categories and admin pages,
 * the phone's three lines and the search carry data-tour attributes so its
 * stops can find them, the account menu has "Take the tour", and TourHost at
 * the end draws nothing (and loads none of the tour's code) unless the
 * address asks for the tour.
 *
 * It is a client component only because the rail and the phone's search box
 * need state. The page content arrives as children and stays server-rendered.
 */

/** One clinic's look, as plain values the server has already checked. */
export type ShellBrand = {
  /** The brand colours, as CSS variables. */
  style: CSSProperties;
  /** The class that sets the clinic's font. Empty for the default (the staff fonts, app/staff-fonts.ts). */
  fontClass: string;
  /** Light or dark, the clinic's saved choice. Written into the page by the server, so the first paint is already right. */
  theme: "dark" | "light";
  clinicName: string;
  logoUrl: string | null;
};

export function AppShell({
  children,
  showAdmin = false,
  brand,
  categories,
  setup = null,
  phoneNav,
}: {
  children: ReactNode;
  showAdmin?: boolean;
  brand?: ShellBrand;
  /** "Finish setup" and how far it has got, for an office admin while their clinic's setup is under way; null for everyone else (members never see it). Decided on the server (ClinicShell). */
  setup?: SetupReminder | null;
  /** The categories on the clinic's plan, for the navigation, in list order with their current names. Left out, none is listed. */
  categories?: NavCategory[];
  /** Drawn under the top bar on a phone only (the admin pages' row of section pills). */
  phoneNav?: ReactNode;
}) {
  const pathname = usePathname();
  const rail = useRail(pathname);
  /** The phone's search box, open across the top bar. */
  const [searching, setSearching] = useState(false);
  const phoneMenuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!searching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearching(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching]);

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
      {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
      <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="h-10 w-auto" />
    </Link>
  );

  /** The phone's three lines: slide the menu out (and put the keyboard's focus in it), or close it. */
  function pressPhoneMenu() {
    const opening = rail.mode === null;
    rail.send({ kind: "menu-pressed" });
    if (opening) window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#side-rail button")?.focus({ preventScroll: true }));
  }

  return (
    <div data-theme={brand?.theme ?? DEFAULT_BRAND_THEME} className={`flex min-h-screen flex-col bg-ground text-ink ${brand?.fontClass || "staff-headings"}`} style={brand?.style}>
      {/* The top bar, the full width of the screen. From a tablet up its left 64px sit under the rail's three lines. */}
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-ground px-3 sm:px-4 md:pl-20">
        {/* A phone has no rail, so its three lines are here. */}
        <button
          ref={phoneMenuButton}
          type="button"
          onClick={pressPhoneMenu}
          aria-expanded={rail.mode !== null}
          aria-controls="side-rail"
          aria-label="Open the menu"
          title="Menu"
          // On a phone, the tour's first stop points here, since the categories are inside this menu.
          data-tour="menu"
          data-tour-name="Menu, with the procedure categories"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink md:hidden"
        >
          <MenuIcon className="h-6 w-6" />
        </button>
        {logo}
        {/* The search box at the right of the bar, from a small tablet up (Evan, 2026-10-15). */}
        <div className="hidden min-w-0 flex-1 justify-end pl-4 sm:flex">
          <SearchForm pathname={pathname} tourTarget />
        </div>
        {/* A phone has no rail, so the magnifier and the person's avatar ride in the bar there. */}
        <div className="ml-auto flex items-center gap-1 sm:ml-0 md:hidden">
          {/* On a phone the box would not fit beside the logo, so a magnifier opens it across the bar. */}
          <button
            type="button"
            onClick={() => setSearching(true)}
            aria-label="Search the library"
            data-tour="search"
            data-tour-name="Search"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-wash hover:text-ink sm:hidden"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <div className="flex h-11 w-11 items-center justify-center">
            <AccountButton tour appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
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

      {phoneNav && <div className="md:hidden">{phoneNav}</div>}

      <SideRail
        rail={rail}
        pathname={pathname}
        logo={logo}
        categories={categories ?? []}
        showAdmin={showAdmin}
        setup={setup}
        poweredBy={Boolean(brand)}
        phoneMenuButton={phoneMenuButton}
      />

      {/* The page, with room kept for the rail from a tablet up. */}
      <div className="min-w-0 flex-1 md:pl-16">{children}</div>

      {/* The quick tour: draws nothing, and loads none of its code, unless the address asks for it (components/tour). */}
      <TourHost isAdmin={showAdmin} />
    </div>
  );
}

/**
 * The search box: one word, "Search", and a magnifier button. A plain form
 * that opens /library/search?q=..., so it works even before the page has
 * woken up. On the results page it shows what was searched for.
 */
function SearchForm({ pathname, autoFocus = false, tourTarget = false }: { pathname: string; autoFocus?: boolean; tourTarget?: boolean }) {
  const box = useRef<HTMLInputElement>(null);

  // Keep what was searched for in the box on the results page, and empty it everywhere else.
  useEffect(() => {
    const input = box.current;
    if (!input) return;
    input.value = pathname === SEARCH_PATH ? (new URLSearchParams(window.location.search).get("q") ?? "") : "";
  }, [pathname]);

  return (
    <form
      action={SEARCH_PATH}
      method="get"
      role="search"
      className="flex w-full max-w-xl"
      // What the tour's first stop highlights (components/tour). The phone's copy, opened from the magnifier, is not.
      data-tour={tourTarget ? "search" : undefined}
      data-tour-name={tourTarget ? "Search" : undefined}
    >
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
