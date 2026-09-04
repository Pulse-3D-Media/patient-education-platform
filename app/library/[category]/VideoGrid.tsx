"use client";

import { useEffect, useMemo, useState } from "react";
import { VideoPlayer } from "@/components/ui/VideoPlayer";

type Item = { id: string; title: string; src: string; durationSeconds: number | null };

/**
 * The procedure cards, the search box and the full-screen player
 * (the player's controls live in components/ui/VideoPlayer.tsx).
 *
 * This is a client component because tapping a card has to start playback
 * inside the tap itself. Browsers only allow a video to start with sound when
 * the user has just interacted with the page.
 *
 * Thumbnails are the video's own frame at one second, loaded with
 * preload="metadata" so each card costs only a few kilobytes and playback
 * starts faster because the file is already partly fetched. If a thumbnail
 * cannot load, the card shows a branded fallback instead of a broken box.
 */
export function VideoGrid({ videos, categoryLabel }: { videos: Item[]; categoryLabel: string }) {
  const [playing, setPlaying] = useState<Item | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : videos;
  }, [videos, query]);

  // Escape closes the player. The Close button does the same for touch.
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [playing]);

  if (videos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
        <p className="text-xl font-medium">Nothing published in {categoryLabel} yet.</p>
        <p className="mt-2 text-base text-[#bfbfbf]">Procedures appear here as soon as they are released.</p>
      </div>
    );
  }

  return (
    <>
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
            className="h-11 w-full rounded-full border border-white/15 bg-[#0d1113] px-5 text-base text-white placeholder:text-[#667085] focus:border-[#2a829b] focus:outline-none"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-lg text-[#bfbfbf]">No procedures match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          {shown.map((video) => (
            <li key={video.id}>
              <ProcedureCard video={video} onPlay={() => setPlaying(video)} />
            </li>
          ))}
        </ul>
      )}

      {playing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label={playing.title}>
          <VideoPlayer
            key={playing.id}
            src={playing.src}
            title={playing.title}
            subtitle={categoryLabel}
            onClose={() => setPlaying(null)}
          />
        </div>
      )}
    </>
  );
}

function ProcedureCard({ video, onPlay }: { video: Item; onPlay: () => void }) {
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${video.title}`}
      className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d1113] text-left transition hover:-translate-y-0.5 hover:border-[#2a829b]/70 hover:shadow-[0_12px_32px_rgba(0,0,0,.5)] active:scale-[0.985]"
    >
      <div className="relative aspect-video overflow-hidden bg-[#0f1518]">
        {thumbFailed ? (
          <BrandedFallback />
        ) : (
          <video
            src={`${video.src}#t=1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden="true"
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur transition group-hover:bg-[#2a829b] group-hover:ring-[#5fb8d4]">
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-current" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
        {video.durationSeconds != null && (
          <span className="absolute bottom-3 right-3 rounded-md bg-black/70 px-2 py-0.5 text-sm font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
      </div>
      <span className="line-clamp-2 block px-5 py-4 text-xl font-semibold leading-snug">{video.title}</span>
    </button>
  );
}

/** Shown when a thumbnail cannot load. Quiet, on-brand, never a broken image. */
function BrandedFallback() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0d1113] to-[#1e5668]/40">
      <span className="rounded-lg bg-[#2a829b] px-3 py-1.5 text-lg font-bold text-white">P3</span>
    </span>
  );
}

/** 252 seconds becomes "4:12". */
function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
