import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { categoryState } from "@/lib/access";
import { categoryFromSlug } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { countPublishedVideosByKind, listUsableVideosInCategory } from "@/lib/db/videos";
import { getPlaybackUrl } from "@/lib/video";
import { EmptyCategory, LockedCategory } from "../CategoryStates";
import { ComingSoon } from "../ComingSoon";
import { VideoGrid } from "./VideoGrid";

/**
 * One category: the videos this clinic may use in it, as cards. Tapping
 * one plays it. This is tap two of two.
 *
 * The list comes from listUsableVideosInCategory(), which applies the
 * clinic's plan and placeholder setting in the query itself, so a video
 * the clinic may not use never has its address sent to the browser. That
 * holds for someone who typed the address of a locked category too: they
 * see the same "not on your plan" page the tile promised, and nothing
 * playable. The states (coming soon, locked, nothing yet) are decided by
 * categoryState() in lib/access.ts, the same way the library home decides
 * its tiles.
 *
 * Rendered fresh on every request, because what it shows depends on who is
 * signed in (see the note on the library home page).
 */
export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: PageProps<"/library/[category]">) {
  // Same gate as the library home: signed in, in a clinic, question answered,
  // and the clinic open. Otherwise the right step or a calm page.
  const clinic = await requireClinicPage();
  if (!clinicIsOpen(clinic.status)) return <ClinicClosed status={clinic.status} clinicName={clinic.name} />;

  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();

  const access = await getClinicAccess(clinic.id);
  if (!access || !access.open) return <ClinicClosed status={access?.status ?? clinic.status} clinicName={clinic.name} />;

  // The usable videos and the published counts for this one category, side
  // by side. The counts are what tell a locked category from an empty one
  // when the list comes back with nothing in it.
  const [videos, counts] = await Promise.all([listUsableVideosInCategory(access, category.value), countPublishedVideosByKind(category.value)]);
  const state = categoryState(access, category.value, counts[category.value]);

  // Only plain data crosses into the browser: id, title, duration, whether it
  // is a placeholder, and the playback address (built here on the server,
  // through the video boundary).
  const items = videos.map((video) => ({
    id: video.id,
    title: video.title,
    src: getPlaybackUrl(video),
    posterUrl: video.posterUrl,
    durationSeconds: video.durationSeconds,
    isPlaceholder: video.isPlaceholder,
  }));

  // Nothing published here at all: the same "Coming soon" the library home
  // shows on the tile, with the category's own sentence.
  const configs = state === "coming-soon" ? await getCategoryConfigs() : null;

  return (
    <main className="px-5 py-6 sm:px-8">
      <header className="mb-6">
        <p className="mb-1 text-sm text-[#667085]">
          <Link href="/library" className="hover:text-white">
            My Library
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[#bfbfbf]">{category.label}</span>
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">{category.label}</h1>
      </header>

      {items.length > 0 ? (
        <VideoGrid videos={items} categoryLabel={category.label} />
      ) : configs ? (
        <ComingSoon label={category.label} config={configs[category.value]} />
      ) : state === "locked" ? (
        <LockedCategory label={category.label} />
      ) : (
        <EmptyCategory label={category.label} />
      )}
    </main>
  );
}
