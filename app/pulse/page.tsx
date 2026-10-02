import { ClinicStatus } from "@prisma/client";
import Link from "next/link";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { PULSE_CLINICS_PAGE_SIZE, listClinicsForPulse } from "@/lib/db/clinics";
import { pageInfo, readPage } from "@/lib/paging";
import { requirePulseStaff } from "@/lib/pulse";
import { Pager, StatusBadge, formatDate, statusLabel } from "./ui";

/**
 * The clinics table: every clinic on the platform, one row each, sorted by
 * whoever made a share link most recently. Search by name and filter by
 * status through the form at the top (a plain GET form, so the address bar
 * carries the search and a page reload keeps it).
 *
 * Shown a page at a time (PULSE_CLINICS_PAGE_SIZE rows), with Previous and
 * Next under the table; the page number is in the address too (?page=2). The
 * search, the sort and the paging all happen in the database, so this page
 * never loads every clinic, however many there are.
 *
 * "Seats taken / paid": seats held by people plus seats held by open
 * invitations, over the seats on the plan, from our own tables (see
 * lib/seats.ts). A row reading 4 / 3 is a clinic over its plan. People
 * waiting for a seat are not in the first number; they are on the clinic's
 * own page, People tab, which also brings the seats into line with Clerk.
 * "No account owner" beside a name means the clinic has none on record.
 *
 * Staff only. Rendered fresh on every request.
 */
export const dynamic = "force-dynamic";

const STATUSES = Object.values(ClinicStatus);

export default async function PulseClinicsPage({ searchParams }: PageProps<"/pulse">) {
  await requirePulseStaff();

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const statusParam = typeof params.status === "string" ? params.status : "";
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as ClinicStatus) : undefined;
  const filtering = Boolean(query) || Boolean(status);

  const { rows: clinics, total, page } = await listClinicsForPulse({ query, status, page: readPage(params.page) });
  const info = pageInfo(page, total, PULSE_CLINICS_PAGE_SIZE);

  /** The address of another page of the same search. */
  function hrefFor(target: number) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status) search.set("status", status);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text ? `/pulse?${text}` : "/pulse";
  }

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header>
          <h1 className="text-2xl font-semibold sm:text-3xl">Clinics</h1>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            Every clinic on the platform. Open one to change its status, plan, details or notes.
          </p>
        </header>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3" role="search">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
              Search by name
            </label>
            <input id="q" name="q" type="search" defaultValue={query} placeholder="Clinic name" className={INPUT} />
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? ""} className={`${INPUT} w-44`}>
              <option value="">Any status</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${PRIMARY_BUTTON} h-11`}>
            Search
          </button>
          {filtering && (
            <Link href="/pulse" className={`${SECONDARY_BUTTON} h-11`}>
              Show all
            </Link>
          )}
        </form>

        <p className="mt-6 text-sm text-[#667085]">
          {total} {total === 1 ? "clinic" : "clinics"}
          {filtering ? (total === 1 ? " matches" : " match") : ""}
          {info.pages > 1 ? `. Showing ${info.from} to ${info.to}.` : ""}
        </p>

        {clinics.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-white/15 p-6 text-[#bfbfbf]">
            {filtering ? "No clinics match that search." : "No clinics yet. The first one appears when someone signs up."}
          </p>
        ) : (
          // The table scrolls sideways inside this box on a narrow screen, so
          // the page itself never overflows.
          <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1113]">
            <table className="w-full min-w-[880px] text-left text-[15px]">
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Clinic</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Managed</th>
                  <th className="px-4 py-3 text-right font-medium">Categories</th>
                  <th className="px-4 py-3 text-right font-medium">Seats taken / paid</th>
                  <th className="px-4 py-3 text-right font-medium">Links, 30 days</th>
                  <th className="px-4 py-3 font-medium">Last link</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((clinic) => (
                  <tr key={clinic.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[.03]">
                    <td className="px-4 py-3">
                      <Link href={`/pulse/clinics/${clinic.id}`} className="font-medium text-white hover:text-[#5fb8d4]">
                        {clinic.name}
                      </Link>
                      {/* Made before owners existed, or its owner left without handing over. Set one on the clinic's People tab. */}
                      {!clinic.hasOwner && clinic.clerkOrgId && <span className="ml-2 whitespace-nowrap text-xs text-[#f3b94d]">No account owner</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={clinic.status} />
                    </td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{clinic.managedByPulse ? "By Pulse" : "Self-serve"}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{clinic.categories.length}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">
                      {clinic.seatsInUse} / {clinic.surgeonSeats}
                    </td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{clinic.recentLinks}</td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{clinic.lastLinkAt ? formatDate(clinic.lastLinkAt) : "Never"}</td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{formatDate(clinic.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager info={info} hrefFor={hrefFor} />
      </div>
    </main>
  );
}

