import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { categoryState } from "@/lib/access";
import { addToPlanOffer } from "@/lib/add-to-plan";
import { findCategoryBySlug } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs, getCategoryList } from "@/lib/db/category-config";
import { listFavoriteIdsAmong } from "@/lib/db/personal-videos";
import { getSeatFor } from "@/lib/db/seats";
import { countPublishedVideosByKind, listUsableVideosInCategory } from "@/lib/db/videos";
import { CategoryTabs } from "../CategoryTabs";
import { EmptyCategory, LockedCategory } from "../CategoryStates";
import { ComingSoon } from "../ComingSoon";
import { toLibraryItems } from "../items";
import { LibraryBrowser } from "../LibraryBrowser";
import { VideoGrid } from "./VideoGrid";

/**
 * One category: the videos this clinic may use in it, as cards, under the
 * same category tabs as the library home with this one lit. Tapping a card
 * opens its watch page; its heart makes it one of the person's favorites.
 *
 * The list comes from listUsableVideosInCategory(), which applies the
 * clinic's plan and placeholder setting in the query itself, so a video
 * the clinic may not use never has its address sent to the browser. That
 * holds for someone who typed the address of a locked category too: they
 * see the same "not on your plan" page the home page promised, and nothing
 * playable. The states (coming soon, locked, nothing yet) are decided by
 * categoryState() in lib/access.ts, the same way the library home decides
 * its rows.
 *
 * Everyone in the clinic can browse, play and heart. Only people holding a
 * seat get the Send button (a link is always from a surgeon); the Send
 * action checks the seat again on the server, so a hidden button is never
 * the only check.
 *
 * Rendered fresh on every request, because what it shows depends on who is
 * signed in (see the note on the library home page).
 */
export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: PageProps<"/library/[category]">) {
  // Same gate as the library home: signed in, in a clinic, and the clinic open. Otherwise the right step or a calm page.
  const clinic = await requireClinicPage();
  if (!clinicIsOpen(clinic)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  const { category: slug } = await params;
  // The address can be the category's address now, or one it had before Pulse staff changed it on
  // /pulse/videos: an old one is sent on to the new one, so no bookmark breaks.
  const list = await getCategoryList();
  const found = findCategoryBySlug(list, slug);
  if (!found) notFound();
  if (!found.current) redirect(`/library/${found.category.slug}`);
  const category = found.category;

  const access = await getClinicAccess(clinic.id);
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  // The usable videos and the published counts for this one category, side
  // by side. The counts are what tell a locked category from an empty one
  // when the list comes back with nothing in it.
  const { userId } = await auth();
  const [videos, counts, seat] = await Promise.all([
    listUsableVideosInCategory(access, category.value),
    countPublishedVideosByKind(category.value),
    userId ? getSeatFor(clinic.id, userId) : null,
  ]);
  const state = categoryState(access, category.value, counts[category.value]);
  // Which of them this person has hearted, so those hearts start filled. Their own, from the session.
  const heartedIds = userId ? await listFavoriteIdsAmong(clinic.id, userId, videos.map((video) => video.id)) : [];

  // Only plain data crosses into the browser: id, title, duration, whether it
  // is a placeholder, and what to play (built on the server through
  // lib/playback-auth.ts, for videos the list above has just shown this clinic may use).
  const items = toLibraryItems(videos);

  // Nothing published here at all: the same "Coming soon" the library home
  // shows, with the category's own sentence. Not on the plan: the
  // category's row says whether it is for sale, which decides whether there
  // is anything to add. The other states need no row.
  const configs = state === "coming-soon" || state === "locked" ? await getCategoryConfigs() : null;

  return (
    <main className="py-6">
      {/* The pills first, as on every library page; the lit one says which category this is. */}
      <CategoryTabs list={list} categories={access.categories} current={category.slug} />
      <h1 className="mb-5 px-5 text-2xl font-semibold sm:px-8 sm:text-3xl">{category.label}</h1>

      <div className="px-5 sm:px-8">
        {items.length > 0 ? (
          <LibraryBrowser
            heartedIds={heartedIds}
            // Only people holding a seat send links; everyone can browse and play. The Send action checks the seat again.
            canSend={seat !== null}
          >
            <VideoGrid videos={items} />
          </LibraryBrowser>
        ) : state === "coming-soon" ? (
          <ComingSoon label={category.label} config={configs?.[category.value]} />
        ) : state === "locked" ? (
          <LockedCategory label={category.label} slug={category.slug} offer={addToPlanOffer(clinic.isAdmin, configs?.[category.value])} />
        ) : (
          <EmptyCategory label={category.label} />
        )}
      </div>
    </main>
  );
}
