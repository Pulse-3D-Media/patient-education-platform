"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type FocusEvent } from "react";
import { ADMIN_SECTIONS, activeAdminSection, type AdminSection } from "@/lib/admin-nav";
import { CATEGORY_GROUP, type Category } from "@/lib/categories";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import {
  HOVER_QUERY,
  RAIL_CLOSE_DELAY_MS,
  RAIL_OPEN_DELAY_MS,
  RAIL_OPEN_EVENT,
  RAIL_QUERY,
  aVideoIsPlaying,
  nextRailMode,
  type RailEvent,
  type RailMode,
} from "@/lib/rail";
import type { SetupReminder } from "@/lib/setup";
import { TourNotice } from "@/components/tour/TourNotice";
import { AccountButton } from "./AccountButton";
import { AdminIcon, BooksIcon, CardIcon, ClockIcon, HomeIcon, LinkIcon, MenuIcon, PaletteIcon, PeopleIcon } from "./icons";

/**
 * THE SIDE RAIL (Evan, 2026-11-20): one rail, the same on the library and on
 * the admin pages.
 *
 * AT REST it is the narrow strip of icons down the left: the three lines at
 * the top, then Home, Library and Admin (Admin only for office admins), the
 * "Finish setup" clock while an admin's setup is under way, "Take the tour"
 * until this browser has started the tour, and the signed-in person's
 * picture at the foot. A phone has no strip: the three lines in its top bar
 * slide the menu out.
 *
 * OPEN, it is the full menu, laid OVER the page, so nothing underneath moves:
 * the three lines and the clinic's logo; Home; Library with the specialty
 * ("Orthopedic Surgery") under it and the clinic's categories; Admin with
 * the admin pages, for office admins; the setup card; "Take the tour"; the
 * person's picture and name; and "Powered by Pulse 3D" at the foot.
 *
 * HOW IT OPENS AND CLOSES is in lib/rail.ts (nextRailMode): with a mouse it
 * opens when the pointer rests on it and closes when the pointer leaves, a
 * moment later each way; with touch only the three lines open it and a tap
 * outside closes it; with the keyboard it opens when the focus moves in and
 * Escape closes it. It never opens on hover over a video that is playing.
 *
 * ONE ELEMENT, TWO LOOKS: the narrow strip and the full menu are the same
 * links and buttons, restyled, so the keyboard's focus stays put when it
 * opens. What only the full menu has (the logo, the categories, the admin
 * pages) is added when it opens; the server draws the strip, so the first
 * paint is already right and nothing shifts while the page wakes.
 *
 * NAVIGATION ONLY. Which links are listed is a courtesy: the plan's
 * categories, and Admin for an admin. Every page decides on the server who
 * may see it; a link shown here grants nothing, and a link left out protects
 * nothing.
 *
 * THE TOUR (components/tour) finds the categories and the admin pages by
 * their data-tour attributes. It asks for the rail to be opened at the stops
 * that point into it (RAIL_OPEN_EVENT); the strip's Library icon stands in
 * for the categories while the rail is closed.
 */

/** A category as the navigation lists it: its current name and address, from the server (getCategoryList()). */
export type NavCategory = { value: Category; label: string; slug: string };

/** The rail's state: how it was opened, and on which page (a new page closes it, without an effect to do so). */
type RailState = { mode: RailMode | null; path: string };

/**
 * The rail's open-or-closed state, kept by the shell (AppShell) because the
 * phone's three lines sit in the top bar, outside the rail.
 */
export function useRail(pathname: string) {
  const [state, setState] = useState<RailState>({ mode: null, path: pathname });
  // Open only on the page it was opened on: following a link closes it.
  const mode = state.path === pathname ? state.mode : null;
  const send = useCallback(
    (event: RailEvent) =>
      setState((now) => ({ mode: nextRailMode(now.path === pathname ? now.mode : null, event), path: pathname })),
    [pathname],
  );
  return { mode, send };
}

export type Rail = ReturnType<typeof useRail>;

/** True when the screen is wide enough to have the narrow strip (a phone has none). */
function hasStrip() {
  return window.matchMedia(RAIL_QUERY).matches;
}

