import { ClinicStatus } from "@prisma/client";
import Link from "next/link";
import { getPlatformReport, listClinicReportRows, REPORT_CLINICS_PAGE_SIZE, REPORT_PROCEDURE_LIMIT } from "@/lib/db/reports";
import { pageInfo, readPage } from "@/lib/paging";
import { requirePulseStaff } from "@/lib/pulse";
import { periodSentence, periodStart, readReportDays, SEAT_SOURCE_WORDS, type ReportDays } from "@/lib/reports";
import { Pager, Section, StatusBadge, formatDateTime, statusLabel } from "../ui";
import { categoryLabel, count, CountCells, CountHeadings, CountsTable, CountTiles, Definitions, Empty, PeriodSwitch, ProcedureTable, ReportTable } from "./ReportBits";

/**
 * Reports, at /pulse/reports: how the platform's links are used, in totals.
 * Pulse staff only (requirePulseStaff, and the /pulse layout), and nothing
 * here is shown to a clinic: clinics do not get reports yet (decided by Evan
 * on 2026-10-07, while it is still being tested whether people want them).
 *
 * The numbers cover the links MADE in the period, 30 days by default or 90
 * (?days=90), with what has been recorded on them so far; what each number
 * means, and why it is not "activity in the period", is at the top of
 * lib/reports.ts and in the box at the bottom of the page. "Right now"
 * numbers (clinics, seats, links waiting) say so.
 *
 * Every number is counted in the database (lib/db/reports.ts), the clinic
 * table is read a page at a time (?page=2), and the procedure list is
 * capped. Rendered fresh on every request.
 */
export const dynamic = "force-dynamic";

const STATUSES = Object.values(ClinicStatus);

export default async function PulseReportsPage({ searchParams }: PageProps<"/pulse/reports">) {
  await requirePulseStaff();

  const params = await searchParams;
  const days = readReportDays(params.days);
  const now = new Date();
  const window = { since: periodStart(now, days), until: now };

  const [report, clinics] = await Promise.all([getPlatformReport(window, now), listClinicReportRows(window, readPage(params.page))]);
  const info = pageInfo(clinics.page, clinics.total, REPORT_CLINICS_PAGE_SIZE);

  /** This page's address for a period and a page of the clinic table. */
  function hrefFor(target: { days?: ReportDays; page?: number }) {
    const search = new URLSearchParams();
    const targetDays = target.days ?? days;
    if (targetDays !== 30) search.set("days", String(targetDays));
    if (target.page && target.page > 1) search.set("page", String(target.page));
    const text = search.toString();
    return text ? `/pulse/reports?${text}` : "/pulse/reports";
  }

  const seatRows = (["card", "pulse"] as const).map((source) => ({ source, ...report.openSeats[source] }));
  const seatTotal = seatRows.reduce(
    (sum, row) => ({ clinics: sum.clinics + row.clinics, seatsOnPlans: sum.seatsOnPlans + row.seatsOnPlans, seatsInUse: sum.seatsInUse + row.seatsInUse }),
    { clinics: 0, seatsOnPlans: 0, seatsInUse: 0 },
  );

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold sm:text-3xl">Reports</h1>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            How links are made and played across every clinic. Totals only, never anything about a patient. Clinics do not see this page.
          </p>
        </header>

        <div className="space-y-2">
          <PeriodSwitch days={days} hrefFor={(target) => hrefFor({ days: target })} />
          <p className="text-sm text-[#bfbfbf]">
            {periodSentence(days)} Since {formatDateTime(window.since)}, Utah time.
          </p>
        </div>

        <Section title="Links made in this period">
          <CountTiles counts={report.links} />
          <p className="mt-4 text-[15px] text-[#bfbfbf]">
            Right now, {count(report.waitingNow)} paused {report.waitingNow === 1 ? "link is" : "links are"} waiting for {report.waitingNow === 1 ? "its" : "their"}{" "}
            clinic to turn {report.waitingNow === 1 ? "it" : "them"} back on, whenever {report.waitingNow === 1 ? "it was" : "they were"} made.
          </p>
        </Section>

        <Section
          title="Clinics and seats right now"
          blurb="Seats are counted for open clinics only. A paused, cancelled or pending clinic, or one whose grace period is over, is left out of the seats; its links are still in every link number."
        >
          <p className="text-[15px] text-[#bfbfbf]">
            {STATUSES.map((status) => `${statusLabel(status)} ${count(report.clinicsByStatus[status])}`).join(" · ")}
          </p>
          <div className="mt-4">
            <ReportTable minWidth={520}>
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Open clinics</th>
                  <th className="px-4 py-3 text-right font-medium">Clinics</th>
                  <th className="px-4 py-3 text-right font-medium">Seats on plans</th>
                  <th className="px-4 py-3 text-right font-medium">Seats in use</th>
                </tr>
              </thead>
              <tbody>
                {seatRows.map((row) => (
                  <tr key={row.source} className="border-b border-white/5">
                    <td className="px-4 py-3 text-white">{SEAT_SOURCE_WORDS[row.source]}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{count(row.clinics)}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{count(row.seatsOnPlans)}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{count(row.seatsInUse)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-3 font-medium text-white">Total</td>
                  <td className="px-4 py-3 text-right text-white">{count(seatTotal.clinics)}</td>
                  <td className="px-4 py-3 text-right text-white">{count(seatTotal.seatsOnPlans)}</td>
                  <td className="px-4 py-3 text-right text-white">{count(seatTotal.seatsInUse)}</td>
                </tr>
              </tbody>
            </ReportTable>
          </div>
          <p className="mt-2 text-sm text-[#667085]">
            Paid by card: the clinic follows its own card payments. Set up by Pulse: managed by Pulse, or opened by hand. Seats in use are people holding a seat
            plus open invitations, as on each clinic&rsquo;s People page.
          </p>
        </Section>

        <Section title="By category">
          <CountsTable firstHeading="Category" rows={report.categories.map((row) => ({ key: row.category, label: categoryLabel(row.category), counts: row }))} />
        </Section>

        <Section title="By procedure">
          <ProcedureTable rows={report.procedures} capped={report.proceduresCapped} limit={REPORT_PROCEDURE_LIMIT} />
        </Section>

        <Section title="By clinic" blurb="Every clinic, the ones that made the most links in this period first. Open one for its surgeons and procedures.">
          {clinics.rows.length === 0 ? (
            <Empty>No clinics yet. The first one appears when someone signs up.</Empty>
          ) : (
            <ReportTable minWidth={1080}>
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Clinic</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Categories</th>
                  <th className="px-4 py-3 text-right font-medium">Seats in use / on plan</th>
                  <CountHeadings />
                </tr>
              </thead>
              <tbody>
                {clinics.rows.map((clinic) => (
                  <tr key={clinic.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[.03]">
                    <td className="px-4 py-3">
                      <Link href={`/pulse/reports/clinics/${clinic.id}${days === 30 ? "" : `?days=${days}`}`} className="font-medium text-white hover:text-[#5fb8d4]">
                        {clinic.name}
                      </Link>
                      {clinic.managedByPulse && <span className="ml-2 whitespace-nowrap text-xs text-[#667085]">Managed by Pulse</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={clinic.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{clinic.categoryCount}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">
                      {clinic.seatsInUse} / {clinic.surgeonSeats}
                    </td>
                    <CountCells counts={clinic} />
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          )}
          <Pager info={info} hrefFor={(target) => hrefFor({ page: target })} />
        </Section>

        <Section title="What the numbers mean">
          <Definitions />
        </Section>
      </div>
    </main>
  );
}
