"use client";

import { useLibrary } from "../LibraryBrowser";
import { NoSeatNote } from "../NoSeatNote";
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
  const { send, seatHelp } = useLibrary();

  return (
    <>
      {!send && <NoSeatNote help={seatHelp} lead="Play any video here." className="mb-5" />}
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
