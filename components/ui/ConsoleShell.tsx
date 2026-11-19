"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { BooksIcon } from "./icons";

/**
 * The console layout from the approved design (2026-11-18), shared by the
 * clinic's admin area (AdminConsole, light or dark as the clinic chose) and
 * the Pulse 3D dashboard (PulseShell, always dark).
 *
 *   - THE TOP BAR, at every width: the logo at the left. On a phone it also
 *     carries the way to the library and the signed-in person's avatar, since
 *     a phone has no rail.
 *   - THE LEFT RAIL, from a tablet up: one line per section, an icon and a
 *     word, the current one tinted. At the bottom, the way to the library
 *     and the signed-in person (Clerk's user button with their name, which
 *     holds Sign out). It stays put while the page scrolls.
 *   - ON A PHONE, the same sections as a row of pills under the top bar,
 *     which scrolls sideways rather than wrapping, so every section is one
 *     thumb away.
 *
 * Navigation only. Which pages a person may open is decided on the server by
 * each page (and for /pulse by requirePulseStaff()); a link shown here grants
 * nothing, and a link left out protects nothing.
 *
 * It holds no state and reads nothing: the client piece that uses it works
 * out which section is current from the address and passes plain values in.
 * The one thing it does in the browser: on a phone, it scrolls the row of
 * pills so the current one is in view (Billing is off the edge otherwise).
 * Every colour is a token class (app/globals.css), so `theme` alone decides
 * light or dark; the server writes it, so the first paint is already right.
 */

export type ConsoleSection = {
  href: string;
  label: string;
  icon: ReactNode;
  /** True for the section the current address belongs to. */
  active: boolean;
};

export function ConsoleShell({
  theme,
  style,
  fontClass = "",
  navLabel,
  mark,
  topEnd,
  sections,
  library,
  children,
}: {
  theme: "light" | "dark";
  /** The clinic's colours as CSS variables, or nothing for the Pulse colours. */
  style?: CSSProperties;
  /** The clinic's own font class, or empty for the staff fonts with Schibsted Grotesk headings. */
  fontClass?: string;
  /** What a screen reader calls the section navigation ("Clinic admin", "Dashboard"). */
  navLabel: string;
  /** The logo at the left of the top bar. */
  mark: ReactNode;
  /** Anything else for the right of the top bar, at every width (the demo site link on /pulse). */
  topEnd?: ReactNode;
  sections: ConsoleSection[];
  /** The way to the library: where it goes, what it says, and whether a phone's top bar carries it too (the rail always does). */
  library: { href: string; label: string; inPhoneBar?: boolean };
  children: ReactNode;
}) {
  const pills = useRef<HTMLElement>(null);
  const current = sections.find((section) => section.active)?.href ?? null;

  // Bring the current pill into the middle of the phone's row. Only the row scrolls, never the page.
  useEffect(() => {
    const row = pills.current;
    const pill = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !pill) return;
    row.scrollLeft = pill.offsetLeft - row.clientWidth / 2 + pill.offsetWidth / 2;
  }, [current]);

  return (
    <div data-theme={theme} className={`flex min-h-screen flex-col bg-ground text-ink ${fontClass || "staff-headings"}`} style={style}>
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-ground px-4 md:px-5">
        {mark}
        <div className="ml-auto flex items-center gap-2">
          {topEnd}
          {/* A phone has no rail, so the library and the avatar ride in the top bar there. */}
          {library.inPhoneBar !== false && (
            <Link
              href={library.href}
              className="flex h-11 items-center gap-2 rounded-xl border border-line-strong px-3 text-[15px] font-semibold text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright md:hidden"
            >
              <BooksIcon className="h-5 w-5" />
              {library.label}
            </Link>
          )}
          <div className="flex h-11 w-11 items-center justify-center md:hidden">
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </div>
      </header>

      {/* The phone's row of pills. */}
      <nav ref={pills} aria-label={navLabel} className="relative shrink-0 overflow-x-auto border-b border-line px-4 py-2.5 md:hidden">
        <ul className="flex min-w-max gap-2">
          {sections.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={section.active ? "page" : undefined}
                className={`flex h-11 items-center whitespace-nowrap rounded-full border px-4 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright ${
                  section.active ? "border-transparent bg-brand text-on-brand" : "border-line-strong text-ink-soft hover:bg-wash hover:text-ink"
                }`}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1">
        {/* The left rail, from a tablet up. */}
        <nav aria-label={navLabel} className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[216px] shrink-0 flex-col border-r border-line bg-sunken px-3 py-4 md:flex">
          <ul className="flex flex-col gap-0.5">
            {sections.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  aria-current={section.active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright ${
                    section.active ? "bg-brand/15 font-semibold text-ink" : "font-medium text-ink-soft hover:bg-wash hover:text-ink"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${section.active ? "text-brand-bright" : ""}`}>{section.icon}</span>
                  <span className="min-w-0 truncate">{section.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex-1" />

          <Link
            href={library.href}
            className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong px-3 text-[15px] font-semibold text-ink transition hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright"
          >
            <BooksIcon className="h-5 w-5" />
            {library.label}
          </Link>
          {/* The signed-in person: Clerk's user button with their name. Its menu holds Sign out. The box keeps the rail steady while Clerk loads. */}
          <div className="flex min-h-14 items-center border-t border-line px-1 pt-2">
            <UserButton
              showName
              appearance={{
                elements: {
                  avatarBox: "h-9 w-9",
                  userButtonTrigger: "rounded-xl",
                  // The avatar first and the name after it, as in the design (Clerk puts the name first).
                  userButtonBox: "flex-row-reverse gap-3",
                  userButtonOuterIdentifier: "text-[15px] font-semibold text-ink",
                },
              }}
            />
          </div>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
