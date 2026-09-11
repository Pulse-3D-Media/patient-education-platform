import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { categoryFromSlug } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { listPublishedVideosByCategory } from "@/lib/db/videos";
import { getPlaybackUrl } from "@/lib/video";
import { VideoGrid } from "./VideoGrid";

/**
 * One category: its published videos as cards. Tapping one plays it.
 * This is tap two of two.
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

  // A clinic whose placeholders are switched off (a per-clinic setting on
  // /pulse) sees only finished animations here.
  const videos = await listPublishedVideosByCategory(category.value, { includePlaceholders: clinic.showPlaceholders });

  // Only plain data crosses into the browser: id, title, duration, whether it
  // is a placeholder, and the playback address (built here on the server,
  // through the video boundary).
  const items = videos.map((video) => ({
    id: video.id,
    title: video.title,
    src: getPlaybackUrl(video),
    durationSeconds: video.durationSeconds,
    isPlaceholder: video.isPlaceholder,
  }));

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

      <VideoGrid videos={items} categoryLabel={category.label} />
    </main>
  );
}
