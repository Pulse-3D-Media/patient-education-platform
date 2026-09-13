/**
 * The sections of the clinic admin area (app/admin), in the order the
 * navigation shows them, and the rule for which one a given address belongs
 * to. Pure: no database, no Clerk, safe for the browser, so the navigation
 * component and its test can both use it.
 *
 * Each section has one job (see "The four surfaces" in CLAUDE.md). Adding a
 * section is one entry here; the navigation renders from this list.
 */

export type AdminSection = {
  href: "/admin" | "/admin/links" | "/admin/people" | "/admin/billing" | "/admin/reports";
  label: string;
  /** One line under the title on that section's page, and the description on the overview's cards. */
  blurb: string;
  /** True for a section that exists as a placeholder page only. */
  coming?: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: "/admin", label: "Overview", blurb: "What needs a look, and the way into each section." },
  { href: "/admin/links", label: "Shared links", blurb: "Create a link for a procedure, copy it, download its QR code, print a pamphlet, or cancel it." },
  { href: "/admin/people", label: "People", blurb: "Everyone who can sign in, who is a surgeon, and who is an admin." },
  { href: "/admin/billing", label: "Billing", blurb: "The categories and surgeon seats on your plan, and what it comes to." },
  { href: "/admin/reports", label: "Reports", blurb: "How your links get used. Coming later.", coming: true },
];

/**
 * Which section an address under /admin belongs to, so the navigation can
 * mark it as the current page. The overview matches only its own address;
 * every other section matches itself and everything under it. The QR
 * picture and the printable pamphlet belong to Shared links, since that is
 * where their buttons are. Null for an address that is not in the admin
 * area at all.
 */
export function activeAdminSection(pathname: string): AdminSection["href"] | null {
  if (pathname === "/admin") return "/admin";
  if (under(pathname, "/admin/links") || under(pathname, "/admin/print") || under(pathname, "/admin/qr")) return "/admin/links";
  for (const section of ADMIN_SECTIONS) {
    if (section.href !== "/admin" && under(pathname, section.href)) return section.href;
  }
  return null;
}

/** True when the address is this path or something beneath it ("/admin/people" and "/admin/people/anything", not "/admin/peoples"). */
function under(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}
