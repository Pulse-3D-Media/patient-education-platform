"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { PlayIcon, ShareIcon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/format";
import { sendShareAction, type SendResult } from "./actions";
import { SendPanel } from "./SendPanel";

type Item = { id: string; title: string; src: string; durationSeconds: number | null };

/** The Send panel's state: which video, and the server's answer once it arrives. */
type Sending = { video: Item; result: SendResult | null };

/**
 * The procedure cards, the search box, the full-screen player (its controls
 * live in components/ui/VideoPlayer.tsx) and the Send panel.
 *
 * Each card has two actions, both one tap: tapping the thumbnail plays, and
 * the small send icon beside the title creates a patient link and
 * shows it with a QR code, right here, without leaving the page.
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
  const [sending, setSending] = useState<Sending | null>(null);
  const [query, setQuery] = useState("");

  // Counts Send taps. A server answer is only shown if it belongs to the
  // latest tap, so closing the panel early (or tapping Try again) can never
  // be overwritten by an older, slower answer arriving late.
  const sendCount = useRef(0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : videos;
  }, [videos, query]);

  /** Open the Send panel for a video and ask the server for its link. */
  function send(video: Item) {
    const thisTap = ++sendCount.current;
    setSending({ video, result: null });
    sendShareAction(video.id).then((result) => {
      if (sendCount.current === thisTap) setSending({ video, result });
    });
  }

  function closeSend() {
    sendCount.current++;
    setSending(null);
  }

  // Escape closes whichever overlay is open. The Close buttons do the same
  // for touch. While one is open the page behind it does not scroll.
  const overlayOpen = playing !== null || sending !== null;
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPlaying(null);
      sendCount.current++; // same as closeSend(): a late server answer is ignored
      setSending(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [overlayOpen]);

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
              <ProcedureCard video={video} onPlay={() => setPlaying(video)} onSend={() => send(video)} />
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

      {sending && (
        <SendPanel
          key={sending.video.id}
          title={sending.video.title}
          result={sending.result}
          onRetry={() => send(sending.video)}
          onClose={closeSend}
        />
      )}
    </>
  );
}

function ProcedureCard({ video, onPlay, onSend }: { video: Item; onPlay: () => void; onSend: () => void }) {
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1113] transition hover:-translate-y-0.5 hover:border-[#2a829b]/70 hover:shadow-[0_12px_32px_rgba(0,0,0,.5)]">
      {/* The thumbnail is itself a Play button, so the big circle in the middle does what it looks like. */}
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${video.title}`}
        className="group relative block aspect-video w-full overflow-hidden bg-[#0f1518] active:scale-[0.985]"
      >
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
            <PlayIcon className="ml-1 h-7 w-7" />
          </span>
        </span>
        {video.durationSeconds != null && (
          <span className="absolute bottom-3 right-3 rounded-md bg-black/70 px-2 py-0.5 text-sm font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
      </button>

      {/* Title on the left, the send icon on the right. Playing is the thumbnail above. */}
      <div className="flex flex-1 items-center justify-between gap-4 px-5 py-4">
        <h3 className="line-clamp-2 min-w-0 text-xl font-semibold leading-snug">{video.title}</h3>
        <button
          type="button"
          onClick={onSend}
          aria-label={`Send ${video.title} to a patient`}
          title="Send to a patient"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 text-[#bfbfbf] transition hover:border-[#2a829b] hover:text-white active:scale-[0.95]"
        >
          <ShareIcon className="h-5 w-5" />
        </button>
      </div>
    </article>
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
