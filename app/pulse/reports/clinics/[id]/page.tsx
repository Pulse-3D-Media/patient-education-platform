import Link from "next/link";
import { notFound } from "next/navigation";
import { getClinicReport, REPORT_PROCEDURE_LIMIT, REPORT_SURGEON_LIMIT } from "@/lib/db/reports";
import { requirePulseStaff } from "@/lib/pulse";
import { readReportRange, reportHref, seatSourceOf, SEAT_SOURCE_WORDS } from "@/lib/reports";
import { Section, StatusBadge } from "../../../ui";
import { categoryLabel, count, CountsTable, CountTiles, CsvLink, Definitions, Empty, ProcedureTable, RangeControls } from "../../ReportBits";

/**
 * One clinic's report, at /pulse/reports/clinics/<id>: what it has right
 * now (its plan's categories and its seats) and the links it made in the
 * period, in total, by surgeon and by procedure. Pulse staff only, like
 * every page under /pulse; an unknown clinic id is not-found. The range
 * (30 or 90 days, or two dates) is the same as on /pulse/reports, the
 * surgeon and procedure tables each have a Download CSV button, and the
 * numbers mean what lib/reports.ts says they mean.
 */
export const dynamic = "force-dynamic";

export default async function PulseClinicReportPage({ params, searchParams }: PageProps<"/pulse/reports/clinics/[id]">) {
  await requirePulseStaff();

  const { id } = await params;
  const now = new Date();
  const { range, problem } = readReportRange(await searchParams, now);
  const window = { since: range.since, until: range.until };

  const report = await getClinicReport(id, window, now);
  if (!report) notFound();
  const { clinic } = report;

  const path = `/pulse/reports/clinics/${clinic.id}`;
  /** The Download CSV address of one of this clinic's tables, for the range on screen. */
  const csvHref = (table: string) => reportHref("/pulse/reports/export", range, { table, clinic: clinic.id });

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href={reportHref("/pulse/reports", range)} className="text-sm text-[#5fb8d4] hover:underline">
            All reports
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold sm:text-3xl">{clinic.name}</h1>
            <StatusBadge status={clinic.status} />
          </div>
          <p className="mt-1 text-[#bfbfbf]">
            <Link href={`/pulse/clinics/${clinic.id}`} className="text-[#5fb8d4] hover:underline">
              Open the clinic&rsquo;s page
            </Link>
          </p>
        </header>

        <Section title="Right now">
          <dl className="grid gap-4 text-[15px] sm:grid-cols-3">
            <div>
              <dt className="text-[#667085]">Categories on the plan</dt>
              <dd className="mt-0.5 text-white">{clinic.categories.length === 0 ? "None yet" : clinic.categories.map(categoryLabel).join(", ")}</dd>
            </div>
            <div>
              <dt className="text-[#667085]">Seats</dt>
              <dd className="mt-0.5 text-white">
                {clinic.seatsInUse} of {clinic.surgeonSeats} in use
                <span className="block text-sm text-[#667085]">
                  {clinic.open ? SEAT_SOURCE_WORDS[seatSourceOf(clinic)] : "Clinic not open"}. People holding a seat plus open invitations.
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[#667085]">Waiting to be turned back on</dt>
              <dd className="mt-0.5 text-white">
                {count(report.waitingNow)} paused {report.waitingNow === 1 ? "link" : "links"}
              </dd>
            </div>
          </dl>
        </Section>

        <RangeControls path={path} range={range} problem={problem} now={now} />

        <Section title="Links made in this period">
          <CountTiles counts={report.links} />
        </Section>

        <Section title="By surgeon" blurb="Who the links are from. The name is the one patients saw on the surgeon's newest link in this period.">
          <CsvLink href={csvHref("surgeons")} />
          {report.surgeons.length === 0 ? (
            <Empty>No links were made in this period.</Empty>
          ) : (
            <>
              <CountsTable
                firstHeading="Surgeon"
                rows={report.surgeons.map((row) => ({
                  key: row.userId ?? "none",
                  label: row.name ?? (row.userId === null ? "No surgeon recorded (older links)" : "Name not recorded"),
                  counts: row,
                }))}
              />
              {report.surgeonsCapped && (
                <p className="mt-2 text-sm text-[#667085]">Showing the {REPORT_SURGEON_LIMIT} surgeons with the most links; the rest are left off.</p>
              )}
            </>
          )}
        </Section>

        <Section title="By procedure">
          <CsvLink href={csvHref("procedures")} />
          <ProcedureTable rows={report.procedures} capped={report.proceduresCapped} limit={REPORT_PROCEDURE_LIMIT} />
        </Section>

        <Section title="What the numbers mean">
          <Definitions />
        </Section>
      </div>
    </main>
  );
}
