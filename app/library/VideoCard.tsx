"use client";

import { useEffect, useRef, useState } from "react";
import { HeartIcon, PlayIcon, ShareIcon } from "@/components/ui/icons";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { formatDuration } from "@/lib/format";
import { useLibrary } from "./LibraryBrowser";
import type { LibraryItem } from "./library-item";

/**
 * One procedure card, in a row on the library home or in a category's grid.
 *
 * Three actions, each one tap and each at least 44px: the picture plays the
 * video, the heart makes it one of the person's favorites (or not), and the
 * send icon makes a patient link (only for someone holding a seat). Nothing
 * happens on hover but a slight lift: no previews, no autoplay (the speed
 * rule).
 *
 * THE PICTURE is the still chosen on /pulse, or for a Mux video the signed
 * still Mux makes, loaded lazily by the browser (`loading="lazy"`), so a
 * card off the screen, at the far end of a row, costs nothing until it is
 * scrolled near. A video with neither shows its own frame at one second,
 * and that element is only created once the card is near the screen (an
 * IntersectionObserver), for the same reason. If nothing can load, a quiet
 * branded panel, never a broken box.
 *
 * A placeholder (a sample standing in for the named procedure) carries the
 * amber mark on its picture, here as everywhere.
 *
 * `size` only changes how big the words are: "hero" for My favorites,
 * "row" for the other rows, "grid" for a category's page. The card's width
 * is set by whatever holds it.
 */
export function VideoCard({ video, size }: { video: LibraryItem; size: "hero" | "row" | "grid" }) {
  const library = useLibrary();
  const favorite = library.isFavorite(video.id);
  const title = size === "grid" ? "text-xl" : size === "hero" ? "text-lg sm:text-xl" : "text-base sm:text-lg";

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-brand/70 hover:shadow-lift">
      {/* The picture is itself a Play button, so the big circle in the middle does what it looks like. */}
      <button
        type="button"
        onClick={() => library.play(video)}
        aria-label={video.isPlaceholder ? `Play ${video.title} (placeholder animation)` : `Play ${video.title}`}
        className="group relative block aspect-video w-full overflow-hidden bg-well active:scale-[0.985]"
      >
        <Thumbnail video={video} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className={`flex items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur transition group-hover:bg-brand group-hover:text-on-brand group-hover:ring-brand-bright ${
              size === "row" ? "h-12 w-12" : "h-16 w-16"
            }`}
          >
            <PlayIcon className={size === "row" ? "ml-0.5 h-5 w-5" : "ml-1 h-7 w-7"} />
          </span>
        </span>
        {video.durationSeconds != null && (
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-2 py-0.5 text-sm font-medium text-white">{formatDuration(video.durationSeconds)}</span>
        )}
        {video.isPlaceholder && <span className={`absolute left-2.5 top-2.5 ${PLACEHOLDER_BADGE} shadow-[0_2px_10px_rgba(0,0,0,.5)]`}>Placeholder</span>}
      </button>

      {/* The title on the left; the heart and, for someone holding a seat, the send icon on the right. */}
      <div className={`flex flex-1 items-center justify-between gap-2 ${size === "grid" ? "px-5 py-4" : "py-2.5 pl-4 pr-2"}`}>
        <h3 className={`line-clamp-2 min-w-0 font-semibold leading-snug ${title}`}>{video.title}</h3>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => library.toggleFavorite(video)}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${video.title} from my favorites` : `Add ${video.title} to my favorites`}
            title={favorite ? "Remove from my favorites" : "Add to my favorites"}
            className={`flex h-11 w-11 items-center justify-center rounded-lg transition active:scale-[0.92] ${
              favorite ? "text-brand-bright hover:bg-wash" : "text-ink-soft hover:bg-wash hover:text-ink"
            }`}
          >
            <HeartIcon filled={favorite} className="h-6 w-6" />
          </button>
          {library.send && (
            <button
              type="button"
              onClick={() => library.send?.(video)}
              aria-label={`Send ${video.title} to a patient`}
              title="Send to a patient"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong text-ink-soft transition hover:border-brand hover:text-ink active:scale-[0.95]"
            >
              <ShareIcon className="h-5 w-5" />
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

/** The card's picture: a still, the video's own frame once the card is near the screen, or the branded panel. */
function Thumbnail({ video }: { video: LibraryItem }) {
  const [failed, setFailed] = useState(false);
  const still = video.posterUrl ?? (video.source.kind === "stream" ? video.source.poster : null);

  if (failed || (!still && video.source.kind !== "file")) return <BrandedFallback />;
  if (still) {
    return (
      // A picture, never a stream: a page of cards must not load a streaming library or a playlist per card.
      // eslint-disable-next-line @next/next/no-img-element -- a CDN or Mux still, no resizing needed
      <img
        src={still}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
      />
    );
  }
  return <FrameAtOneSecond src={video.source.kind === "file" ? video.source.src : ""} onError={() => setFailed(true)} />;
}

/**
 * The video's own frame at one second, for a video with no still. The element
 * (which starts fetching the moment it exists) is only made once the card is
 * within a short distance of the screen.
 */
function FrameAtOneSecond({ src, onError }: { src: string; onError: () => void }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = holder.current;
    if (!element || near) return;
    // A browser without IntersectionObserver (very old) simply loads it.
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  return (
    <span ref={holder} className="block h-full w-full">
      {near && (
        <video
          src={`${src}#t=1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden="true"
          onError={onError}
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        />
      )}
    </span>
  );
}

/** Shown when a thumbnail cannot load. Quiet, on-brand, never a broken image. */
function BrandedFallback() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-brand-hover/40">
      <span className="rounded-lg bg-brand px-3 py-1.5 text-lg font-bold text-on-brand">P3</span>
    </span>
  );
}
