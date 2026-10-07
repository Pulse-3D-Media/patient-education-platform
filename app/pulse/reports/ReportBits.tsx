import Link from "next/link";
import type { ReactNode } from "react";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import type { ProcedureReportRow } from "@/lib/db/reports";
import { playedRate, REPORT_DEFINITIONS, REPORT_PERIODS, type LinkCounts, type ReportDays } from "@/lib/reports";

/**
 * The pieces both report pages share: the period switch, the row of totals,
 * a table of counts, the procedure table and the definitions. Server-safe
 * (no state). What each number means is at the top of lib/reports.ts.
 */

/** A whole number with thousands separators: "1,204". */
export function count(value: number) {
  return value.toLocaleString("en-US");
}

/** The two links that switch the period, 30 or 90 days. `hrefFor` builds the address of the same page for a period. */
export function PeriodSwitch({ days, hrefFor }: { days: ReportDays; hrefFor: (days: ReportDays) => string }) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-2">
      {REPORT_PERIODS.map((option) => {
        const current = option === days;
        return (
          <Link
            key={option}
            href={hrefFor(option)}
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