/** True when an element is the keyboard's focus (not one a tap or a click gave focus to). */
function focusedByKeyboard(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** True while Clerk's account menu is open (it may be drawn outside the rail), so the rail does not close under it. */
function accountMenuIsOpen() {
  return document.querySelector(".cl-userButtonPopoverCard") !== null;
}

/** Each admin page's icon. */
const ADMIN_ICONS: Record<AdminSection["href"], ReactNode> = {
  "/admin": <HomeIcon className="h-5 w-5" />,
  "/admin/links": <LinkIcon className="h-5 w-5" />,
  "/admin/people": <PeopleIcon className="h-5 w-5" />,
  "/admin/branding": <PaletteIcon className="h-5 w-5" />,
  "/admin/billing": <CardIcon className="h-5 w-5" />,
};

export function SideRail({
  rail,
  pathname,
  logo,
  categories,
  showAdmin,
  setup,
  poweredBy,
  phoneMenuButton,
}: {
  rail: Rail;
  pathname: string;
  /** The clinic's logo (or Pulse 3D's), shown beside the three lines when the rail is open. */
  logo: ReactNode;
  categories: NavCategory[];
  showAdmin: boolean;
  setup: SetupReminder | null;
  /** True when the top bar carries the clinic's logo, so Pulse 3D's own mark sits at the foot of the open rail. */
  poweredBy: boolean;
  /** The phone's three lines in the top bar, which gets the focus back when the menu closes on a phone. */
  phoneMenuButton: RefObject<HTMLButtonElement | null>;
}) {
  const { mode, send } = rail;
  const open = mode !== null;
  const nav = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  /** After the rail was closed on purpose (the three lines, Escape, a link) while the mouse is on it: it stays closed until the pointer leaves. */
  const holdShut = useRef(false);
  /** After Escape moved the focus to the three lines: that focus does not reopen it. */
  const holdFocus = useRef(false);

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };

  // No timer outlives the rail.
  useEffect(() => clearTimers, []);

  /** Closes the rail and, when it was a phone's slide-out menu holding the focus, gives the focus back to the top bar's three lines. */
  const dismiss = useCallback(() => {
    const focusInside = nav.current?.contains(document.activeElement) ?? false;
    send({ kind: "dismissed" });
    if (focusInside) {
      if (hasStrip()) {
        holdFocus.current = true;
        menuButton.current?.focus({ preventScroll: true });
      } else {
        phoneMenuButton.current?.focus({ preventScroll: true });
      }
    }
  }, [send, phoneMenuButton]);

  // Escape closes it, however it was opened.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      holdShut.current = true;
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  // Opened by the tour: a press anywhere outside it closes it (the tour's own buttons included).
  useEffect(() => {
    if (mode !== "tour") return;
    const onPress = (event: Event) => {
      if (event.target instanceof Node && nav.current?.contains(event.target)) return;
      send({ kind: "dismissed" });
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [mode, send]);

  // The tour asks for the rail to be opened at a stop that points into it. A phone has no rail; there the tour points at the top bar's three lines.
  useEffect(() => {
    const onAsk = () => {
      if (hasStrip()) send({ kind: "tour-asked" });
    };
    window.addEventListener(RAIL_OPEN_EVENT, onAsk);
    return () => window.removeEventListener(RAIL_OPEN_EVENT, onAsk);
  }, [send]);

  // ---- The mouse: open after a short rest, close a moment after it leaves. Touch and pen never open it this way.
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !window.matchMedia(HOVER_QUERY).matches) return;
    window.clearTimeout(closeTimer.current);
    if (open || holdShut.current) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      // Never over a video that is playing: its controls stay uncovered. The three lines still open it.
      if (aVideoIsPlaying(document.querySelectorAll("video"))) return;
      send({ kind: "pointer-rested" });
    }, RAIL_OPEN_DELAY_MS);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    holdShut.current = false;
    clearTimers();
    const closeSoon = () => {
      closeTimer.current = window.setTimeout(() => {
        if (accountMenuIsOpen()) closeSoon();
        else send({ kind: "pointer-left" });
      }, RAIL_CLOSE_DELAY_MS);
    };
    closeSoon();
  };

  // ---- The keyboard: focus moving in opens it; focus moving out to something else on the page closes it.
  const onFocus = (event: FocusEvent) => {
    if (holdFocus.current || !focusedByKeyboard(event.target)) return;
    send({ kind: "keyboard-focus-in" });
  };

  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget;
    // Focus going nowhere (a tap on a plain part of the menu, or the window losing focus) is not leaving.
    if (!(next instanceof Node) || nav.current?.contains(next)) return;
    holdFocus.current = false;
    send({ kind: "focus-left" });
  };

  // ---- Choosing a link closes the rail at once (and keeps it shut while the mouse is still on it).
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest("a")) return;
    holdShut.current = true;
    clearTimers();
    send({ kind: "dismissed" });
  };

  const pressMenu = () => {
    if (open) holdShut.current = true;
    clearTimers();
    send({ kind: "menu-pressed" });
  };

  const onHome = pathname === "/library";
  const inLibrary = pathname.startsWith("/library/");
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const currentAdmin = activeAdminSection(pathname);

  return (
    <>
      {/* Opened by a tap or a click: the page behind is shaded, and a tap on it closes the menu without pressing what is under it. */}
      {mode === "pinned" && (
        <button type="button" aria-label="Close the menu" tabIndex={-1} onClick={dismiss} className="fixed inset-0 z-[35] cursor-default bg-black/60 md:bg-black/25" />
      )}
      <nav
        ref={nav}
        id="side-rail"
        aria-label="Menu"
        data-rail={open ? "open" : "closed"}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
        // Fixed to the left edge, over the page: opening it moves nothing underneath. The page keeps a 64px margin for the strip (AppShell).
        className={`group/rail fixed inset-y-0 left-0 z-40 overflow-hidden transition-[width] duration-150 ease-out motion-reduce:transition-none ${
          open ? "flex w-72 border-r border-line bg-overlay shadow-drawer" : "hidden w-16 md:flex"
        }`}
      >
        {/* The content keeps its final width, and the rail's edge reveals it as it opens. */}
        <div className={`flex h-full shrink-0 flex-col ${open ? "w-72" : "w-16"}`}>
          {/* The three lines at the top of the rail, above the icons, in line with the top bar. Spaced so that neither the three lines nor the logo move when it opens (the top bar's logo starts 80px in). */}
          <div className={`flex h-16 shrink-0 items-center gap-[26px] border-b border-line pl-[10px] pr-3 ${open ? "" : "bg-ground"}`}>
            <button
              ref={menuButton}
              type="button"
              onClick={pressMenu}
              aria-expanded={open}
              aria-controls="side-rail"
              aria-label={open ? "Close the menu" : "Open the menu"}
              title="Menu"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright"
            >
              <MenuIcon className="h-6 w-6" />
            </button>
            {open && logo}
          </div>

          <div className={`flex min-h-0 flex-1 flex-col ${open ? "" : "border-r border-line bg-sunken"}`}>
            <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${open ? "px-3 py-3" : "flex flex-col items-center gap-1 py-2"}`}>
              <Item href="/library" open={open} active={onHome} current={onHome} icon={<HomeIcon className="h-6 w-6" />} label="Home" />

              {setup && <SetupItem setup={setup} open={open} />}

              {/* LIBRARY: the header, the specialty under it, and the categories. The tour's first stop points at this block when open, and at the icon when not. */}
              <div
                data-tour={open ? "categories" : undefined}
                data-tour-name={open ? "Library, with the procedure categories" : undefined}
                className={open ? "mt-3 border-t border-line pt-3" : ""}
              >
                <button
                  type="button"
                  onClick={() => send({ kind: "library-pressed" })}
                  aria-expanded={open}
                  aria-controls="side-rail"
                  data-tour={open ? undefined : "categories"}
                  data-tour-name={open ? undefined : "Library, with the procedure categories"}
                  className={itemClass(open, !open && inLibrary, open)}
                >
                  <ItemIcon open={open}>
                    <BooksIcon className="h-6 w-6" />
                  </ItemIcon>
                  <ItemLabel open={open}>Library</ItemLabel>
                </button>
                {open && (
                  <>
                    <p className="pb-1 pl-14 text-sm text-ink-muted">{CATEGORY_GROUP}</p>
                    <ul className="flex flex-col gap-0.5">
                      {categories.map((category) => {
                        const href = `/library/${category.slug}`;
                        return (
                          <li key={category.value}>
                            <SubLink href={href} active={pathname === href} icon={<CategoryBadge label={category.label} />}>
                              {category.label}
                            </SubLink>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>

              {/* ADMIN, for office admins: the header and the admin pages. The tour's admin stop points at this block, with the rail opened. */}
              {showAdmin && (
                <div
                  data-tour={open ? "admin-sections" : undefined}
                  data-tour-name={open ? `Admin: ${ADMIN_SECTIONS.map((section) => section.label).join(", ")}` : undefined}
                  className={open ? "mt-3 border-t border-line pt-3" : ""}
                >
                  <Item href="/admin" open={open} active={!open && onAdmin} current={false} header icon={<AdminIcon className="h-6 w-6" />} label="Admin" />
                  {open && (
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {ADMIN_SECTIONS.map((section) => (
                        <li key={section.href}>
                          <SubLink href={section.href} active={section.href === currentAdmin} icon={ADMIN_ICONS[section.href]}>
                            {section.label}
                          </SubLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* "Take the tour" just above the person's picture, until this browser has started the tour (components/tour/TourNotice.tsx). */}
            <div className={`shrink-0 ${open ? "" : "flex justify-center pb-1"}`}>
              <TourNotice variant={open ? "wide" : "rail"} />
            </div>

            {/* The signed-in person: Clerk's user button (Sign out and "Take the tour" are in its menu), with the name beside the picture when open. The box keeps the rail steady while Clerk loads. */}
            <div className={`flex h-14 shrink-0 items-center ${open ? "border-t border-line px-4" : "justify-center"}`}>
              <AccountButton
                tour
                showName
                appearance={{
                  elements: {
                    avatarBox: "h-9 w-9",
                    userButtonTrigger: "rounded-xl",
                    // The picture first and the name after it (Clerk puts the name first). The name only shows while the rail is open.
                    userButtonBox: "flex-row-reverse gap-3",
                    userButtonOuterIdentifier: "text-[15px] font-semibold text-ink group-data-[rail=closed]/rail:hidden",
                  },
                }}
              />
            </div>

            {open && poweredBy && <PoweredBy />}
          </div>
        </div>
      </nav>
    </>
  );
}

// ---------------------------------------------------------------------------
// One item, in its two looks: an icon with a small word under it on the strip
// (at least 44px to tap), an icon and a word side by side in the open menu.
// ---------------------------------------------------------------------------

function itemClass(open: boolean, active: boolean, header = false) {
  if (!open) {
    return `flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium leading-none transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright ${
      active ? "bg-wash-strong text-ink" : "text-ink-soft hover:bg-wash hover:text-ink"
    }`;
  }
  const look = header ? "font-semibold text-ink hover:bg-wash" : active ? "bg-wash-strong font-medium text-ink" : "text-ink-soft hover:bg-wash hover:text-ink";
  return `flex min-h-11 w-full items-center gap-4 rounded-xl px-3 text-left text-base transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright ${look}`;
}

function ItemIcon({ open, children }: { open: boolean; children: ReactNode }) {
  return <span className={`flex shrink-0 items-center justify-center ${open ? "h-7 w-7" : "h-6 w-6"}`}>{children}</span>;
}

function ItemLabel({ open, children }: { open: boolean; children: ReactNode }) {
  return <span className={open ? "min-w-0 truncate" : ""}>{children}</span>;
}

function Item({
  href,
  open,
  active,
  current,
  header = false,
  icon,
  label,
}: {
  href: string;
  open: boolean;
  /** Drawn as the place you are. */
  active: boolean;
  /** This exact page (for a screen reader). */
  current: boolean;
  /** A heading of the open menu (Admin), drawn bold rather than marked. */
  header?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={itemClass(open, active, header && open)}>
      <ItemIcon open={open}>{icon}</ItemIcon>
      <ItemLabel open={open}>{label}</ItemLabel>
    </Link>
  );
}

/** A line under a heading in the open menu: a category, or an admin page. */
function SubLink({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-4 rounded-xl px-3 text-base transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright ${
        active ? "bg-wash-strong font-medium text-ink" : "text-ink-soft hover:bg-wash hover:text-ink"
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

/**
 * A category's initials in a small round badge ("OS" for Orthopedic Spine,
 * "FA" for Foot & Ankle). Letters, not the category's picture: the pictures
 * are large stills, and the menu is on every page.
 */
function CategoryBadge({ label }: { label: string }) {
  const initials = label
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

/**
 * "Finish setup" (the approved design, screen 06-library-reminder), for an
 * office admin until nothing in setup is left undone: a clock with "Setup"
 * on the strip, and a card with a bar and "1 of 4 done" in the open menu.
 * While the steps are under way it says "Finish setup" and opens setup at the
 * step the clinic is on; after them it names what is left ("Add your logo")
 * and opens that step (lib/setup.ts). Only a link: it loads nothing and adds
 * nothing to playing a video. One link in both looks, so the focus stays on
 * it when the rail opens.
 */
function SetupItem({ setup, open }: { setup: SetupReminder; open: boolean }) {
  const label = `${setup.title}, ${setup.doneCount} of ${setup.total} done`;
  return (
    <Link
      href={setup.href}
      title={open ? undefined : label}
      aria-label={open ? undefined : label}
      className={
        open
          ? "mt-2 block rounded-xl border border-brand/40 bg-brand/10 px-3 py-3 text-ink transition hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
          : itemClass(false, false)
      }
    >
      {open ? (
        <>
          <span className="flex items-center gap-3 text-base font-semibold">
            <ClockIcon className="h-5 w-5 shrink-0" />
            {setup.title}
          </span>
          <span role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.doneCount} className="mt-3 block h-1.5 overflow-hidden rounded-full bg-wash-strong">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round((setup.doneCount / setup.total) * 100)}%` }} />
          </span>
          <span className="mt-2 block text-sm text-ink-soft">
            {setup.doneCount} of {setup.total} done
          </span>
        </>
      ) : (
        <>
          <ClockIcon className="h-6 w-6" />
          Setup
        </>
      )}
    </Link>
  );
}

function PoweredBy() {
  return (
    <p className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
      Powered by
      {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
      <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" loading="lazy" className="h-7 w-auto" />
    </p>
  );
}
