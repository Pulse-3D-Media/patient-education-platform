import { auth } from "@clerk/nextjs/server";
import { OrganizationProfile } from "@clerk/nextjs";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { listPeople } from "@/lib/people";
import { KindControl } from "./KindControl";

/**
 * The People section of the admin console, at /admin/people. Admins only.
 *
 * Two parts:
 *
 *   1. Our list of everyone in the clinic, with a Surgeon / Staff control
 *      on each row and a "Surgeons: 3" count at the top. Kind is what the
 *      clinic pays for (lib/roles.ts); it lives on the Clerk membership and
 *      is changed through the Server Action in actions.ts.
 *
 *   2. Clerk's own organization panel, which handles inviting people by
 *      email, changing someone's role (admin or member) and removing them.
 *      Nothing to build for those; Clerk's component does it and enforces
 *      that only admins can. Its Members tab is the one that matters here.
 *
 * Seat limits come with billing. Until then a clinic may mark as many
 * surgeons as it likes.
 */
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <AppShell>
        <AdminsOnly />
      </AppShell>
    );
  }

  if (!clinicIsOpen(clinic.status)) {
    return (
      <AppShell showAdmin>
        <ClinicClosed status={clinic.status} clinicName={clinic.name} />
      </AppShell>
    );
  }

  // The organization id is needed to list its people. It is read from the
  // session here and handed to lib/people; it never goes to the browser or
  // to lib/db.
  const { orgId, userId } = await auth();
  const people = orgId ? await listPeople(orgId) : [];
  const surgeons = people.filter((person) => person.kind === "surgeon").length;
  const unanswered = people.filter((person) => person.kind === null).length;

  return (
    <AppShell showAdmin>
      <main className="px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <header>
            <p className="text-sm text-[#667085]">
              <Link href="/admin" className="hover:text-white">
                Share links
              </Link>
              <span className="mx-2">/</span>
              <span className="text-[#bfbfbf]">People</span>
            </p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">People</h1>
            <p className="mt-1 max-w-2xl text-[#bfbfbf]">
              Everyone who can sign in to {clinic.name}. Surgeons are what your clinic pays for; staff are free. Neither
              changes what a person can do: that is their role, set in the panel further down.
            </p>
          </header>

          <section aria-labelledby="people-heading" className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="people-heading" className="text-lg font-semibold">
                Surgeons: {surgeons}
                <span className="ml-3 text-base font-normal text-[#667085]">
                  {people.length} {people.length === 1 ? "person" : "people"} in the clinic
                </span>
              </h2>
              {unanswered > 0 && (
                <p className="text-sm text-[#f3b94d]">
                  {unanswered} {unanswered === 1 ? "person has" : "people have"} not said yet. Mark them here, or they
                  will be asked next time they sign in.
                </p>
              )}
            </div>

            <ul className="mt-3 flex flex-col gap-3">
              {people.map((person) => (
                <li
                  key={person.userId}
                  className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Clerk serves the avatar already sized */}
                    <img src={person.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full bg-white/10" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                        <span className="truncate">{person.name}</span>
                        {person.userId === userId && <span className="text-sm font-normal text-[#667085]">(you)</span>}
                        <span
                          className={`rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${
                            person.role === "admin" ? "bg-[#2a829b]/20 text-[#5fb8d4]" : "bg-white/10 text-[#bfbfbf]"
                          }`}
                        >
                          {person.role}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-sm text-[#667085]">{person.email}</p>
                    </div>
                  </div>
                  <KindControl userId={person.userId} name={person.name} kind={person.kind} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="clerk-heading" className="mt-12">
            <h2 id="clerk-heading" className="text-lg font-semibold">
              Invite, change roles, remove
            </h2>
            <p className="mt-1 mb-4 max-w-2xl text-[#bfbfbf]">
              Open the Members tab to invite someone by email, make them an admin or a member, or remove them. New
              people are asked the surgeon question when they first sign in.
            </p>
            {/* Hash routing keeps the panel on this one page instead of needing its own routes. */}
            <OrganizationProfile routing="hash" />
          </section>
        </div>
      </main>
    </AppShell>
  );
}
