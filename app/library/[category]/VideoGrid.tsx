"use client";

import { useEffect, useRef, useState } from "react";

type Item = { id: string; title: string; src: string };

/**
 * The thumbnail grid plus the full-screen player.
 *
 * This is a client component because tapping a thumbnail has to start playback
 * inside the tap itself. Browsers only allow a video to start with sound when
 * the user has just interacted with the page, so the play() call has to happen
 * in the same tap, not after a page change.
 *
 * Thumbnails are the video's own frame at one second, loaded with
 * preload="metadata" so each card costs only a few kilobytes and playback
 * starts faster because the file is already partly fetched.
 */
export function VideoGrid({ videos }: { videos: Item[] }) {
  const [playing, setPlaying] = useState<Item | null>(null);
  const playerRef = useRef<HTMLVideoElement>(null);

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

  return (
    <>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {videos.map((video) => (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => setPlaying(video)}
              className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d1113] text-left transition active:scale-[0.98] hover:border-[#2a829b]"
            >
              <div className="relative aspect-video bg-[#1a1a1a]">
                <video
                  src={`${video.src}#t=1`}
                  preload="metadata"
                  muted
                  playsInline
                  tabIndex={-1}
                  aria-hidden="true"
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#2a829b] text-white shadow-lg transition group-hover:bg-[#5fb8d4] group-hover:text-black">
                    <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 fill-current" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              </div>
              <span className="block px-6 py-5 text-2xl font-semibold">{video.title}</span>
            </button>
          </li>
        ))}
      </ul>

      {playing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label={playing.title}>
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <h2 className="truncate text-2xl font-semibold text-white">{playing.title}</h2>
            <button
              type="button"
              onClick={() => setPlaying(null)}
              className="flex h-14 shrink-0 items-center rounded-full bg-white/10 px-6 text-lg font-medium text-white hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <video
            ref={playerRef}
            key={playing.id}
            src={playing.src}
            autoPlay
            controls
            playsInline
            controlsList="nodownload"
            className="min-h-0 flex-1 w-full bg-black"
          />
        </div>
      )}
    </>
  );
}
