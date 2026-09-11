import Link from "next/link";
import { notFound } from "next/navigation";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { getClinicForPulse } from "@/lib/db/clinics";
import { getSettings } from "@/lib/db/settings";
import { listSharesForClinic } from "@/lib/db/shares";
import { listPeople, type Person } from "@/lib/people";
import { formatUsPhone } from "@/lib/phone";
import { requirePulseStaff } from "@/lib/pulse";
import { Section, StatusBadge, formatDate, formatDateTime } from "../../ui";
import { DetailsForm, ManagedForm, NotesBox, PlanForm, StatusForm } from "./forms";

/**
 * One clinic, everything Pulse staff can see and change about it.
 *
 * The editable sections (status, plan, managed by Pulse, details, notes)
 * are forms in forms.tsx, each saving through its own Server Action. Below
 * them, read-only: the clinic's people from Clerk, its recent share links
 * (the same list its own admin console shows), and when it was created.
 *
 * Staff only. Rendered fresh on every request so a save is seen at once.
 */
export const dynamic = "force-dynamic";

/** How many of the clinic's newest links to show. The admin console shows them all. */
const RECENT_LINK_LIMIT = 20;

export default async function PulseClinicPage({ params }: PageProps<"/pulse/clinics/[id]">) {
  await requirePulseStaff();

  const { id } = await params;
  const clinic = await getClinicForPulse(id);
  if (!clinic) notFound();

  const [settings, shares, people] = await Promise.all([
    getSettings(),
    listSharesForClinic(clinic.id),
    clinic.clerkOrgId ? listPeople(clinic.clerkOrgId).catch(() => null) : Promise.resolve(null),
  ]);
  const now = new Date();
  const surgeons = people?.filter((person) => person.kind === "surgeon").length;

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header>
          <p className="text-sm text-[#667085]">
            <Link href="/pulse" className="hover:text-white">
              Clinics
            </Link>
            <span className="mx-2">/</span>
            <span className="text-[#bfbfbf]">{clinic.name}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold sm:text-3xl">{clinic.name}</h1>
            <StatusBadge status={clinic.status} />
            {clinic.managedByPulse && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">
                Managed by Pulse
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#667085]">
            Created {formatDate(clinic.createdAt)}
            {clinic.phone && <> · {formatUsPhone(clinic.phone)}</>}
            {!clinic.clerkOrgId && <> · Not linked to a Clerk organization yet</>}
          </p>
        </header>

        <div className="mt-8 flex flex-col gap-6">
          <Section
            title="Status"
            blurb={
              clinic.statusChangedAt
                ? `Last changed by ${clinic.statusChangedBy ?? "unknown"} on ${formatDateTime(clinic.statusChangedAt)}${
                    clinic.statusReason ? `: ${clinic.statusReason}` : ""
                  }`
                : "Never changed by hand. New clinics start pending until a plan is chosen or set here."
            }
          >
            <StatusForm clinicId={clinic.id} status={clinic.status} />
          </Section>

          <Section
            title="Plan"
            blurb="Which categories the clinic can use and how many surgeon seats it pays for. Once billing exists, self-serve clinics set this themselves and it becomes read-only here unless the clinic is managed by Pulse."
          >
            <PlanForm clinicId={clinic.id} categories={clinic.categories} surgeonSeats={clinic.surgeonSeats} />
          </Section>

          <Section title="Managed by Pulse">
            <ManagedForm clinicId={clinic.id} managedByPulse={clinic.managedByPulse} />
          </Section>

          <Section title="Clinic details">
            <DetailsForm
              clinicId={clinic.id}
              values={{
                name: clinic.name,
                logoUrl: clinic.logoUrl,
                phone: clinic.phone,
                noticeText: clinic.noticeText,
                showPlaceholders: clinic.showPlaceholders,
                viewDaysOverride: clinic.viewDaysOverride,
                platformViewDays: settings.viewDays,
              }}
            />
          </Section>

          <Section title="Notes" blurb="Internal. The clinic never sees these.">
            <NotesBox clinicId={clinic.id} notes={clinic.notes} />
          </Section>

          <Section
            title="People"
            blurb={
              people === null
                ? "Could not read this clinic's people from Clerk right now."
                : `${people.length} ${people.length === 1 ? "person" : "people"}, ${surgeons} marked as ${surgeons === 1 ? "surgeon" : "surgeons"}, ${clinic.surgeonSeats} ${clinic.surgeonSeats === 1 ? "seat" : "seats"} paid for.`
            }
          >
            {people && people.length > 0 ? <PeopleTable people={people} /> : <p className="text-sm text-[#667085]">Nobody yet.</p>}
          </Section>

          <Section
            title="Recent links"
            blurb={`The newest ${Math.min(shares.length, RECENT_LINK_LIMIT)} of ${shares.length} share ${shares.length === 1 ? "link" : "links"}, as the clinic's admin console lists them.`}
          >
            {shares.length === 0 ? (
              <p className="text-sm text-[#667085]">No links yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[15px]">
                  <thead className="text-xs uppercase tracking-wider text-[#667085]">
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium">Procedure</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Expires</th>
                      <th className="px-3 py-2 text-right font-medium">Views</th>
                      <th className="px-3 py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shares.slice(0, RECENT_LINK_LIMIT).map((share) => {
                      const expired = share.expiresAt < now;
                      return (
                        <tr key={share.id} className="border-b border-white/5 last:border-b-0">
                          <td className="px-3 py-2 text-[#bfbfbf]">{share.code}</td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap items-center gap-2">
                              {share.video.title}
                              {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[#bfbfbf]">{categoryLabel(share.video.category)}</td>
                          <td className={`px-3 py-2 ${expired ? "text-[#667085]" : "text-[#bfbfbf]"}`}>
                            {expired ? `Expired ${formatDate(share.expiresAt)}` : formatDate(share.expiresAt)}
                          </td>
                          <td className="px-3 py-2 text-right text-[#bfbfbf]">{share.viewCount}</td>
                          <td className="px-3 py-2 text-[#bfbfbf]">{formatDate(share.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}

function PeopleTable({ people }: { people: Person[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[15px]">
        <thead className="text-xs uppercase tracking-wider text-[#667085]">
          <tr className="border-b border-white/10">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Kind</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.userId} className="border-b border-white/5 last:border-b-0">
              <td className="px-3 py-2">{person.name}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.email}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.role === "admin" ? "Admin" : "Member"}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.kind === "surgeon" ? "Surgeon" : person.kind === "staff" ? "Staff" : "Not set"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
