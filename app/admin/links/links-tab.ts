/**
 * Which of Shared links' two tabs an address asks for (Evan, 2026-11-20):
 * "Temporary patient link" (making a link, the default) or "Permanent QR
 * code" (the printed codes). Plain and pure, so the page and its tests share
 * it. The tab only decides what is drawn; every action checks as before.
 */

export type LinksTab = "link" | "qr";

/** The address of each tab. */
export const LINKS_TAB_HREF: Record<LinksTab, string> = { link: "/admin/links", qr: "/admin/links?tab=qr" };

/** ?tab=qr, or an address naming a printed code (?code=<id> from the overview, or ?item=code-<id> or new-code), opens "qr"; anything else "link". */
export function readLinksTab(params: Record<string, string | string[] | undefined>): LinksTab {
  if (params.tab === "qr" || typeof params.code === "string") return "qr";
  if (typeof params.item === "string" && (params.item.startsWith("code-") || params.item === "new-code")) return "qr";
  return "link";
}
