import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryFromSlug } from "@/lib/categories";
import { listPublishedVideosByCategory } from "@/lib/db/videos";
import { getPlaybackUrl } from "@/lib/video";
import { VideoGrid } from "./VideoGrid";

/**
 * One category: its published videos as cards. Tapping one plays it.
 * This is tap two of two.
 */
export const revalidate = 60;

export default async function CategoryPage({ params }: PageProps<"/library/[category]">) {
  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();

  const videos = await listPublishedVideosByCategory(category.value);

  // Only plain data crosses into the browser: id, title, duration and the
  // playback address (built here on the server, through the video boundary).
  const items = videos.map((video) => ({
    id: video.id,
    title: video.title,
    src: getPlaybackUrl(video),
    durationSeconds: video.durationSeconds,
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
