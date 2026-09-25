"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Category } from "@prisma/client";
import { CopyButton } from "@/components/ui/CopyButton";
import { CloseIcon, SearchIcon } from "@/components/ui/icons";
import { INPUT, LABEL, PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { sentByLine, type Sender } from "@/lib/sender-name";
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
 * Everything on the Shared links page below its title: who the links are
 * from, the category pills and search box, and one row per video with its
 * Create link button.
 *
 * Who the link is from is picked once, at the top, and applies to every
 * row. Only people holding a seat are offered; the server checks the pick
 * again when the link is made, so this list is a courtesy, not the check.
 *
 * Pressing Create link makes exactly one new link (a second press while the
 * first is on its way does nothing) and opens that row's small menu: Copy
 * link, Download QR code, Print QR code. All three use that one link. Only
 * one menu is open at a time; closing it (Close, or Escape) does not delete
 * the link, and pressing Create link again makes another one.
 *
 * Filtering is instant and happens in the browser: this is a client
 * component because the pick, the pressed pill and the typed words are state.
 */
export function LinkRows({
  procedures,
  baseUrl,
  emptyProceduresText,
  linksCanBeMade,
  senders,
  defaultSenderId,
  clinicName,
}: {
  procedures: ProcedureItem[];
  baseUrl: string;
  /** What the page says when the clinic has nothing to share, worked out by the page from the clinic's plan. */
  emptyProceduresText: string;
  /** False when a link setting is out of range: every Create button is off, and the page's intro says why. */
  linksCanBeMade: boolean;
  /** Everyone holding a seat, or null when the clinic's people could not be read just now. */
  senders: Sender[] | null;
  /** The signed-in admin, when they hold a seat. Picked when the page opens. */
  defaultSenderId: string | null;
  clinicName: string;
}) {
  const [senderId, setSenderId] = useState(defaultSenderId ?? "");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);

  const sender = senders?.find((candidate) => candidate.userId === senderId) ?? null;

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
      <SenderPicker senders={senders} senderId={senderId} onChange={setSenderId} sender={sender} clinicName={clinicName} />

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

        {/* Rows that do not match are hidden rather than removed, so an open menu survives a change of filter. */}
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
                senderId={sender?.userId ?? null}
                blocked={blocked}
                baseUrl={baseUrl}
                open={openFor === video.id}
                onOpen={() => setOpenFor(video.id)}
                onClose={() => setOpenFor((current) => (current === video.id ? null : current))}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** "Links are from": the surgeon picker, and the line patients will see. */
function SenderPicker({
  senders,
  senderId,
  onChange,
  sender,
  clinicName,
}: {
  senders: Sender[] | null;
  senderId: string;
  onChange: (userId: string) => void;
  sender: Sender | null;
  clinicName: string;
}) {
  return (
    <section aria-labelledby="sender-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5">
      <h2 id="sender-heading" className="sr-only">
        Who the links are from
      </h2>
      {senders === null ? (
        <p role="alert" className="text-ink-soft">
          We could not read your clinic&apos;s people just now, so links cannot be made. Reload this page in a moment.
        </p>
      ) : senders.length === 0 ? (
        <p className="text-ink-soft">
          Every link is from a surgeon, and only people holding a seat can send one. Nobody in your clinic holds a seat yet.{" "}
          <Link href="/admin/people" className="font-medium text-brand-bright underline underline-offset-2">
            Give someone a seat on People
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-5">
          <div className="sm:w-80">
            <label htmlFor="link-sender" className={LABEL}>
              Links are from
            </label>
            <select id="link-sender" value={senderId} onChange={(event) => onChange(event.target.value)} className={INPUT}>
              <option value="" disabled>
                Choose a surgeon...
              </option>
              {senders.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-ink-soft sm:pb-3">
            {sender ? (
              <>
                Patients will see: <span className="font-medium text-ink">{sentByLine(sender.patientName, clinicName)}</span>
                {!sender.patientName && (
                  <span className="block text-warn">
                    No name is set for them yet, so their links name only your clinic. Set one on{" "}
                    <Link href="/admin/people" className="underline underline-offset-2">
                      People
                    </Link>
                    .
                  </span>
                )}
              </>
            ) : (
              "Choose who the links are from. Only people holding a seat are listed."
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * One row's Create link button, and the menu for the link it just made.
 * The button is the clinic's brand colour, never red: red reads as delete.
 */
function CreateLink({
  video,
  senderId,
  blocked,
  baseUrl,
  open,
  onOpen,
  onClose,
}: {
  video: ProcedureItem;
  senderId: string | null;
  blocked: string | null;
  baseUrl: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<MadeLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set the moment the button is pressed, before React has redrawn it as
  // disabled, so a fast double press still makes one link.
  const busy = useRef(false);

  async function press() {
    if (busy.current) return;
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!senderId) {
      setError("Choose who the link is from, at the top of the page.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createLinkAction(video.id, senderId);
      if (result.ok) {
        setMade({ code: result.code, senderName: result.senderName });
        onOpen();
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
        className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-base font-medium text-on-brand transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create link"}
      </button>
      {error && (
        <p role="alert" className="max-w-sm text-sm text-problem lg:text-right">
          {error}
        </p>
      )}
      {open && made && <LinkMenu key={made.code} title={video.title} link={made} baseUrl={baseUrl} onClose={onClose} />}
    </div>
  );
}

/** The small menu for one new link: Copy link, Download QR code, Print QR code, and Close. */
function LinkMenu({ title, link, baseUrl, onClose }: { title: string; link: MadeLink; baseUrl: string; onClose: () => void }) {
  const address = watchLink(baseUrl, link.code);
  const menu = useRef<HTMLDivElement>(null);
  // The latest onClose, read when Escape is pressed. Kept in a ref so the effect below runs once, when the menu
  // opens, and does not take the focus back every time the page redraws (while someone types in the search box).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Escape closes it, and it takes the keyboard's focus when it opens so the three actions are next.
  useEffect(() => {
    menu.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
