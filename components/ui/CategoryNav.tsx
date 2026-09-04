"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORIES, CATEGORY_GROUP } from "@/lib/categories";

/**
 * The library's own navigation: one entry per procedure category, rendered
 * from the CATEGORIES list so it grows on its own as categories are added.
 *
 * Desktop: a vertical rail beside the global sidebar.
 * Tablet and phone: a horizontal row of pills above the content.
 * The active category comes from the URL, so switching Knee to Hip is one tap.
 */
export function CategoryNav() {
  const pathname = usePathname();
  const onHome = pathname === "/library";

  return (
    <nav aria-label="Procedure categories">
      {/* Desktop rail */}
      <div className="hidden w-52 shrink-0 border-r border-white/10 px-4 py-6 lg:block">
        <Link
          href="/library"
          aria-current={onHome ? "page" : undefined}
          className={`block rounded-lg px-3 py-2 text-base font-semibold ${
            onHome ? "bg-white/5 text-white" : "text-white hover:bg-white/5"
          }`}
        >
          All categories
        </Link>
        <p className="mt-6 px-3 text-xs font-medium uppercase tracking-wider text-[#667085]">
          {CATEGORY_GROUP}
        </p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {CATEGORIES.map((c) => {
            const active = pathname === `/library/${c.slug}`;
            return (
              <li key={c.value}>
                <Link
                  href={`/library/${c.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-11 items-center rounded-lg border-l-2 px-3 text-base transition ${
                    active
                      ? "border-[#5fb8d4] bg-[#2a829b]/15 font-medium text-white"
                      : "border-transparent text-[#bfbfbf] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tablet and phone pills */}
      <div className="flex gap-2 overflow-x-auto px-5 pt-5 pb-1 [scrollbar-width:none] lg:hidden">
        {CATEGORIES.map((c) => {
          const active = pathname === `/library/${c.slug}`;
          return (
            <Link
              key={c.value}
              href={`/library/${c.slug}`}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 shrink-0 items-center rounded-full border px-5 text-base font-medium transition ${
                active
                  ? "border-[#5fb8d4] bg-[#2a829b]/20 text-white"
                  : "border-white/15 text-[#bfbfbf] hover:border-white/30 hover:text-white"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
