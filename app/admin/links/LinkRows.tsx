"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Category } from "@prisma/client";
import { CopyButton } from "@/components/ui/CopyButton";
import { CloseIcon, SearchIcon } from "@/components/ui/icons";
import { INPUT, PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import type { Sender } from "@/lib/sender-name";
import { qrFileName, watchLink } from "@/lib/share-link";
import { createLinkAction } from "./actions";

/** One video this clinic may share, as the Shared links page shows it. */
export type ProcedureItem = {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string; // "Knee", "Foot & Ankle"
  durationText: string | null; // "1:50", or null when the length is unknown
  isPlaceholder: boolean;
};

/** Which category pill is pressed. "ALL" is the first pill. */
type Filter = Category | "ALL";

/** The link a row just made, for its menu. */
type MadeLink = { code: string; senderName: string | null };

/**
 * Everything on the Shared links page below its title: the category pills
 * and search box, and one row per video with its Create link button.
 *
 * EVERY LINK IS FROM A DOCTOR, CHOSEN FOR THAT LINK (decided by Evan on
 * 2026-09-25, after trying a single picker at the top of the page). Pressing
 * Create link opens a small box on that row, "Which doctor is this link
 * from?", with a dropdown of the people holding a seat. Nothing is picked in
 * advance. Choosing a doctor makes exactly one new link and turns the box
 * into the menu for it: Copy link, Download QR code, Print QR code, all three
 * using that one link. The server checks the choice again when the link is
 * made (lib/senders.ts and createShare), so the dropdown is a courtesy, not
 * the check.
 *
 * One row's box is open at a time. Closing it (Close, or Escape) does not
 * delete a link already made, and pressing Create link again asks for a
 * doctor again and makes another one.
 *
 * Filtering is instant and happens in the browser: this is a client
 * component because the open row, the pressed pill and the typed words are
 * state.
 */
export function LinkRows({
  procedures,
  baseUrl,
  emptyProceduresText,
  linksCanBeMade,
  senders,
}: {
  procedures: ProcedureItem[];
  baseUrl: string;
  /** What the page says when the clinic has nothing to share, worked out by the page from the clinic's plan. */
  emptyProceduresText: string;
  /** False when a link setting is out of range: pressing Create link says so, and the page's intro says why. */
  linksCanBeMade: boolean;
  /** Everyone holding a seat, or null when the clinic's people could not be read just now. */
  senders: Sender[] | null;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  // The row whose box (the doctor dropdown, or the menu for its new link) is open.
  const [activeRow, setActiveRow] = useState<string | null>(null);

  // Why no link can be made right now, if that is so. Each Create button says it when pressed.
  const blocked = !linksCanBeMade
    ? "Links cannot be made right now. Ask Pulse 3D."
    : senders === null
      ? "We could not read your clinic's people just now. Reload this page in a moment."
      : senders.length === 0
        ? "Nobody in your clinic holds a seat yet. Give someone a seat on People first."
        : null;

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = filter !== "ALL" || words.length > 0;

  /** True when a procedure passes the pressed pill and the typed words. */
  function matches(item: ProcedureItem) {
    if (filter !== "ALL" && item.category !== filter) return false;
    if (words.length === 0) return true;
    const text = `${item.title} ${item.categoryLabel}`.toLowerCase();
    return words.every((word) => text.includes(word));
  }

  const shown = procedures.filter(matches).length;

  function showAll() {
    setFilter("ALL");
    setQuery("");
  }

  return (
    <>
      {/* Only when no link can be made for want of doctors does the page say so up front. */}
      {senders === null ? (
        <p role="alert" className="mt-8 rounded-2xl border border-line bg-surface p-5 text-ink-soft">
          We could not read your clinic&apos;s people just now, so links cannot be made. Reload this page in a moment.
        </p>
      ) : senders.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-5 text-ink-soft">
          Every link is from a doctor, and only people holding a seat can send one. Nobody in your clinic holds a seat yet.{" "}
          <Link href="/admin/people" className="font-medium text-brand-bright underline underline-offset-2">
            Give someone a seat on People
          </Link>
          .
        </p>
      ) : null}

      {/* The controls: category pills on the left, the search box on the right (stacked on narrow screens). */}
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          <Pill active={filter === "ALL"} onClick={() => setFilter("ALL")}>
            All
          </Pill>
          {CATEGORIES.map((c) => (
            <Pill key={c.value} active={filter === c.value} onClick={() => setFilter(c.value)}>
              {c.label}
            </Pill>
          ))}
        </div>

        <div className="relative w-full lg:w-80 lg:shrink-0">
          <label className="sr-only" htmlFor="share-search">
            Search procedures
          </label>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <input
            id="share-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search procedures..."
            className="h-11 w-full rounded-full border border-line-strong bg-surface pl-12 pr-5 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
          />
        </div>
      </div>

      <section aria-labelledby="videos-heading" className="mt-8">
        <h2 id="videos-heading" className="text-lg font-semibold">
          Procedures
          {filtering && (
            <span className="ml-2 text-base font-normal text-ink-muted">
              {shown} of {procedures.length}
            </span>
          )}
        </h2>

        {procedures.length === 0 ? (
          <p className="mt-3 text-ink-soft">{emptyProceduresText}</p>
        ) : shown === 0 ? (
          <NothingMatches query={query} onShowAll={showAll} />
        ) : null}

        {/* Rows that do not match are hidden rather than removed, so an open box survives a change of filter. */}
        <ul className={procedures.length === 0 || shown === 0 ? "hidden" : "mt-3 flex flex-col gap-3"}>
          {procedures.map((video) => (
            <li
              key={video.id}
              className={
                matches(video)
                  ? "flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:flex-row lg:items-start lg:justify-between"
                  : "hidden"
              }
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xl font-semibold">
                  {video.title}
                  {video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {video.categoryLabel}
                  {video.durationText && <> &middot; {video.durationText}</>}
                </p>
              </div>
              <CreateLink
                video={video}
                senders={senders ?? []}
                blocked={blocked}
                baseUrl={baseUrl}
                active={activeRow === video.id}
                onActivate={() => setActiveRow(video.id)}
                onClose={() => setActiveRow((current) => (current === video.id ? null : current))}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * What a doctor is called in the dropdown: their name for the office, and,
 * when patients will see something else, that too, so the admin knows what
 * the patient page will say before choosing.
 */
function doctorLabel(sender: Sender): string {
  if (!sender.patientName) return `${sender.name} (no name set for patients)`;
  if (sender.patientName === `Dr. ${sender.name}`) return sender.name;
  return `${sender.name} (patients see: ${sender.patientName})`;
}

/**
 * One row's Create link button, then the doctor dropdown, then the menu for
 * the link it made. The button is the clinic's brand colour, never red: red
 * reads as delete.
 */
function CreateLink({
  video,
  senders,
  blocked,
  baseUrl,
  active,
  onActivate,
  onClose,
}: {
  video: ProcedureItem;
  senders: Sender[];
  blocked: string | null;
  baseUrl: string;
  /** True while this row's box is the open one. */
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"picking" | "made">("picking");
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<MadeLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set the moment a doctor is chosen, before React has redrawn the dropdown
  // as disabled, so a second choice while the first is on its way makes nothing.
  const busy = useRef(false);

  function press() {
    if (busy.current) return;
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setStage("picking");
    onActivate();
  }

  async function choose(senderUserId: string) {
    if (!senderUserId || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createLinkAction(video.id, senderUserId);
      if (result.ok) {
        setMade({ code: result.code, senderName: result.senderName });
        setStage("made");
      } else {
        setError(result.error);
      }
    } catch {
      // The request itself failed (the connection dropped). A link may or may not have been made; an unused one stops on its own.
      setError("We could not reach the server. Check the connection, then try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3 lg:items-end">
      <button
        type="button"
        onClick={press}
        disabled={pending}
        aria-expanded={active}
        className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-base font-medium text-on-brand transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create link"}
      </button>
      {active && stage === "picking" && (
        <DoctorPicker title={video.title} senders={senders} pending={pending} error={error} onChoose={choose} onClose={onClose} />
      )}
      {!active && error && (
        <p role="alert" className="max-w-sm text-sm text-problem lg:text-right">
          {error}
        </p>
      )}
      {active && stage === "made" && made && <LinkMenu key={made.code} title={video.title} link={made} baseUrl={baseUrl} onClose={onClose} />}
    </div>
  );
}

/** Close on Escape and take the keyboard's focus once, when a box opens; `onClose` is read fresh each time. */
function useBoxBehaviour(box: React.RefObject<HTMLElement | null>, focusTarget: React.RefObject<HTMLElement | null>, onClose: () => void) {
  // Kept in a ref so the effect below runs once, when the box opens, and does
  // not take the focus back every time the page redraws (while someone types in the search box).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    (focusTarget.current ?? box.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box, focusTarget]);
}

/**
 * "Which doctor is this link from?": a dropdown of the people holding a seat,
 * nothing picked. Choosing one makes the link straight away.
 */
function DoctorPicker({
  title,
  senders,
  pending,
  error,
  onChoose,
  onClose,
}: {
  title: string;
  senders: Sender[];
  pending: boolean;
  error: string | null;
  onChoose: (senderUserId: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  useBoxBehaviour(box, select, onClose);
  const selectId = `doctor-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  return (
    <div
      ref={box}
      tabIndex={-1}
      role="group"
      aria-label={`Choose the doctor for a new ${title} link`}
      className="w-full max-w-md rounded-xl border border-brand/50 bg-overlay p-4 shadow-panel outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={selectId} className="pt-1 text-sm font-semibold text-ink">
          Which doctor is this link from?
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-wash hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      {/* value is always "" so choosing the same doctor again after a refusal is still a change. */}
      <select
        id={selectId}
        ref={select}
        value=""
        disabled={pending}
        onChange={(event) => onChoose(event.target.value)}
        className={`${INPUT} mt-2 disabled:opacity-60`}
      >
        <option value="" disabled>
          {pending ? "Creating link..." : "Choose a doctor..."}
        </option>
        {senders.map((sender) => (
          <option key={sender.userId} value={sender.userId}>
            {doctorLabel(sender)}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-problem">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">Choosing a doctor makes the link. Only people holding a seat are listed.</p>
      )}
    </div>
  );
}

/** The small menu for one new link: Copy link, Download QR code, Print QR code, and Close. */
function LinkMenu({ title, link, baseUrl, onClose }: { title: string; link: MadeLink; baseUrl: string; onClose: () => void }) {
  const address = watchLink(baseUrl, link.code);
  const menu = useRef<HTMLDivElement>(null);
  const none = useRef<HTMLElement>(null);
  // Escape closes it, and it takes the keyboard's focus when it opens so the three actions are next.
  useBoxBehaviour(menu, none, onClose);

  return (
    <div
      ref={menu}
      tabIndex={-1}
      role="group"
      aria-label={`New link for ${title}`}
      className="w-full max-w-md rounded-xl border border-brand/50 bg-overlay p-4 shadow-panel outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink" role="status">
            New link made{link.senderName ? `, from ${link.senderName}` : ""}
          </p>
          <p className="mt-1 truncate text-sm text-ink-soft" title={address}>
            {address}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-wash hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton text={address} label="Copy link" />
        {/* A plain link with a download name: the browser saves the picture instead of opening it. */}
        <a href={`/admin/qr/${link.code}`} download={qrFileName(title, link.code)} className={SECONDARY_BUTTON}>
          Download QR code
        </a>
        {/* The pamphlet opens in a new tab, so this menu is still here afterwards. */}
        <a href={`/admin/print/${link.code}`} target="_blank" rel="noopener" className={SECONDARY_BUTTON}>
          Print QR code
        </a>
      </div>
      <p className="mt-3 text-xs text-ink-muted">Closing this does not cancel the link. Create link again makes a new one.</p>
    </div>
  );
}

/** One category pill. Pressed pills are filled with the accent colour. */
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-10 rounded-full border px-4 text-sm font-medium transition ${
        active ? "border-brand bg-brand text-on-brand" : "border-line-strong text-ink-soft hover:border-brand hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** What the list says when the filter leaves nothing in it, with one button to clear the filter. */
function NothingMatches({ query, onShowAll }: { query: string; onShowAll: () => void }) {
  const typed = query.trim();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line-strong px-5 py-6">
      <p className="text-ink-soft">{typed ? `No procedures match “${typed}”.` : "No procedures in this category."}</p>
      <button type="button" onClick={onShowAll} className={SECONDARY_BUTTON}>
        Show all
      </button>
    </div>
  );
}
