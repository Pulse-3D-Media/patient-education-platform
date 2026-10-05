import Link from "next/link";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ChevronRightIcon, LockIcon } from "@/components/ui/icons";
import { categoryState, visibleCount, type CategoryState } from "@/lib/access";
import { CATEGORIES, type CategoryConfig } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { countPublishedVideosByKind } from "@/lib/db/videos";
import { EmptyTile } from "./CategoryStates";
import { ComingSoonTile } from "./ComingSoon";

/**
 * The library home. This is tap one of two.
 *
 * What the clinic bought comes first: the categories on its plan are the
 * main grid, as big picture tiles. Each one is in one of the states decided
 * by categoryState() in lib/access.ts from the plan and what is published:
 *
 *   available    a link to the category, with how many procedures it holds
 *   nothing yet  on the plan, but only placeholders, which this clinic is
 *                not shown
 *   coming soon  on the plan, but nothing published in it yet, for anyone
 *
 * Below that, out of the way, a closed "More categories" section lists by
 * name the categories that have something in them but are not on the plan
 * (the "locked" state). None of them is a link, and nothing playable is sent
 * for them. A category that is neither on the plan nor has anything in it
 * ("coming soon" for a category the clinic has not bought) is not shown on
 * this page at all. Its own page, reached from the menu or by address, still
 * says the same as before: this page only decides where things go.
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
  // Signed out, or no clinic: sent to the right step. A clinic that is not
  // open (not on a plan yet) sees a calm page instead of the library.
  const clinic = await requireClinicPage();
  // An admin (the account owner of a new clinic, most often) gets a button to
  // Billing, where a plan is chosen; a member is told to ask an admin.
  if (!clinicIsOpen(clinic)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  const [access, counts, configs] = await Promise.all([getClinicAccess(clinic.id), countPublishedVideosByKind(), getCategoryConfigs()]);

  // The clinic was read a moment ago, so it exists; this covers it having
  // been closed since, or removed, without a crash.
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  // The clinic's own categories, in the usual order, and the ones with something in them that it does not have.
  const rows = CATEGORIES.map((category) => ({ category, state: categoryState(access, category.value, counts[category.value]) }));
  const mine = rows.filter((row) => access.categories.includes(row.category.value));
  const more = rows.filter((row) => row.state === "locked");

  return (
    <main className="px-5 py-6 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">My Procedure Library</h1>
        <p className="mt-1 text-base text-ink-soft">
          {mine.length > 0 ? "Choose a category to see its procedures." : "Your clinic's plan has no categories yet."}
        </p>
      </header>

      {mine.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map(({ category, state }) => (
            <li key={category.value}>
              <PlanTile category={category} state={state} count={visibleCount(access, counts[category.value])} config={configs[category.value]} />
            </li>
          ))}
        </ul>
      )}

      {/* The rest, kept out of the way: closed until tapped (open when the plan has nothing, so the page is not empty). Names, not pictures, and none of them is a link. */}
      {more.length > 0 && (
        <details open={mine.length === 0} className="group mt-10 border-t border-line pt-3">
          <summary className="flex min-h-12 w-fit cursor-pointer list-none items-center gap-2 rounded-lg pr-3 text-base font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="h-5 w-5 shrink-0 transition group-open:rotate-90" />
            More categories
            <span className="text-sm font-normal text-ink-muted">({more.length} not on your plan)</span>
          </summary>
          <p className="mb-3 max-w-2xl text-sm text-ink-muted">
            Your clinic&rsquo;s admin can see the plan under Billing, and ask Pulse 3D about adding one of these.
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {more.map(({ category }) => (
              <li key={category.value} className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 text-ink-soft">
                <LockIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                <span className="font-medium">{category.label}</span>
                <span className="ml-auto text-sm text-ink-muted">Not on your plan</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

/** One of the clinic's own categories, as a picture tile in whichever state it is in. */
function PlanTile({
  category,
  state,
  count,
  config,
}: {
  category: (typeof CATEGORIES)[number];
  state: CategoryState;
  count: number;
  config: CategoryConfig | undefined;
}) {
  if (state === "coming-soon") return <ComingSoonTile label={category.label} image={category.image} config={config} />;
  // "locked" means not on the plan, so it never reaches here; it would be drawn as a quiet empty tile rather than a link if it did.
  if (state === "empty" || state === "locked") return <EmptyTile label={category.label} image={category.image} />;

  return (
    <Link
      href={`/library/${category.slug}`}
      className="group relative block aspect-[16/9] overflow-hidden rounded-2xl border border-line bg-[#0d1113] text-white transition hover:border-brand/70 active:scale-[0.985]"
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
  );
}
