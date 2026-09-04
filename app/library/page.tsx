import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { countPublishedVideosByCategory } from "@/lib/db/videos";

/**
 * The library home: every category as a visual tile. This is tap one of two.
 *
 * Re-checked against the database at most once a minute, so a newly published
 * video shows up without a redeploy while repeat visits stay instant.
 */
export const revalidate = 60;

export default async function LibraryPage() {
  const counts = await countPublishedVideosByCategory();

  return (
    <main className="px-5 py-6 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">My Procedure Library</h1>
        <p className="mt-1 text-base text-[#bfbfbf]">Choose a category to see its procedures.</p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const count = counts[category.value] ?? 0;
          return (
            <li key={category.value}>
              <Link
                href={`/library/${category.slug}`}
                className="group relative block aspect-[16/9] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1113] transition hover:border-[#2a829b]/70 active:scale-[0.985]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN still, no resizing needed */}
                <img
                  src={category.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:scale-[1.03] group-hover:opacity-100"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
                  <span className="text-2xl font-semibold sm:text-[26px]">{category.label}</span>
                  <span className="shrink-0 rounded-full bg-black/50 px-3 py-1 text-sm text-[#bfbfbf] backdrop-blur">
                    {count === 0 ? "No videos yet" : `${count} ${count === 1 ? "procedure" : "procedures"}`}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
