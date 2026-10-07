/**
 * Turning rows into a CSV file a spreadsheet opens cleanly. Pure, no
 * database, safe anywhere. Used by the Pulse reports' Download CSV buttons
 * (app/pulse/reports/export/route.ts).
 *
 * Three things a plain join(",") would get wrong:
 *   - A cell with a comma, a quote or a line break is wrapped in quotes,
 *     with any quote inside doubled ("Smith, Jane" stays one cell).
 *   - A cell that starts with = + - @ (or a tab or carriage return) is a
 *     formula to Excel and Google Sheets, so a clinic named "=HYPERLINK(...)"
 *     could run something when the file is opened. Such a cell gets a ' in
 *     front, which spreadsheets show as plain text. Numbers are left alone,
 *     so a negative number stays a number.
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
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: a heading row, then the rows. */
export function toCsv(headings: string[], rows: CsvCell[][]): string {
  const lines = [headings, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
