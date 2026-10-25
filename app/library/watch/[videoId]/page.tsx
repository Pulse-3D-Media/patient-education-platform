import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { parseLogoUrl } from "@/lib/branding";
import { readStoredChapters } from "@/lib/chapters";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryList } from "@/lib/db/category-config";
import { listFavoriteIdsAmong } from "@/lib/db/personal-videos";
import { getSeatFor } from "@/lib/db/seats";
import { getUsableVideo, listMoreInCategory } from "@/lib/db/videos";
import { MORE_IN_CATEGORY_LIMIT, readWatchVideoId } from "@/lib/library-rows";
import { playbackForLibraryVideo } from "@/lib/playback-auth";
import { libraryStripName } from "@/lib/sender-name";
import { toLibraryItems } from "../../items";
import { LibraryBrowser } from "../../LibraryBrowser";
import { BackLink } from "./BackLink";
import { WatchView } from "./WatchView";

/**
 * The library's watch page, /library/watch/<videoId>, YouTube-style
 * (decided by Evan on 2026-10-15). Tapping a card anywhere in the library
 * opens it, with the video PAUSED until the surgeon taps Play, because they
 * may open it while still talking to the patient. The layout and the
 * buttons are WatchView's.
 *
 * The address carries a video id and nothing else, and it is only a
 * request. The clinic is the signed-in person's (requireClinicPage(), never
 * the browser), and the video is shown only when this clinic may use it
 * right now, asked two ways that must both say yes: the access rule in the
 * query (getUsableVideo()) for what the page shows, and
 * playbackForLibraryVideo() (canUseVideo() first) for what it plays. Any
 * other video (another clinic's plan, a category off this plan, unpublished,
 * a placeholder this clinic is not shown, a made-up id) is the staff
 * not-found page, with no word about which, and nothing playable is sent.
 *
 * "More in <category>" is read through the same rule in the query, and is
 * bounded (MORE_IN_CATEGORY_LIMIT). Only someone holding a seat gets Send
 * and Show QR on screen; the Send action checks the seat again. The
 * video's chapters, when Pulse staff have set any, come with it.
 *
 * Rendered fresh on every request, because what it shows depends on who is
 * signed in (see the note on the library home page).
 */
export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: PageProps<"/library/watch/[videoId]">) {
  // Same gate as every library page: signed in, in a clinic, and the clinic open. Otherwise the right step or a calm page.
  const clinic = await requireClinicPage();
  if (!clinicIsOpen(clinic)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  // Junk in the address (too long, odd characters) is not even looked up.
  const videoId = readWatchVideoId((await params).videoId);
  if (!videoId) notFound();

  const access = await getClinicAccess(clinic.id);
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} billingLink={clinic.isAdmin} />;

  // The person, from Clerk's session (never the browser). requireClinicPage() has just made sure there is one.
  const { userId } = await auth();
  const now = new Date();
  const [video, source, seat, list] = await Promise.all([
    getUsableVideo(access, videoId),
    playbackForLibraryVideo(clinic.id, videoId, now),
    userId ? getSeatFor(clinic.id, userId) : null,
    getCategoryList(),
  ]);
  if (!video || !source) notFound();

  // Every video's category is in the list; a missing one (a category added to the schema but not to lib/categories) is not found too.
  const category = list.find((c) => c.value === video.category);
  if (!category) notFound();

  const [more, heartedIds] = await Promise.all([
    listMoreInCategory(access, video.category, video.id, MORE_IN_CATEGORY_LIMIT),
    userId ? listFavoriteIdsAmong(clinic.id, userId, [video.id]) : [],
  ]);

  // Only plain data crosses into the browser. What this video plays is the source made just now, for this clinic.
  const [base] = toLibraryItems([video], now);
  const item = { ...base, source };

  return (
    <main className="px-3 py-4 sm:px-6 lg:px-8">
      <div className="mb-3">
        <BackLink fallback={`/library/${category.slug}`} label="Back" />
      </div>
      {/* A key per video, so moving from one watch page to the next starts the hearts and the player afresh. */}
      <LibraryBrowser key={video.id} heartedIds={heartedIds} canSend={seat !== null}>
        <WatchView
          video={item}
          category={{ label: category.label, slug: category.slug, image: category.image }}
          more={toLibraryItems(more, now)}
          clinicName={clinic.name}
          logoUrl={parseLogoUrl(clinic.logoUrl)}
          // The player shows the name patients would see on this person's links, only when they hold a seat.
          senderName={libraryStripName(seat, clinic.defaultPatientName)}
          // Its chapters, set on /pulse/videos: the Chapters button and panel, and the marks on the progress bar. None for most videos.
          chapters={readStoredChapters(video.chapters)}
        />
      </LibraryBrowser>
    </main>
  );
}
