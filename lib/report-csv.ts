import type { CategoryReportRow, ClinicReportRow, ProcedureReportRow, SurgeonReportRow } from "./db/reports";
import { CATEGORIES } from "./categories";
import { toCsv, type CsvCell } from "./csv";
import type { LinkCounts } from "./reports";

/**
 * The Pulse reports' Download CSV files: which columns each table has, and
 * the file's name. Pure: it is handed rows already counted by
 * lib/db/reports.ts and only turns them into text. Each file holds exactly
 * what the table on the page holds (no link code, no Clerk id, nothing
 * about a patient), under the same headings, for the same dates.
 */

/** The tables that can be downloaded. `surgeons` is one clinic's only; `procedures` is the platform's or one clinic's. */
export const EXPORT_TABLES = ["categories", "procedures", "clinics", "surgeons"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** The table named in a download address, or null for anything else. */
export function readExportTable(value: unknown): ExportTable | null {
  return typeof value === "string" && (EXPORT_TABLES as readonly string[]).includes(value) ? (value as ExportTable) : null;
}

const COUNT_HEADINGS = ["Links made", "Played", "Played rate (%)", "Play starts", "Renewal requests", "Renewals"];

/** The six count cells. The rate is a whole percent, and empty (not 0) when no links were made, as the page shows a dash. */
function countCells(counts: LinkCounts): CsvCell[] {
  const rate = counts.made > 0 ? Math.round((counts.played / counts.made) * 100) : null;
  return [counts.made, counts.played, rate, counts.playStarts, counts.renewalRequests, counts.renewals];
}

/** The status as the dashboard's badge says it. */
const STATUS_WORDS: Record<ClinicReportRow["status"], string> = { PENDING: "Pending", ACTIVE: "Active", PAUSED: "Paused", PAST_DUE: "Past due", CANCELED: "Canceled" };

function categoryLabel(category: string) {
  return CATEGORIES.find((entry) => entry.value === category)?.label ?? category;
}

export function categoriesCsv(rows: CategoryReportRow[]): string {
  return toCsv(["Category", ...COUNT_HEADINGS], rows.map((row) => [categoryLabel(row.category), ...countCells(row)]));
}

export function proceduresCsv(rows: ProcedureReportRow[]): string {
  return toCsv(
    ["Procedure", "Category", "Placeholder", ...COUNT_HEADINGS],
    rows.map((row) => [row.title, categoryLabel(row.category), row.isPlaceholder ? "Yes" : "No", ...countCells(row)]),
  );
}

export function clinicsCsv(rows: ClinicReportRow[]): string {
  return toCsv(
    ["Clinic", "Status", "Managed by Pulse", "Categories on plan", "Seats in use", "Seats on plan", ...COUNT_HEADINGS],
    rows.map((row) => [row.name, STATUS_WORDS[row.status], row.managedByPulse ? "Yes" : "No", row.categoryCount, row.seatsInUse, row.surgeonSeats, ...countCells(row)]),
  );
}

/** The surgeon's name as patients saw it; never their Clerk id. */
export function surgeonsCsv(rows: SurgeonReportRow[]): string {
  return toCsv(
    ["Surgeon", ...COUNT_HEADINGS],
    rows.map((row) => [row.name ?? (row.userId === null ? "No surgeon recorded (older links)" : "Name not recorded"), ...countCells(row)]),
  );
}

/** "pulse-report-procedures-2026-09-01-to-2026-09-30.csv", or with the clinic's name in it for one clinic's table. Only letters, digits and hyphens. */
export function exportFileName(table: ExportTable, dates: string, clinicName?: string): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const clinic = clinicName ? `${slug(clinicName) || "clinic"}-` : "";
  return `pulse-report-${clinic}${table}-${dates}.csv`;
}
