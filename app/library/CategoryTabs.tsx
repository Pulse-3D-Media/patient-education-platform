import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import type { Category } from "@prisma/client";

/**
 * The tabs across the top of the library: "All" (the library home) and one
 * per category on the clinic's plan, in the usual order. A tab goes to that
 * category's page, which draws the same tabs with its own one lit. Plain
 * links, so they work before the page has woken up. On a narrow screen the
 * tabs scroll sideways rather than wrapping.
 *
 * Categories that are not on the plan have no tab: they are under "More
 * categories" on the home page.
 */
export function CategoryTabs({ categories, current }: { categories: Category[]; current: "all" | string }) {
  const tabs = [{ href: "/library", label: "All", key: "all" }].concat(
    CATEGORIES.filter((c) => categories.includes(c.value)).map((c) => ({ href: `/library/${c.slug}`, label: c.label, key: c.slug })),
  );

  return (
    <nav aria-label="Categories" className="mb-6">
      <ul className="flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden">
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
