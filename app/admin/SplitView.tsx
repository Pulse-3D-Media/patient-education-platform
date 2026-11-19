"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeftIcon, PlusIcon } from "@/components/ui/icons";

/**
 * The list-and-detail layout of the admin pages that hold lists (Overview,
 * Shared links, People), from the approved design (screens 08 to 10):
 *
 *   - ON A COMPUTER: a column with the page's title and the list on the left,
 *     and the chosen item's detail on the right. The first item is chosen
 *     when nothing else is.
 *   - ON A PHONE: the list alone; tapping an item shows its detail alone,
 *     with a "back" line at the top that returns to the list.
 *
 * Every item's detail is drawn on the server by the page and handed in, so
 * choosing an item is instant and asks the server nothing. The page knows
 * which item an address asks for (`?person=...`, used by links from other
 * pages) and passes it as `initialKey`; choosing an item writes it into the
 * address too, so a refresh keeps it.
 *
 * Navigation only: what each detail shows, and every button inside it, was
 * decided and is checked again on the server. A client component only
 * because the chosen item is state.
 */

export type SplitItem = {
  /** Unique within the page, and safe in an address (letters, digits, "_" and "-"). */
  key: string;
  /** The item's line in the list. */
  title: ReactNode;
  /** The smaller line under it. */
  sub?: ReactNode;
  /** A date or a short word at the right of the title. */
  meta?: ReactNode;
  /** True for something new that wants a look: a small dot before it. */
  dot?: boolean;
  /** The detail drawn on the right (or alone on a phone) when this item is chosen. */
  detail: ReactNode;
};

export type SplitGroup = { heading?: string; items: SplitItem[] };

export function SplitView({
  title,
  param,
  groups,
  initialKey,
  headerAction,
  above,
  empty,
  emptyDetail,
  footer,
}: {
  /** The page's title, at the top of the list. */
  title: string;
  /** The name of the address parameter that remembers the chosen item ("item", "person", "code"). */
  param: string;
  groups: SplitGroup[];
  /** The item the address asked for, if any. An unknown key is ignored. */
  initialKey?: string | null;
  /** A button beside the title that opens its own detail ("Invite", "Printed code"). */
  headerAction?: { key: string; label: string; primary?: boolean; detail: ReactNode };
  /** Anything between the title and the list: the seats bar, a warning. */
  above?: ReactNode;
  /** What the list says when it has no items at all. */
  empty?: ReactNode;
  /** What the detail side shows when there is nothing to choose. */
  emptyDetail?: ReactNode;
  /** A line under the list ("Showing the newest 100"). */
  footer?: ReactNode;
}) {
  const listed = groups.flatMap((group) => group.items);
  const all: { key: string; detail: ReactNode }[] = headerAction ? [...listed, headerAction] : listed;
  const known = (key: string | null | undefined) => (key ? all.some((item) => item.key === key) : false);

  const [chosen, setChosen] = useState<string | null>(known(initialKey) ? initialKey! : null);
  // On a phone, whether the detail is showing instead of the list. An address that named an item opens on it.
  const [phoneDetail, setPhoneDetail] = useState(known(initialKey));

  // The chosen item, or (on a computer) the first one; an item that has gone (removed, retired) falls back the same way.
  const current = all.find((item) => item.key === chosen) ?? listed[0] ?? (headerAction && !listed.length ? headerAction : null);

  function choose(key: string) {
    setChosen(key);
    setPhoneDetail(true);
    // Remember it in the address, without a trip to the server and without a new history entry.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(param, key);
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch {
      // Remembering is a nicety; choosing still works.
    }
    // On a phone the detail replaces the list, so start it at the top.
    if (window.matchMedia?.("(max-width: 767px)").matches) window.scrollTo(0, 0);
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
      <section
        aria-label={title}
        className={`${phoneDetail ? "hidden md:flex" : "flex"} w-full flex-col px-4 py-6 md:w-[340px] md:shrink-0 md:border-r md:border-line md:px-3`}
      >
        <div className="flex min-h-12 items-center justify-between gap-3 md:px-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {headerAction && (
            <button
              type="button"
              onClick={() => choose(headerAction.key)}
              aria-pressed={current?.key === headerAction.key}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright ${
                headerAction.primary ? "bg-brand text-on-brand hover:bg-brand-hover" : "border border-line-strong text-ink hover:bg-wash"
              }`}
            >
              <PlusIcon className="h-4 w-4" />
              {headerAction.label}
            </button>
          )}
        </div>

        {above}

        {listed.length === 0 && empty}

        {groups.map((group, index) =>
          group.items.length === 0 ? null : (
            <div key={group.heading ?? index} className="mt-4">
              {group.heading && <h2 className="mb-1 px-2 text-sm font-semibold text-ink-soft">{group.heading}</h2>}
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const active = current?.key === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => choose(item.key)}
                        aria-current={active ? "true" : undefined}
                        className={`relative flex w-full flex-col rounded-xl py-3 pl-9 pr-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright ${
                          active ? "md:bg-brand/15" : "hover:bg-wash"
                        }`}
                      >
                        {item.dot && <span aria-hidden="true" className="absolute left-3.5 top-[1.15rem] h-2 w-2 rounded-full bg-brand" />}
                        <span className="flex w-full items-baseline justify-between gap-3">
                          <span className={`min-w-0 text-[16px] ${item.dot ? "font-semibold text-ink" : "text-ink"}`}>{item.title}</span>
                          {item.meta && <span className="shrink-0 text-[13px] text-ink-muted">{item.meta}</span>}
                        </span>
                        {item.sub && <span className="mt-0.5 min-w-0 break-words text-sm text-ink-muted">{item.sub}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
        {footer}
      </section>

      <div className={`${phoneDetail ? "block" : "hidden md:block"} min-w-0 flex-1 px-4 py-6 md:px-9 md:py-8`}>
        <button
          type="button"
          onClick={() => setPhoneDetail(false)}
          className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-[16px] font-semibold text-ink-soft hover:text-ink md:hidden"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          {title}
        </button>
        {/* A new key per item, so each detail's forms start from its own values. */}
        {current ? <div key={current.key}>{current.detail}</div> : emptyDetail}
      </div>
    </div>
  );
}
