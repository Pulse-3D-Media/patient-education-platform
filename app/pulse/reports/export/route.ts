import { getClinicNameForReport, listCategoryReportRows, listClinicReportRows, listProcedureReportRows, listSurgeonReportRows, REPORT_EXPORT_LIMIT } from "@/lib/db/reports";
import { errorKind } from "@/lib/error-kind";
import { isPulseStaff } from "@/lib/pulse";
import { categoriesCsv, clinicsCsv, exportFileName, proceduresCsv, readExportTable, surgeonsCsv } from "@/lib/report-csv";
import { rangeFileTag, readReportRange } from "@/lib/reports";

/**
 * GET /pulse/reports/export: the Download CSV buttons on the Pulse reports.
 *
 *   ?table=categories | procedures | clinics | surgeons
 *   &clinic=<id>        one clinic's table (procedures or surgeons; surgeons needs it)
 *   &days=90 or &from=2026-09-01&to=2026-09-30   the same range as the page
 *
 * Pulse staff only, checked here on every request (the proxy only sends a
 * signed-out visitor to sign in): anyone else gets a plain 404, as the pages
 * give them. The numbers are counted exactly as the page counts them
 * (lib/db/reports.ts), at most REPORT_EXPORT_LIMIT rows a file, and the file
 * holds what the table on the page holds and nothing more (lib/report-csv.ts).
 * Never cached. A failure is logged as its kind only.
 */
export const dynamic = "force-dynamic";

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  let staff = false;
  try {
    staff = await isPulseStaff();
  } catch (error) {
    console.error("Report export: sign-in could not be checked", errorKind(error));
    return plain(503, "We could not reach sign-in just now. Try again in a moment.");
  }
  if (!staff) return plain(404, "Not found.");

  const params = new URL(request.url).searchParams;
  const table = readExportTable(params.get("table"));
  if (!table) return plain(400, "That table cannot be downloaded.");

  const now = new Date();
  const { range, problem } = readReportRange({ days: params.get("days") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, now);
  // The page only ever links to a range it could read, so a problem here is a hand-made address.
  if (problem) return plain(400, problem);
  const window = { since: range.since, until: range.until };

  const clinicId = params.get("clinic");
  let clinicName: string | undefined;
  if (clinicId) {
    if (table === "categories" || table === "clinics") return plain(400, "That table is for the whole platform, not one clinic.");
    let name: string | null;
    try {
      name = await getClinicNameForReport(clinicId);
    } catch (error) {
      console.error("Report export failed", errorKind(error));
      return plain(500, "The file could not be made just now. Try again in a moment.");
    }
    if (name === null) return plain(404, "Not found.");
    clinicName = name;
  } else if (table === "surgeons") {
    return plain(400, "Choose a clinic for its surgeons.");
  }

  try {
    let body: string;
    if (table === "categories") body = categoriesCsv(await listCategoryReportRows(window));
    else if (table === "clinics") body = clinicsCsv((await listClinicReportRows(window, 1, REPORT_EXPORT_LIMIT)).rows);
    else if (table === "procedures") body = proceduresCsv((await listProcedureReportRows(clinicId, window, REPORT_EXPORT_LIMIT)).rows);
    else body = surgeonsCsv((await listSurgeonReportRows(clinicId as string, window, REPORT_EXPORT_LIMIT)).rows);

    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFileName(table, rangeFileTag(range), clinicName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Report export failed", errorKind(error));
    return plain(500, "The file could not be made just now. Try again in a moment.");
  }
}
