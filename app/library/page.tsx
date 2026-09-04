import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { countPublishedVideosByCategory } from "@/lib/db/videos";

/**
 * The library home: five big category cards. This is tap one of two.
 *
 * Re-checked against the database at most once a minute, so a newly published
 * video shows up without a redeploy while repeat visits stay instant.
 */
export const revalidate = 60;

export default async function LibraryPage() {
  const counts = await countPublishedVideosByCategory();

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white sm:px-10">
      <header className="mb-8">
        <p className="text-base font-medium uppercase tracking-wide text-[#5fb8d4]">
          Pulse 3D
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Patient Education Library</h1>
      </header>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {CATEGORIES.map((category) => {
          const count = counts[category.value] ?? 0;
          return (
            <li key={category.value}>
              <Link
                href={`/library/${category.slug}`}
                className="flex min-h-44 flex-col justify-between rounded-2xl border border-white/10 bg-[#0d1113] p-7 transition active:scale-[0.98] active:bg-[#1e5668] hover:border-[#2a829b] sm:min-h-52"
              >
                <span className="text-3xl font-semibold sm:text-4xl">{category.label}</span>
                <span className="text-lg text-[#bfbfbf]">
                  {count === 0 ? "No videos yet" : `${count} ${count === 1 ? "video" : "videos"}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
