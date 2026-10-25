import type { Category } from "@/lib/categories";
import Link from "next/link";
import type { CategoryDetails } from "@/lib/categories";

/**
 * The pills across the top of every library page, centered under the top
 * bar (decided by Evan on 2026-10-15): "All" (the
 * library home) and one per category on the clinic's plan, in the usual
 * order. A pill goes to that category's page, which draws the same pills
 * with its own one lit; the search results light none. Plain links, so they
 * work before the page has woken up. On a narrow screen the pills scroll
 * sideways from the first one rather than wrapping or being cut off.
 *
 * Categories that are not on the plan have no pill: they are under "More
 * categories" on the home page. `list` is the category list from the server
 * (getCategoryList()), for each category's current name, address and place.
 */
export function CategoryTabs({ list, categories, current }: { list: CategoryDetails[]; categories: Category[]; current: string }) {
  const tabs = [{ href: "/library", label: "All", key: "all" }].concat(
    list.filter((c) => categories.includes(c.value)).map((c) => ({ href: `/library/${c.slug}`, label: c.label, key: c.slug })),
  );

  return (
    <nav aria-label="Categories" className="mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* w-max with auto margins: centered while the pills fit, scrolling from "All" once they do not. */}
      <ul className="mx-auto flex w-max gap-2 px-5 pb-1 sm:px-8">
        {tabs.map((tab) => {
          const on = tab.key === current;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition ${
                  on ? "border-transparent bg-ink text-ground" : "border-line-strong text-ink-soft hover:border-brand hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
