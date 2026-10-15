import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { parseLogoUrl } from "@/lib/branding";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { listFavoriteIdsAmong } from "@/lib/db/personal-videos";
import { getSeatFor } from "@/lib/db/seats";
import { searchUsableVideos } from "@/lib/db/videos";
import { SEARCH_LIMIT, readSearchQuery } from "@/lib/library-rows";
import { libraryStripName } from "@/lib/sender-name";
import { VideoGrid } from "../[category]/VideoGrid";
import { CategoryTabs } from "../CategoryTabs";
import { toLibraryItems } from "../items";
import { LibraryBrowser } from "../LibraryBrowser";

/**
 * What the search box in the top bar finds: every video this clinic may
 * use whose title contains the words typed, across all the categories on
 * its plan, as the same cards a category's page shows (play, heart, send).
 *
 * The words come from the address (?q=...) and are only ever a search: the
 * list is read through the access rule in the query
 * (searchUsableVideos() in lib/db/videos.ts), so a search never finds a
 * video off the plan, unpublished, or a hidden placeholder, whatever is
 * typed. An empty search goes back to the library home.
 *
 * Rendered fresh on every request, because what it shows depends on who is
 * signed in (see the note on the library home page).
 */
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: PageProps<"/library/search">) {
  const clinic = await requireClinicPage();
  if (!clinicIsOpen(clinic)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  const query = readSearchQuery((await searchParams).q);
  if (!query) redirect("/library");

  const access = await getClinicAccess(clinic.id);
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  const { userId } = await auth();
  const [videos, seat] = await Promise.all([searchUsableVideos(access, query, SEARCH_LIMIT), userId ? getSeatFor(clinic.id, userId) : null]);
  const heartedIds = userId ? await listFavoriteIdsAmong(clinic.id, userId, videos.map((video) => video.id)) : [];
  const items = toLibraryItems(videos);

  return (
    <main className="py-6">
      <h1 className="sr-only">Search: {query}</h1>
      <CategoryTabs categories={access.categories} current="search" />

      <div className="px-5 sm:px-8">
        {items.length > 0 ? (
          <LibraryBrowser
            heartedIds={heartedIds}
            // Only people holding a seat send links; everyone can browse and play. The Send action checks the seat again.
            canSend={seat !== null}
            clinicName={clinic.name}
            logoUrl={parseLogoUrl(clinic.logoUrl)}
            senderName={libraryStripName(seat, clinic.defaultPatientName)}
          >
            <VideoGrid videos={items} />
          </LibraryBrowser>
        ) : (
          <p className="text-lg text-ink-soft">No procedures match &ldquo;{query}&rdquo;.</p>
        )}
      </div>
    </main>
  );
}
