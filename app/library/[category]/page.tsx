import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryFromSlug } from "@/lib/categories";
import { listPublishedVideosByCategory } from "@/lib/db/videos";
import { getPlaybackUrl } from "@/lib/video";
import { VideoGrid } from "./VideoGrid";

/**
 * One category: its published videos as big thumbnails. Tapping one plays it.
 * This is tap two of two.
 */
export const revalidate = 60;

export default async function CategoryPage({ params }: PageProps<"/library/[category]">) {
  const { category: slug } = await params;
  const category = categoryFromSlug(slug);
  if (!category) notFound();

  const videos = await listPublishedVideosByCategory(category.value);

  // Only plain data crosses into the browser: the id, the title and the
  // playback address (built here on the server, through the video boundary).
  const items = videos.map((video) => ({
    id: video.id,
    title: video.title,
    src: getPlaybackUrl(video),
  }));

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white sm:px-10">
      <header className="mb-8 flex items-center gap-5">
        <Link
          href="/library"
          className="flex h-14 min-w-14 items-center justify-center rounded-full border border-white/15 px-5 text-lg font-medium text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
          aria-label="Back to all categories"
        >
          &larr; Back
        </Link>
        <h1 className="text-3xl font-semibold sm:text-4xl">{category.label}</h1>
      </header>

      {items.length === 0 ? (
        <p className="text-xl text-[#bfbfbf]">No {category.label.toLowerCase()} videos yet.</p>
      ) : (
        <VideoGrid videos={items} />
      )}
    </main>
  );
}
