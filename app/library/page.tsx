import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ChevronRightIcon, LockIcon } from "@/components/ui/icons";
import { categoryState } from "@/lib/access";
import { addToPlanHref, addToPlanOffer } from "@/lib/add-to-plan";
import { comingSoonSentence } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs, getCategoryList } from "@/lib/db/category-config";
import { listFavoriteIdsAmong, listFavoriteVideos, listMostWatchedVideos } from "@/lib/db/personal-videos";
import { getSeatFor } from "@/lib/db/seats";
import { countPublishedVideosByKind, listUsableVideosInCategory } from "@/lib/db/videos";
import { CATEGORY_ROW_LIMIT, showMostWatched } from "@/lib/library-rows";
import { ONLY_PLACEHOLDERS } from "./CategoryStates";
import { CategoryTabs } from "./CategoryTabs";
import { toLibraryItems } from "./items";
import { LibraryBrowser } from "./LibraryBrowser";
import { FavoritesRow, VideoRow } from "./VideoRow";

/**
 * The library home, laid out like Netflix (decided by Evan on 2026-10-15;
 * the rules and limits are in lib/library-rows.ts). Top to bottom:
 *
 *   1. Category pills, centered: "All" and the categories on the plan (no headline).
 *   2. My favorites: what this person hearted, as bigger cards, or one
 *      quiet line when there is nothing yet.
 *   3. Most watched: this person's own most-played videos, once they have
 *      played at least three different ones.
 *   4. One row per category on the plan: its newest few videos and a "View
 *      category" link. A category on the plan with nothing to show says so
 *      in one quiet line instead (coming soon, or only placeholders this
 *      clinic is not shown), in the state categoryState() gives it.
 *   5. The closed "More categories" section: the categories with something
 *      in them that are not on the plan, by name, none of which opens. An
 *      office admin gets an "Add to your plan" link on each one for sale; a
 *      member is told to ask an office admin. No price is ever shown here.
 *
 * Every card on the page is a video this clinic may use right now: each
 * list is read through the access rule in the query (lib/db/videos.ts,
 * lib/db/personal-videos.ts), so a favorite whose category left the plan
 * is not shown (and is back when the category is), and nothing playable
 * leaves the server for a video the clinic may not use. Favorites and plays
 * are this person's own; no number about them is shown.
 *
 * Tap a card to open its watch page (/library/watch/<id>), where the video
 * waits, paused, for a Play tap; the Send panel and the hearts are
 * LibraryBrowser's.
 *
 * Reads, all at once and each bounded: the clinic's access, the published
 * counts, the category sentences, this person's seat, their favorites and
 * most played, and the newest few of each category on the plan.
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

  const access = await getClinicAccess(clinic.id);
  // The clinic was read a moment ago, so it exists; this covers it having
  // been closed since, or removed, without a crash.
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  // The person, from Clerk's session (never the browser). requireClinicPage() has just made sure there is one.
  const { userId } = await auth();
  const person = userId ?? "";
  // Each category's current name, address and place (Pulse staff can change them on /pulse/videos).
  const list = await getCategoryList();
  const mine = list.filter((category) => access.categories.includes(category.value));

  const [counts, configs, seat, favorites, mostPlayed, rows] = await Promise.all([
    countPublishedVideosByKind(),
    getCategoryConfigs(),
    person ? getSeatFor(clinic.id, person) : null,
    person ? listFavoriteVideos(clinic.id, person, access) : [],
    person ? listMostWatchedVideos(clinic.id, person, access) : [],
    Promise.all(mine.map((category) => listUsableVideosInCategory(access, category.value, CATEGORY_ROW_LIMIT))),
  ]);

  // The hearts on the other rows' cards: the favorites read above cover most, and one bounded read covers the rest.
  const favoriteIds = new Set(favorites.map((video) => video.id));
  const others = [...new Set([...rows.flat(), ...mostPlayed].map((video) => video.id))].filter((id) => !favoriteIds.has(id));
  const heartedIds = person ? await listFavoriteIdsAmong(clinic.id, person, others) : [];

  const now = new Date();
  const mostWatched = showMostWatched(mostPlayed) ? toLibraryItems(mostPlayed, now) : [];

  // The categories with something in them that are not on the plan, each with what can be done about it: a link to
  // Billing for an office admin, "ask your admin" for a member, nothing when it is not for sale.
  const more = list.filter((category) => categoryState(access, category.value, counts[category.value]) === "locked").map((category) => ({
    category,
    offer: addToPlanOffer(clinic.isAdmin, configs[category.value]),
  }));
  const canAdd = more.some((row) => row.offer !== "none");

  return (
    <main className="py-6">
      {/* No headline on the page (Evan, 2026-10-15): the pills say where you are. A screen reader still gets one. */}
      <h1 className="sr-only">My Procedure Library</h1>
      {mine.length === 0 && <p className="mb-5 px-5 text-base text-ink-soft sm:px-8">Your clinic&apos;s plan has no categories yet.</p>}

      {mine.length > 0 && (
        <>
          <CategoryTabs list={list} categories={access.categories} current="all" />

          <LibraryBrowser
            favorites={toLibraryItems(favorites, now)}
            heartedIds={heartedIds}
            canSend={seat !== null}
          >
            <div className="flex flex-col gap-9">
              {/* First on the page: Home in the sidebar is where favorites are. */}
              <section id="favorites" aria-labelledby="favorites-heading">
                <RowHeading id="favorites-heading" title="My favorites" />
                <FavoritesRow />
              </section>

              {mostWatched.length > 0 && (
                <section aria-labelledby="most-watched-heading">
                  <RowHeading id="most-watched-heading" title="Most watched" />
                  <VideoRow items={mostWatched} size="row" label="Most watched" />
                </section>
              )}

              {mine.map((category, index) => {
                const state = categoryState(access, category.value, counts[category.value]);
                const items = toLibraryItems(rows[index] ?? [], now);
                const headingId = `row-${category.slug}`;
                return (
                  <section key={category.value} aria-labelledby={headingId}>
                    <RowHeading
                      id={headingId}
                      title={category.label}
                      link={items.length > 0 ? { href: `/library/${category.slug}`, label: `View ${category.label}` } : undefined}
                    />
                    {items.length > 0 ? (
                      <VideoRow items={items} size="row" label={category.label} />
                    ) : (
                      // On the plan, with nothing to show this clinic: the same words its own page has, in one quiet line.
                      <p className="px-5 text-base text-ink-muted sm:px-8">
                        {state === "coming-soon"
                          ? `Coming soon. ${comingSoonSentence(configs[category.value])}`
                          : ONLY_PLACEHOLDERS}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </LibraryBrowser>
        </>
      )}

      {/* The rest, kept out of the way: closed until tapped (open when the plan has nothing, so the page is not empty). Names, not pictures, and none
          of them opens the category. An office admin gets one small link on each, to Billing with that category ticked; no price is shown here. */}
      {more.length > 0 && (
        <div className="px-5 sm:px-8">
          <details open={mine.length === 0} className="group mt-10 border-t border-line pt-3">
            <summary className="flex min-h-12 w-fit cursor-pointer list-none items-center gap-2 rounded-lg pr-3 text-base font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="h-5 w-5 shrink-0 transition group-open:rotate-90" />
              More categories
              <span className="text-sm font-normal text-ink-muted">({more.length} not on your plan)</span>
            </summary>
            <p className="mb-3 max-w-2xl text-sm text-ink-muted">
              {!canAdd
                ? "Your clinic’s admin can see the plan under Billing, and ask Pulse 3D about adding one of these."
                : clinic.isAdmin
                  ? "Add one on Billing. You see what it comes to there before anything changes."
                  : "Ask your office admin to add one of these."}
            </p>
            {/* One category per row, at every width (decided at the 2026-10-08 huddle: side by side, the names read as a line of blue links and
                were skimmed past). The name is plain text in the body colour; only "Add to your plan" is a link, at the end of its own row. */}
            <ul className="max-w-2xl divide-y divide-line rounded-xl border border-line">
              {more.map(({ category, offer }) => (
                <li key={category.value} className="flex min-h-14 items-center gap-3 px-4 py-1">
                  <LockIcon className="h-5 w-5 shrink-0 text-ink-muted" />
                  {/* On a phone a long name ("Orthopedic Spine") may take two lines; the row grows rather than the name being cut. */}
                  <span className="min-w-0 text-lg leading-snug text-ink">{category.label}</span>
                  {offer === "link" ? (
                    // Not prefetched: the library stays light, and Billing is only read when someone asks for it.
                    <Link
                      href={addToPlanHref(category.slug)}
                      prefetch={false}
                      aria-label={`Add ${category.label} to your plan`}
                      className="-mr-2 ml-auto inline-flex min-h-12 shrink-0 items-center rounded-lg px-2 text-base font-medium text-brand-bright underline underline-offset-2 hover:text-ink"
                    >
                      Add to your plan
                    </Link>
                  ) : (
                    <span className="ml-auto shrink-0 text-base text-ink-muted">Not on your plan</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </main>
  );
}

/** A row's title, with "View category" at its end when there is more to see. */
function RowHeading({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 px-5 sm:px-8">
      <h2 id={id} className="text-xl font-semibold sm:text-2xl">
        {title}
      </h2>
      {link && (
        <Link
          href={link.href}
          aria-label={link.label}
          className="-mb-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-base font-medium text-brand-bright hover:text-ink"
        >
          View category
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
