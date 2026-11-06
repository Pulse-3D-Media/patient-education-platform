import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("quotes plain text, leaves numbers bare, and writes null as an empty cell", () => {
    expect(csvCell("Knee")).toBe('"Knee"');
    expect(csvCell("")).toBe('""');
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("quotes a cell with a comma, a quote or a line break, doubling the quotes inside", () => {
    expect(csvCell("Dr. Jane Smith, DO")).toBe('"Dr. Jane Smith, DO"');
    expect(csvCell('The "Best" Clinic')).toBe('"The ""Best"" Clinic"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("keeps a semicolon inside its cell, for spreadsheets that separate with semicolons", () => {
    expect(csvCell("Smith; Jones Ortho")).toBe('"Smith; Jones Ortho"');
  });

  it("turns anything a spreadsheet would run as a formula into plain text", () => {
    expect(csvCell("=HYPERLINK(\"http://example.com\")")).toBe('"\'=HYPERLINK(""http://example.com"")"');
    expect(csvCell("+1")).toBe('"\'+1"');
    expect(csvCell("-2")).toBe('"\'-2"');
    expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
    expect(csvCell("\tlead")).toBe('"\'\tlead"');
  });

  // The audit's section 15 cases: a formula hidden behind a line break or a
  // space, and the full-width forms of = + - @ (which some spreadsheets read
  // as the plain ones). Each must get the protective apostrophe.
  it.each(["\n=1+1", " =1+1", "＝1+1", "＋1", "－1", "＠SUM(A1)"])("neutralizes %j", (value) => {
    expect(csvCell(value).startsWith("\"'")).toBe(true);
  });

  it("looks past every kind of leading space, control and hidden character", () => {
    for (const lead of ["\r", "\t", "\n\n", " ", "　", "​", "‮", "﻿", " \n ​"]) {
      expect(csvCell(`${lead}=1+1`)).toBe(`"'${lead}=1+1"`);
    }
    // The small forms too, which read as the plain sign once normalized.
    expect(csvCell("﹢1")).toBe(`"'﹢1"`);
  });

  it("leaves ordinary text alone, a sign that is not first included", () => {
    expect(csvCell("Knee")).toBe('"Knee"');
    expect(csvCell(" Knee")).toBe('" Knee"');
    expect(csvCell("Smith-Jones Ortho")).toBe('"Smith-Jones Ortho"');
    expect(csvCell("A+ Orthopedics")).toBe('"A+ Orthopedics"');
    expect(csvCell("   ")).toBe('"   "');
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark for Excel, puts the headings first, and ends every line in CRLF", () => {
    expect(toCsv(["A", "B"], [["x", 1], [null, "y, z"]])).toBe('﻿"A","B"\r\n"x",1\r\n,"y, z"\r\n');
  });
});
