import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text and numbers alone, and writes null as an empty cell", () => {
    expect(csvCell("Knee")).toBe("Knee");
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

  it("turns anything a spreadsheet would run as a formula into plain text", () => {
    expect(csvCell("=HYPERLINK(\"http://example.com\")")).toBe('"\'=HYPERLINK(""http://example.com"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tlead")).toBe("'\tlead");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark for Excel, puts the headings first, and ends every line in CRLF", () => {
    expect(toCsv(["A", "B"], [["x", 1], [null, "y, z"]])).toBe('﻿A,B\r\nx,1\r\n,"y, z"\r\n');
  });
});
