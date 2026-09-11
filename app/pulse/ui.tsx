import type { ClinicStatus } from "@prisma/client";
import type { ReactNode } from "react";

/**
 * Small pieces the dashboard pages share: the status badge, a titled
 * section, the "coming" page, and date words. Server-safe (no state).
 */

/** How each status reads and looks. Amber for the two "needs a look" states, red only for canceled. */
const STATUS_LOOK: Record<ClinicStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-white/10 text-[#bfbfbf]" },
  ACTIVE: { label: "Active", className: "bg-[#2a829b]/20 text-[#5fb8d4]" },
  PAUSED: { label: "Paused", className: "bg-[#f3b94d]/20 text-[#f3b94d]" },
  PAST_DUE: { label: "Past due", className: "bg-[#f3b94d]/20 text-[#f3b94d]" },
  CANCELED: { label: "Canceled", className: "bg-[#f87171]/15 text-[#f87171]" },
};

export function statusLabel(status: ClinicStatus) {
  return STATUS_LOOK[status].label;
}

export function StatusBadge({ status }: { status: ClinicStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${look.className}`}>
      {look.label}
    </span>
  );
}

/** A titled block on the clinic page. The title is an h2 so the page reads as an outline. */
export function Section({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {blurb && <p className="mt-1 max-w-2xl text-sm text-[#bfbfbf]">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A section of the dashboard that is not built yet. A real page, so the rail never links to nothing. */
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">Coming</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-3 max-w-xl text-[#bfbfbf]">{blurb}</p>
      </div>
    </main>
  );
}

/** "Sep 10, 2026". Utah time, like the admin console. */
export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}

/** "Sep 10, 2026, 3:04 PM". Utah time. */
export function formatDateTime(date: Date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  });
}
