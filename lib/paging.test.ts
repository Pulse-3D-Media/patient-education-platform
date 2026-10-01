import { describe, expect, it } from "vitest";
import { MAX_PAGE, clampPage, pageCount, pageInfo, readPage } from "./paging";

/** The paging rules with plain values: reading a page number from an address, and saying where a page sits in a list. */

describe("readPage", () => {
  it("reads a whole number from 1 up", () => {
    expect(readPage("1")).toBe(1);
    expect(readPage("3")).toBe(3);
    expect(readPage(" 12 ")).toBe(12);
  });

  it("treats anything else as the first page, never as an error", () => {
    for (const junk of [undefined, null, "", "abc", "0", "-2", "1.5", "2e3", "3; DROP TABLE", ["2", "3"], 4, {}]) {
      expect(readPage(junk)).toBe(1);
    }
  });

  it("stops a huge number from becoming a huge skip", () => {
    expect(readPage("999999")).toBe(MAX_PAGE);
    expect(readPage("99999999999999999999")).toBe(1);
  });
});

describe("pageCount and clampPage", () => {
  it("counts pages, and an empty list still has one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(1, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(132, 50)).toBe(3);
  });

  it("pulls a page past the end back to the last page, and one before the start to the first", () => {
    expect(clampPage(9, 132, 50)).toBe(3);
    expect(clampPage(3, 132, 50)).toBe(3);
    expect(clampPage(0, 132, 50)).toBe(1);
    expect(clampPage(5, 0, 50)).toBe(1);
  });
});

describe("pageInfo", () => {
  it("describes the first, a middle and the last page", () => {
    expect(pageInfo(1, 132, 50)).toEqual({ page: 1, pages: 3, total: 132, from: 1, to: 50, previous: null, next: 2 });
    expect(pageInfo(2, 132, 50)).toEqual({ page: 2, pages: 3, total: 132, from: 51, to: 100, previous: 1, next: 3 });
    expect(pageInfo(3, 132, 50)).toEqual({ page: 3, pages: 3, total: 132, from: 101, to: 132, previous: 2, next: null });
  });

  it("describes a list that fits on one page, and an empty one", () => {
    expect(pageInfo(1, 7, 50)).toEqual({ page: 1, pages: 1, total: 7, from: 1, to: 7, previous: null, next: null });
    expect(pageInfo(1, 0, 50)).toEqual({ page: 1, pages: 1, total: 0, from: 0, to: 0, previous: null, next: null });
  });

  it("describes a real page even when asked for one past the end", () => {
    expect(pageInfo(40, 132, 50)).toMatchObject({ page: 3, from: 101, to: 132, next: null });
  });
});
