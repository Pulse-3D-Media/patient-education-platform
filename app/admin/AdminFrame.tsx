import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { AdminNav } from "@/components/ui/AdminNav";

/**
 * The frame every clinic admin page draws itself inside: the app shell
 * (banner, rail, category drawer), the clinic's name, the row of section
 * links, and then the page's own title and content.
 *
 * Only the page decides whether the person may see it: this frame is
 * drawn AFTER the page has checked that they are an admin (a member gets
 * <AdminsOnly /> with no frame and no navigation). A closed clinic's admin
 * does get the frame, so the row of links is how they reach Billing, the
 * page that stays open when the rest is closed.
 *
 * No state here; the navigation itself is the one client piece.
 */
export function AdminFrame({
  clinicName,
  title,
  intro,
  wide = false,
  children,
}: {
  clinicName: string;
  title: string;
  /** One or two plain sentences under the title, or nothing. */
  intro?: ReactNode;
  /** True for the pages that hold lists (shared links), which want the full width. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <AppShell showAdmin>
      <main className="px-5 py-6 sm:px-8">
        <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
          <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{clinicName}</p>
          <div className="mt-2">
            <AdminNav />
          </div>
          <header className="mt-6">
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            {intro && <p className="mt-1 max-w-2xl text-[#bfbfbf]">{intro}</p>}
          </header>
          {children}
        </div>
      </main>
    </AppShell>
  );
}
