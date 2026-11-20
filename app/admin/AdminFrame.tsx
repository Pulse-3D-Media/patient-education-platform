import type { ReactNode } from "react";
import { AdminPills } from "@/components/ui/AdminPills";
import { ClinicShell } from "@/components/ui/ClinicShell";
import type { CurrentClinic } from "@/lib/clinic";

/**
 * The frame every clinic admin page draws itself inside: the same frame as
 * the library (ClinicShell and its side rail, Evan, 2026-11-20: Home,
 * Library and Admin, with the admin pages under Admin when the rail opens;
 * on a phone the admin pages as a row of pills under the top bar) in the
 * clinic's own branding, then the page's own title and content.
 *
 * Only the page decides whether the person may see it: this frame is
 * drawn AFTER the page has checked that they are an admin (a member gets
 * <AdminsOnly /> with no frame and no navigation). A closed clinic's admin
 * does get the frame, so the rail (or the row of pills on a phone) is how
 * they reach Billing, the page that stays open when the rest is closed.
 * (The rail also lists the library, whose pages say for themselves that the
 * clinic is closed: a link shown grants nothing.)
 *
 * `bare` is for the pages that lay themselves out: the list-and-detail
 * pages (SplitView.tsx), whose title sits at the top of the list, and the
 * one-column pages that draw their own header (DetailParts.tsx). Every page
 * still has exactly one main landmark and one top-level heading.
 *
 * It takes the clinic the page already fetched (requireClinicPage), so the
 * branding, the categories and the setup reminder cost no extra read. The
 * look is worked out on the server (ClinicShell, staffLook()), and only the
 * checked values go to the browser.
 */
export function AdminFrame({
  clinic,
  title,
  intro,
  wide = false,
  bare = false,
  children,
}: {
  clinic: CurrentClinic;
  /** The page's title. Not drawn when `bare` is set: the page draws its own. */
  title: string;
  /** One or two plain sentences under the title, or nothing. */
  intro?: ReactNode;
  /** True for the pages that hold lists (shared links), which want the full width. */
  wide?: boolean;
  /** True for a page that lays itself out (see above). */
  bare?: boolean;
  children: ReactNode;
}) {
  if (bare) {
    return (
      <ClinicShell clinic={clinic} showAdmin={clinic.isAdmin} phoneNav={<AdminPills />}>
        <main>{children}</main>
      </ClinicShell>
    );
  }
  return (
    <ClinicShell clinic={clinic} showAdmin={clinic.isAdmin} phoneNav={<AdminPills />}>
      <main className="px-4 py-6 sm:px-8 sm:py-8">
        <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
          <header>
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            {intro && <p className="mt-1 max-w-2xl text-ink-soft">{intro}</p>}
          </header>
          {children}
        </div>
      </main>
    </ClinicShell>
  );
}
