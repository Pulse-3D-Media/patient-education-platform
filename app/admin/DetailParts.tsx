import type { ReactNode } from "react";

/**
 * The small building blocks of an item's detail on the list-and-detail admin
 * pages (SplitView.tsx), and of the one-column pages (Clinic branding,
 * Billing), so every page lines up the same way. Plain markup: no hooks, no
 * server imports, safe on either side.
 */

/** The detail's title, the line under it, anything at its right, and the rule beneath. */
export function DetailHeader({ title, sub, end, as: Heading = "h2" }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line pb-6">
      <div className="min-w-0">
        <Heading className="text-[26px] font-semibold leading-tight break-words sm:text-[28px]">{title}</Heading>
        {sub && <p className="mt-1.5 text-[15px] text-ink-muted">{sub}</p>}
      </div>
      {end}
    </header>
  );
}

/** Label and value pairs: "Procedure  Total Knee Replacement". Side by side from a tablet up, stacked on a phone. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 text-[16px] sm:grid-cols-[max-content_1fr] sm:gap-y-3">
      {rows.map((row) => (
        <div key={row.label} className="mt-4 first:mt-0 sm:mt-0 sm:contents">
          <dt className="text-ink-muted">{row.label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-ink sm:mt-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The detail's body, with the phone preview beside it on a wide screen and under it on a narrow one. */
export function WithPreview({ children, preview }: { children: ReactNode; preview?: ReactNode }) {
  return (
    <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0">{children}</div>
      {preview && <div className="flex justify-center xl:-mt-2 xl:justify-end">{preview}</div>}
    </div>
  );
}

/** A thin rule between two parts of a detail or a page. */
export function Rule() {
  return <hr className="my-6 border-line" />;
}

/** "Nov 14", or "Nov 14, 2025" when it is not this year. Utah time, like the rest of the admin area. */
export function shortDate(date: Date, now: Date = new Date()): string {
  const sameYear = date.toLocaleDateString("en-US", { year: "numeric", timeZone: "America/Denver" }) === now.toLocaleDateString("en-US", { year: "numeric", timeZone: "America/Denver" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "America/Denver" });
}

/** "November 14". Utah time. */
export function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

/** "today", "yesterday", "6 days ago": how long ago something was, in whole days, for a list. */
export function daysAgo(then: Date, now: Date = new Date()): string {
  // Rounded, so something sent six days ago (less the minutes since) reads "6 days ago".
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
