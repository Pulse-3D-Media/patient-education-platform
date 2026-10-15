"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * The watch page's back arrow: it returns to where the surgeon came from (a
 * row on the home page, a category, the search results, another watch page).
 *
 * The browser's own history knows that, but not whether the page before was
 * one of ours: a watch page opened from a bookmark, a reload or a new tab has
 * nothing of ours behind it, and "back" would leave the app. So the library
 * remembers, for as long as the tab stays on our pages, how many library
 * pages it has shown (RememberLibraryPages, in the library's layout, which
 * stays put while the pages inside it change). With one before this one,
 * the arrow goes back; with none, it goes to `fallback`, the video's category.
 */

/** Library pages shown in this tab since the library was opened. Lives as long as the tab stays inside the library. */
let libraryPagesShown = 0;

/** Counts each library page as it is shown. Draws nothing. */
export function RememberLibraryPages() {
  const pathname = usePathname();
  useEffect(() => {
    libraryPagesShown += 1;
  }, [pathname]);
  return null;
}

export function BackLink({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      onClick={(event) => {
        // A plain link to the category works before the page has woken up, and in a new tab; this does better when it can.
        if (libraryPagesShown > 1 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          router.back();
        }
      }}
      aria-label={label}
      title="Back"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink"
    >
      <ArrowLeftIcon className="h-6 w-6" />
    </Link>
  );
}
