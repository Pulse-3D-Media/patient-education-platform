import { ClinicStatus } from "@prisma/client";
import Link from "next/link";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { listClinicsForPulse, type PulseClinicRow } from "@/lib/db/clinics";
import { listPeople } from "@/lib/people";
import { requirePulseStaff } from "@/lib/pulse";
import { StatusBadge, formatDate, statusLabel } from "./ui";

/**
 * The clinics table: every clinic on the platform, one row each, sorted by
 * whoever made a share link most recently. Search by name and filter by
 * status through the form at the top (a plain GET form, so the address bar
 * carries the search and a page reload keeps it).
 *
 * "Seats" reads "in use / paid": how many people the clinic has marked as
 * surgeons in Clerk, over the seats on its plan. The in-use number comes
 * from Clerk one clinic at a time; with the handful of clinics we have that
 * is quick, and a clinic Clerk cannot answer for shows a dash rather than
 * breaking the page.
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

  const clinics = await listClinicsForPulse({ query, status });
  const seatsInUse = await Promise.all(clinics.map(countSurgeons));

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
          {clinics.length} {clinics.length === 1 ? "clinic" : "clinics"}
          {filtering ? " match" : ""}
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
                  <th className="px-4 py-3 text-right font-medium">Seats in use / paid</th>
                  <th className="px-4 py-3 text-right font-medium">Links, 30 days</th>
                  <th className="px-4 py-3 font-medium">Last link</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((clinic, index) => (
                  <tr key={clinic.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[.03]">
                    <td className="px-4 py-3">
                      <Link href={`/pulse/clinics/${clinic.id}`} className="font-medium text-white hover:text-[#5fb8d4]">
                        {clinic.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={clinic.status} />
                    </td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{clinic.managedByPulse ? "By Pulse" : "Self-serve"}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{clinic.categories.length}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">
                      {seatsInUse[index] ?? "–"} / {clinic.surgeonSeats}
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
      </div>
    </main>
  );
}

/** How many people this clinic has marked as surgeons in Clerk, or null when Clerk cannot say. */
async function countSurgeons(clinic: PulseClinicRow): Promise<number | null> {
  if (!clinic.clerkOrgId) return null;
  try {
    const people = await listPeople(clinic.clerkOrgId);
    return people.filter((person) => person.kind === "surgeon").length;
  } catch {
    return null;
  }
}
