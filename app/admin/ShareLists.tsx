"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Category } from "@prisma/client";
import { CopyButton } from "@/components/ui/CopyButton";
import { SearchIcon } from "@/components/ui/icons";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { qrFileName, watchLink } from "@/lib/share-link";
import { CancelShareButton } from "./CancelShareButton";
import { CreateShareForm } from "./CreateShareForm";

/** One published video, as the admin page shows it. */
export type ProcedureItem = {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string; // "Knee", "Foot & Ankle"
  durationText: string | null; // "1:50", or null when the length is unknown
  isPlaceholder: boolean;
};

/** One share link this clinic has made, as the admin page shows it. */
export type LinkItem = {
  id: string;
  code: string;
  title: string;
  category: Category;
  categoryLabel: string;
  isPlaceholder: boolean;
  expired: boolean;
  whenText: string; // "Expires Dec 4, 2026 · 89 days left" or "Expired Sep 1, 2026"
  viewCount: number;
};

/** Which category pill is pressed. "ALL" is the first pill. */
type Filter = Category | "ALL";

/**
 * The two lists on the Share links page, and the controls that narrow them.
 *
 * At the top sits a row of category pills (All, then every category from
 * lib/categories in its usual order) and a search box. Both apply to both
 * lists at once: pick Knee and type "total" and only Total Knee Replacement
 * is left in Procedures, with only its links left in Existing links.
 *
 * The search matches words anywhere in the procedure name or its category,
 * so "foot" finds every Foot & Ankle procedure and "acl recon" finds ACL
 * Reconstruction. Every word typed has to match.
 *
 * Rows that do not match are hidden rather than removed, so a link that was
 * just created stays on screen under its Create button even if the filter
 * changes. Filtering is instant and happens in the browser: this is a client
 * component because the pressed pill and the typed words are state.
 */
export function ShareLists({ procedures, links, baseUrl }: { procedures: ProcedureItem[]; links: LinkItem[]; baseUrl: string }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = filter !== "ALL" || words.length > 0;

  /** True when a procedure or link passes the pressed pill and the typed words. */
  function matches(item: { title: string; category: Category; categoryLabel: string }) {
    if (filter !== "ALL" && item.category !== filter) return false;
    if (words.length === 0) return true;
    const text = `${item.title} ${item.categoryLabel}`.toLowerCase();
    return words.every((word) => text.includes(word));
  }

  const shownProcedures = procedures.filter(matches).length;
  const shownLinks = links.filter(matches).length;

  function showAll() {
    setFilter("ALL");
    setQuery("");
  }

  return (
    <>
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
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#667085]" />
          <input
            id="share-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search procedures..."
            className="h-11 w-full rounded-full border border-white/15 bg-[#0d1113] pl-12 pr-5 text-base text-white placeholder:text-[#667085] focus:border-[#2a829b] focus:outline-none"
          />
        </div>
      </div>

      {/* 1. Published videos, each with its create form */}
      <section aria-labelledby="videos-heading" className="mt-8">
        <h2 id="videos-heading" className="text-lg font-semibold">
          Procedures
          {filtering && <Count shown={shownProcedures} total={procedures.length} />}
        </h2>

        {procedures.length === 0 ? (
          <p className="mt-3 text-[#bfbfbf]">No published videos yet.</p>
        ) : shownProcedures === 0 ? (
          <NothingMatches what="procedures" query={query} onShowAll={showAll} />
        ) : null}

        <ul className={procedures.length === 0 || shownProcedures === 0 ? "hidden" : "mt-3 flex flex-col gap-3"}>
          {procedures.map((video) => (
            <li
              key={video.id}
              className={
                matches(video)
                  ? "flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5 lg:flex-row lg:items-start lg:justify-between"
                  : "hidden"
              }
            >
              <div>
                <p className="flex flex-wrap items-center gap-2 text-xl font-semibold">
                  {video.title}
                  {video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                </p>
                <p className="mt-1 text-sm text-[#667085]">
                  {video.categoryLabel}
                  {video.durationText && <> &middot; {video.durationText}</>}
                </p>
              </div>
              <CreateShareForm videoId={video.id} baseUrl={baseUrl} />
            </li>
          ))}
        </ul>
      </section>

      {/* 2. Existing share links for this clinic */}
      <section aria-labelledby="links-heading" className="mt-12">
        <h2 id="links-heading" className="text-lg font-semibold">
          Existing links
          {filtering && <Count shown={shownLinks} total={links.length} />}
        </h2>

        {links.length === 0 ? (
          <p className="mt-3 text-[#bfbfbf]">No links yet. Create one above.</p>
        ) : shownLinks === 0 ? (
          <NothingMatches what="links" query={query} onShowAll={showAll} />
        ) : null}

        <ul className={links.length === 0 || shownLinks === 0 ? "hidden" : "mt-3 flex flex-col gap-3"}>
          {links.map((share) => {
            const link = watchLink(baseUrl, share.code);
            const qrUrl = `/admin/qr/${share.code}`;
            return (
              <li
                key={share.id}
                className={
                  matches(share)
                    ? "flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5 lg:flex-row lg:items-center lg:justify-between"
                    : "hidden"
                }
              >
                <div className="min-w-0 flex-1">
                  <p className={`flex flex-wrap items-center gap-2 text-lg font-semibold ${share.expired ? "text-[#667085]" : ""}`}>
                    {share.title}
                    {share.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                  </p>
                  {/* break-all lets a long address wrap anywhere instead of widening the page */}
                  <p className="mt-1 break-all text-sm text-[#bfbfbf]">{link}</p>
                  <p className="mt-2 text-sm text-[#667085]">
                    {share.categoryLabel} &middot; {share.whenText}&nbsp;&middot; {share.viewCount}{" "}
                    {share.viewCount === 1 ? "view" : "views"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
                  <CopyButton text={link} label="Copy link" />
                  {/* A plain link with a download name: the browser saves the picture instead of opening it */}
                  <a href={qrUrl} download={qrFileName(share.title, share.code)} className={SECONDARY_BUTTON}>
                    Download QR
                  </a>
                  <Link href={`/admin/print/${share.code}`} className={SECONDARY_BUTTON}>
                    Print
                  </Link>
                  <CancelShareButton code={share.code} title={share.title} expired={share.expired} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
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
        active ? "border-[#2a829b] bg-[#2a829b] text-white" : "border-white/15 text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** "3 of 13", in muted text beside a heading, shown only while a filter is on. */
function Count({ shown, total }: { shown: number; total: number }) {
  return (
    <span className="ml-2 text-base font-normal text-[#667085]">
      {shown} of {total}
    </span>
  );
}

/** What a list says when the filter leaves nothing in it, with one button to clear the filter. */
function NothingMatches({ what, query, onShowAll }: { what: "procedures" | "links"; query: string; onShowAll: () => void }) {
  const typed = query.trim();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-white/15 px-5 py-6">
      <p className="text-[#bfbfbf]">{typed ? `No ${what} match “${typed}”.` : `No ${what} in this category.`}</p>
      <button type="button" onClick={onShowAll} className={SECONDARY_BUTTON}>
        Show all
      </button>
    </div>
  );
}
