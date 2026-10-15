"use client";

import { useMemo, useState } from "react";
import { useLibrary } from "../LibraryBrowser";
import type { LibraryItem } from "../library-item";
import { VideoCard } from "../VideoCard";

/**
 * A category's procedure cards, with a search box. Each card plays, hearts
 * and (for someone holding a seat) sends with one tap; the player, the Send
 * panel and the hearts belong to the LibraryBrowser the category page puts
 * this in (app/library/LibraryBrowser.tsx), the same one the library home
 * uses, so a card behaves the same in both places.
 *
 * The category page only renders this when there is at least one video;
 * a category with nothing published shows its "Coming soon" block instead.
 */
export function VideoGrid({ videos }: { videos: LibraryItem[] }) {
  const { send } = useLibrary();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : videos;
  }, [videos, query]);

  return (
    <>
      {!send && (
        <p className="mb-5 max-w-2xl text-base text-ink-soft">
          Play any video here. Sending one to a patient needs a surgeon seat: ask your clinic&apos;s office admin if you should have one.
        </p>
      )}
      {videos.length > 1 && (
        <div className="mb-6 max-w-sm">
          <label className="sr-only" htmlFor="library-search">
            Search procedures
          </label>
          <input
            id="library-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search procedures..."
            className="h-11 w-full rounded-full border border-line-strong bg-surface px-5 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-lg text-ink-soft">No procedures match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          {shown.map((video) => (
            <li key={video.id}>
              <VideoCard video={video} size="grid" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
