import Link from "next/link";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { categoryState, visibleCount } from "@/lib/access";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { countPublishedVideosByKind } from "@/lib/db/videos";
import { EmptyTile, LockedTile } from "./CategoryStates";
import { ComingSoonTile } from "./ComingSoon";

/**
 * The library home: every category as a visual tile. This is tap one of two.
 *
 * Each tile is in one of four states, decided by categoryState() in
 * lib/access.ts from this clinic's plan and what is published:
 *
 *   available    a link to the category, with how many procedures it holds
 *   coming soon  nothing published in it yet, for anyone
 *   locked       published, but not on this clinic's plan
 *   nothing yet  on the plan, but only placeholders, which this clinic is
 *                not shown
 *
 * Three reads, once each: the clinic's access, the published counts for
 * every category, and the category sentences. Nothing is read per tile.
 *
 * Rendered fresh on every request, because what it shows depends on who is
 * signed in (proxy.ts sends signed-out visitors to the sign-in page first,
 * and requireClinicPage() checks again here, as Clerk's guidance asks).
 */
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  // Signed out, no clinic, or the surgeon question unanswered: sent to the
  // right step. A clinic that is not open (not on a plan yet) sees a calm
  // page instead of the library.
  const clinic = await requireClinicPage();
  if (!clinicIsOpen(clinic.status)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} />;

  const [access, counts, configs] = await Promise.all([getClinicAccess(clinic.id), countPublishedVideosByKind(), getCategoryConfigs()]);

  // The clinic was read a moment ago, so it exists; this covers it having
  // been closed since, or removed, without a crash.
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} />;

  return (
    <main className="px-5 py-6 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">My Procedure Library</h1>
        <p className="mt-1 text-base text-[#bfbfbf]">Choose a category to see its procedures.</p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const state = categoryState(access, category.value, counts[category.value]);

          if (state === "coming-soon") {
            return (
              <li key={category.value}>
                <ComingSoonTile label={category.label} image={category.image} config={configs[category.value]} />
              </li>
            );
          }

          if (state === "locked") {
            return (
              <li key={category.value}>
                <LockedTile label={category.label} image={category.image} />
              </li>
            );
          }

          if (state === "empty") {
            return (
              <li key={category.value}>
                <EmptyTile label={category.label} image={category.image} />
              </li>
            );
          }

          const count = visibleCount(access, counts[category.value]);
          return (
            <li key={category.value}>
              <Link
                href={`/library/${category.slug}`}
                className="group relative block aspect-[16/9] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1113] transition hover:border-[#2a829b]/70 active:scale-[0.985]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN still, no resizing needed */}
                <img
                  src={category.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:scale-[1.03] group-hover:opacity-100"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
                  <span className="text-2xl font-semibold sm:text-[26px]">{category.label}</span>
                  <span className="shrink-0 rounded-full bg-black/50 px-3 py-1 text-sm text-[#bfbfbf] backdrop-blur">
                    {count} {count === 1 ? "procedure" : "procedures"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
