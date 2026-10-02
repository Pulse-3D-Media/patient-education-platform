/**
 * Paging for the long lists on /pulse (the clinics table, a clinic's notes):
 * a list that can keep growing is read one page at a time, never whole
 * (rule 8 in CLAUDE.md, "lists and histories are bounded").
 *
 * Pure: no database, safe anywhere. Pages are numbered from 1.
 */

/** The highest page number that is taken seriously. Far past any real list; it only keeps a typed-in number from becoming a huge skip. */
export const MAX_PAGE = 10_000;

/**
 * The page number from an address such as /pulse?page=3. Anything that is
 * not a whole number from 1 up (missing, "abc", "0", "-2", "1.5", a list)
 * means the first page; it is never an error.
 */
export function readPage(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value.trim())) return 1;
  const page = Number(value.trim());
  return page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/** How many pages `total` rows make at `pageSize` rows a page. At least 1, so an empty list still has a first page. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** `page` pulled back inside the list: page 9 of a 3-page list is page 3. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

/** What one page of a list is, in numbers a page can print: "Showing 51 to 100 of 132". */
export type PageInfo = {
  page: number;
  pages: number;
  total: number;
  /** The position of the first row on this page, counting from 1. 0 when the list is empty. */
  from: number;
  /** The position of the last row on this page. 0 when the list is empty. */
  to: number;
  /** The page before this one, or null on the first page. */
  previous: number | null;
  /** The page after this one, or null on the last page. */
  next: number | null;
};

/** Everything a page needs to say where it is in a list. `page` is clamped first, so the answer always describes a real page. */
export function pageInfo(page: number, total: number, pageSize: number): PageInfo {
  const pages = pageCount(total, pageSize);
  const current = clampPage(page, total, pageSize);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  return { page: current, pages, total, from, to, previous: current > 1 ? current - 1 : null, next: current < pages ? current + 1 : null };
}
