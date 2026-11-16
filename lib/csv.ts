/**
 * Turning rows into a CSV file a spreadsheet opens cleanly. Pure, no
 * database, safe anywhere. Used by the Pulse reports' Download CSV buttons
 * (app/pulse/reports/export/route.ts).
 *
 * Three things a plain join(",") would get wrong:
 *   - Every text cell is wrapped in quotes, with any quote inside doubled
 *     ("Smith, Jane" stays one cell). Not only cells with a comma: a
 *     spreadsheet set to a language that separates with semicolons would
 *     otherwise split "Smith; Jane" in two. Numbers and empty cells are
 *     left bare, so a number stays a number.
 *   - A cell that starts with = + - @ is a formula to Excel and Google
 *     Sheets, so a clinic named "=HYPERLINK(...)" could run something when
 *     the file is opened. Such a cell gets a ' in front, which spreadsheets
 *     show as plain text. "Starts with" looks past leading spaces, line
 *     breaks, tabs and invisible characters, and counts the full-width
 *     forms of the four signs as the plain ones (looksLikeFormula below).
 *     Numbers are left alone, so a negative number stays a number.
 *   - Excel reads a file without a byte-order mark as the old Windows
 *     alphabet and garbles "Foot & Ankle"-style text and curly quotes, so
 *     the file starts with one. Lines end in CRLF, as the CSV standard says.
 */

export type CsvCell = string | number | null;

/** One cell as CSV text. Null is an empty cell. */
export function csvCell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (looksLikeFormula(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Whether a spreadsheet could read this text as a formula. Leading spaces,
 * line breaks, tabs, other control characters and invisible characters (a
 * zero-width space, a direction mark) are looked past first, because a
 * spreadsheet may skip them too. The first character left is then
 * normalized (NFKC), so the full-width and small forms of = + - @ count as
 * the plain ones. Text with a sign further in ("A+ Orthopedics") is left
 * alone.
 */
function looksLikeFormula(text: string): boolean {
  // A leading tab or carriage return has always been treated as a formula
  // start on its own (the usual guidance lists both), whatever follows.
  if (/^[\t\r]/.test(text)) return true;
  const rest = text.replace(/^[\s\p{Cc}\p{Cf}]+/u, "");
  const first = Array.from(rest)[0];
  if (first === undefined) return false;
  return /^[=+\-@]/.test(first.normalize("NFKC"));
}

/** A whole file: a heading row, then the rows. */
export function toCsv(headings: string[], rows: CsvCell[][]): string {
  const lines = [headings, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
