import { Category } from "@prisma/client";
import Link from "next/link";
import { INPUT, PLACEHOLDER_BADGE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { countPublishedVideosByCategory, listVideosForPulse, type PulseVideoFilter } from "@/lib/db/videos";
import { formatDuration } from "@/lib/format";
import { requirePulseStaff } from "@/lib/pulse";
import { describeVideoSource } from "@/lib/video";
import { formatDate } from "../ui";
import { CategoryConfigForm } from "./CategoryConfigForm";

/**
 * The catalogue: every video in the library, published or not, placeholder
 * or finished, one row each, sorted the way the library shows categories.
 * Narrow it by category and status through the form at the top (a plain
 * GET form, so the address bar carries the filter and a reload keeps it).
 *
 * "Add video" and every title open the edit form for that video. Editing
 * keeps the row, so links and QR codes already sent keep working.
 *
 * Below the table, the Categories panel: each category with how many
 * videos are published in it, whether it is for sale, and the sentence the
 * library shows while it has nothing published.
 *
 * Staff only. Rendered fresh on every request.
 */
export const dynamic = "force-dynamic";

const ALL_CATEGORIES = Object.values(Category);

const STATUS_CHOICES: { value: NonNullable<PulseVideoFilter["status"]>; label: string }[] = [
  { value: "published", label: "Published" },
  { value: "unpublished", label: "Not published" },
  { value: "placeholder", label: "Placeholder" },
  { value: "real", label: "Finished" },
];

export default async function PulseVideosPage({ searchParams }: PageProps<"/pulse/videos">) {
  await requirePulseStaff();

  const params = await searchParams;
  const categoryParam = typeof params.category === "string" ? params.category : "";
  const category = (ALL_CATEGORIES as string[]).includes(categoryParam) ? (categoryParam as Category) : undefined;
  const statusParam = typeof params.status === "string" ? params.status : "";
  const status = STATUS_CHOICES.find((choice) => choice.value === statusParam)?.value;
  const filtering = Boolean(category) || Boolean(status);

  const [videos, configs, published] = await Promise.all([
    listVideosForPulse({ category, status }),
    getCategoryConfigs(),
    countPublishedVideosByCategory(),
  ]);

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Videos</h1>
            <p className="mt-1 max-w-2xl text-[#bfbfbf]">
              The whole library, including videos that are not published yet. Open one to change it; the links already sent
              keep working.
            </p>
          </div>
          <Link href="/pulse/videos/new" className={`${PRIMARY_BUTTON} h-11`}>
            Add video
          </Link>
        </header>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3" role="search">
          <div>
            <label htmlFor="category" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
              Category
            </label>
            <select id="category" name="category" defaultValue={category ?? ""} className={`${INPUT} w-52`}>
              <option value="">Any category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? ""} className={`${INPUT} w-44`}>
              <option value="">Any status</option>
              {STATUS_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${SECONDARY_BUTTON} h-11`}>
            Filter
          </button>
          {filtering && (
            <Link href="/pulse/videos" className={`${SECONDARY_BUTTON} h-11`}>
              Show all
            </Link>
          )}
        </form>

        <p className="mt-6 text-sm text-[#667085]">
          {videos.length} {videos.length === 1 ? "video" : "videos"}
          {filtering ? " match" : ""}
        </p>

        {videos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-white/15 p-6 text-[#bfbfbf]">
            {filtering ? "No videos match that filter." : "No videos yet. Add the first one."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1113]">
            <table className="w-full min-w-[960px] text-left text-[15px]">
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Published</th>
                  <th className="px-4 py-3 text-right font-medium">Length</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Links</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr key={video.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[.03]">
                    <td className="px-4 py-3">
                      <Link href={`/pulse/videos/${video.id}`} className="font-medium text-white hover:text-[#5fb8d4]">
                        {video.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{categoryLabel(video.category)}</td>
                    <td className="px-4 py-3">
                      {video.isPlaceholder ? (
                        <span className={PLACEHOLDER_BADGE}>Placeholder</span>
                      ) : (
                        <span className="text-[#bfbfbf]">Finished</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {video.isPublished ? (
                        <span className="rounded-md bg-[#2a829b]/20 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#5fb8d4]">
                          Published
                        </span>
                      ) : (
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">
                          Not published
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">
                      {video.durationSeconds == null ? "–" : formatDuration(video.durationSeconds)}
                    </td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{describeVideoSource(video)}</td>
                    <td className="px-4 py-3 text-right text-[#bfbfbf]">{video._count.shares}</td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{formatDate(video.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Categories</h2>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            A category is offered for sale only while its switch is on. Until it has a published video, the library shows a
            &ldquo;Coming soon&rdquo; tile with the sentence here, or a standard one if this is left empty.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {CATEGORIES.map((c) => (
              <li key={c.value} className="rounded-2xl border border-white/10 bg-[#0d1113] p-5">
                <CategoryConfigForm
                  category={c.value}
                  label={c.label}
                  publishedCount={published[c.value] ?? 0}
                  config={configs[c.value]}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: Category) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
