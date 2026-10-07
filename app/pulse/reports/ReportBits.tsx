import Link from "next/link";
import type { ReactNode } from "react";
import { INPUT, PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import type { ProcedureReportRow } from "@/lib/db/reports";
import {
  EARLIEST_REPORT_DATE,
  playedRate,
  presetRange,
  rangeSentence,
  REPORT_DEFINITIONS,
  REPORT_PERIODS,
  reportHref,
  utahDateOf,
  type LinkCounts,
  type ReportRange,
} from "@/lib/reports";
import { formatDateTime } from "../ui";

/**
 * The pieces both report pages share: the range controls, the Download CSV
 * button, the row of totals, a table of counts, the procedure table and the
 * definitions. Server-safe
 * (no state). What each number means is at the top of lib/reports.ts.
 */

/** A whole number with thousands separators: "1,204". */
export function count(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Which links the page covers: two links for the last 30 or 90 days, and a
 * plain GET form for two dates (so the address carries the range and a
 * reload keeps it), then the sentence saying exactly what the numbers cover,
 * and, when the dates asked for could not be used, why (lib/reports.ts
 * decides). `path` is the page's own address.
 */
export function RangeControls({ path, range, problem, now }: { path: string; range: ReportRange; problem: string | null; now: Date }) {
  const today = utahDateOf(now);
  const custom = range.kind === "custom";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {REPORT_PERIODS.map((option) => {
            const current = range.kind === "preset" && range.days === option;
            return (
              <Link
                key={option}
                href={reportHref(path, presetRange(option, now))}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] font-medium ${
                  current ? "border-[#2a829b] bg-[#2a829b]/20 text-white" : "border-white/15 text-[#bfbfbf] hover:bg-white/[.06]"
                }`}
              >
                Last {option} days
              </Link>
            );
          })}
        </nav>
        <form
          method="get"
          action={path}
          aria-label="Choose dates"
          className={`flex flex-wrap items-end gap-2 rounded-2xl border p-2 ${custom ? "border-[#2a829b] bg-[#2a829b]/10" : "border-transparent"}`}
        >
          <div>
            <label htmlFor="report-from" className="mb-1 block text-sm text-[#bfbfbf]">
              From
            </label>
            <input
              id="report-from"
              name="from"
              type="date"
              required
              min={EARLIEST_REPORT_DATE}
              max={today}
              defaultValue={custom ? range.from : utahDateOf(range.since)}
              className={`${INPUT} w-44 [color-scheme:dark]`}
            />
          </div>
          <div>
            <label htmlFor="report-to" className="mb-1 block text-sm text-[#bfbfbf]">
              To
            </label>
            <input
              id="report-to"
              name="to"
              type="date"
              required
              min={EARLIEST_REPORT_DATE}
              defaultValue={custom ? range.to : today}
              className={`${INPUT} w-44 [color-scheme:dark]`}
            />
          </div>
          <button type="submit" className={`${SECONDARY_BUTTON} h-11`}>
            Show these dates
          </button>
        </form>
      </div>
      {problem && (
        <p role="status" className="text-[15px] text-[#f3b94d]">
          {problem}
        </p>
      )}
      <p className="text-sm text-[#bfbfbf]">
        {rangeSentence(range)}
        {range.kind === "preset" && ` Since ${formatDateTime(range.since)}, Utah time.`}
      </p>
    </div>
  );
}

/** The Download CSV button above a table: a plain link to the file, for the same range as the page. */
export function CsvLink({ href }: { href: string }) {
  return (
    <div className="mb-3 flex justify-end">
      <a href={href} download className={`${SECONDARY_BUTTON} h-10`}>
        Download CSV
      </a>
    </div>
  );
}

/** One total in the row at the top: a big number, what it is, and an optional line under it. */
function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1113] p-4">
      <p className="text-sm text-[#bfbfbf]">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-white">{value}</p>
      {note && <p className="mt-1 text-sm text-[#667085]">{note}</p>}
    </div>
  );
}

/** The five totals for a group of links, as a row of tiles. */
export function CountTiles({ counts }: { counts: LinkCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Links made" value={count(counts.made)} />
      <Tile label="Played" value={count(counts.played)} note={counts.made > 0 ? `${playedRate(counts)} of links made` : "No links made"} />
      <Tile label="Play starts" value={count(counts.playStarts)} />
      <Tile label="Renewal requests" value={count(counts.renewalRequests)} />
      <Tile label="Renewals" value={count(counts.renewals)} />
    </div>
  );
}

/** The column headings after the first, the same in every table of counts. */
const COUNT_HEADINGS = ["Links made", "Played", "Played rate", "Play starts", "Renewal requests", "Renewals"];

/** The six count cells of one row. */
export function CountCells({ counts }: { counts: LinkCounts }) {
  const cells = [count(counts.made), count(counts.played), playedRate(counts), count(counts.playStarts), count(counts.renewalRequests), count(counts.renewals)];
  return (
    <>
      {cells.map((cell, index) => (
        <td key={COUNT_HEADINGS[index]} className="px-4 py-3 text-right text-[#bfbfbf]">
          {cell}
        </td>
      ))}
    </>
  );
}

/** The count headings, for a table that has columns of its own before them. */
export function CountHeadings() {
  return (
    <>
      {COUNT_HEADINGS.map((heading) => (
        <th key={heading} className="px-4 py-3 text-right font-medium">
          {heading}
        </th>
      ))}
    </>
  );
}

/** A table that scrolls sideways inside its box on a narrow screen, so the page itself never overflows. */
export function ReportTable({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1113]">
      <table className="w-full text-left text-[15px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

/** A table whose rows are a label and the six counts. */
export function CountsTable({ firstHeading, rows }: { firstHeading: string; rows: { key: string; label: ReactNode; counts: LinkCounts }[] }) {
  return (
    <ReportTable>
      <thead className="text-xs uppercase tracking-wider text-[#667085]">
        <tr className="border-b border-white/10">
          <th className="px-4 py-3 font-medium">{firstHeading}</th>
          <CountHeadings />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-white/5 last:border-b-0">
            <td className="px-4 py-3 text-white">{row.label}</td>
            <CountCells counts={row.counts} />
          </tr>
        ))}
      </tbody>
    </ReportTable>
  );
}

/** The category's label, "Knee", "Foot & Ankle". */
export function categoryLabel(category: string) {
  return CATEGORIES.find((entry) => entry.value === category)?.label ?? category;
}

/** The procedures with links in the period, with the placeholder mark where it applies, and a line when the list was cut. */
export function ProcedureTable({ rows, capped, limit }: { rows: ProcedureReportRow[]; capped: boolean; limit: number }) {
  if (rows.length === 0) return <Empty>No links were made in this period.</Empty>;
  return (
    <>
      <CountsTable
        firstHeading="Procedure"
        rows={rows.map((row) => ({
          key: row.videoId,
          label: (
            <span>
              {row.title}
              <span className="ml-2 text-sm text-[#667085]">{categoryLabel(row.category)}</span>
              {row.isPlaceholder && <span className={`ml-2 ${PLACEHOLDER_BADGE}`}>Placeholder</span>}
            </span>
          ),
          counts: row,
        }))}
      />
      {capped && <p className="mt-2 text-sm text-[#667085]">Showing the {limit} procedures with the most links; the rest are left off. The totals above count every link.</p>}
    </>
  );
}

/** The calm box for a list with nothing in it. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-white/15 p-5 text-[#bfbfbf]">{children}</p>;
}

/** What each number means, in the words of lib/reports.ts. */
export function Definitions() {
  return (
    <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
      {REPORT_DEFINITIONS.map((row) => (
        <div key={row.term}>
          <dt className="font-medium text-white">{row.term}</dt>
          <dd className="mt-0.5 text-[#bfbfbf]">{row.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
