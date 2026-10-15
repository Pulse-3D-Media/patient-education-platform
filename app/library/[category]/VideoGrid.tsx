"use client";

import { useLibrary } from "../LibraryBrowser";
import type { LibraryItem } from "../library-item";
import { VideoCard } from "../VideoCard";

/**
 * A grid of procedure cards: a category's page, and the search results.
 * Each card opens its watch page, hearts and (for someone holding a seat)
 * sends with one tap; the Send panel and the hearts belong to the
 * LibraryBrowser the page puts this in (app/library/LibraryBrowser.tsx),
 * the same one the library home uses, so a card behaves the same
 * everywhere. Searching is the box in the top bar (AppShell), which searches
 * the whole library.
 *
 * A page only renders this when there is at least one video.
 */
export function VideoGrid({ videos }: { videos: LibraryItem[] }) {
  const { send } = useLibrary();

  return (
    <>
      {!send && (
        <p className="mb-5 max-w-2xl text-base text-ink-soft">
          Play any video here. Sending one to a patient needs a surgeon seat: ask your clinic&apos;s office admin if you should have one.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3">
        {videos.map((video) => (
          <li key={video.id}>
            <VideoCard video={video} size="grid" />
          </li>
        ))}
      </ul>
    </>
  );
}
