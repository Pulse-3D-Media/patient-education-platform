import Link from "next/link";
import { notFound } from "next/navigation";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { getVideoForPulse } from "@/lib/db/videos";
import { requirePulseStaff } from "@/lib/pulse";
import { describeVideoSource } from "@/lib/video";
import { formatDate } from "../../ui";
import { VideoForm } from "../VideoForm";

/**
 * One video: the edit form, with what the row says today above it. Saving
 * changes the row in place, so the links already sent keep working.
 *
 * Staff only. Rendered fresh on every request so a save is seen at once.
 */
export const dynamic = "force-dynamic";

export default async function PulseVideoPage({ params, searchParams }: PageProps<"/pulse/videos/[id]">) {
  await requirePulseStaff();

  const { id } = await params;
  const video = await getVideoForPulse(id);
  if (!video) notFound();

  // The add form sends the staff member here with ?added=1 once the row exists.
  const justAdded = (await searchParams).added === "1";
  const category = CATEGORIES.find((c) => c.value === video.category)?.label ?? video.category;

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-sm text-[#667085]">
            <Link href="/pulse/videos" className="hover:text-white">
              Videos
            </Link>
            <span className="mx-2">/</span>
            <span className="text-[#bfbfbf]">{video.title}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold sm:text-3xl">{video.title}</h1>
            {video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
            {!video.isPublished && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">
                Not published
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#667085]">
            {category} · {describeVideoSource(video)} · {video._count.shares} {video._count.shares === 1 ? "link" : "links"} · Added{" "}
            {formatDate(video.createdAt)}
          </p>
        </header>

        {justAdded && (
          <p role="status" className="mb-5 rounded-xl border border-[#2a829b]/50 bg-[#2a829b]/15 px-4 py-3 text-[15px] text-white">
            Added. {video.isPublished ? "It is in the library now." : "It stays out of the library until it is published."}
          </p>
        )}

        <div className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
          <VideoForm
            video={{
              id: video.id,
              title: video.title,
              category: video.category,
              videoUrl: video.videoUrl,
              durationSeconds: video.durationSeconds,
              posterUrl: video.posterUrl,
              isPlaceholder: video.isPlaceholder,
              isPublished: video.isPublished,
              notes: video.notes,
              shareCount: video._count.shares,
            }}
          />
        </div>
      </div>
    </main>
  );
}
