"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChaptersIcon, CloseIcon, HeartIcon, QrIcon, ShareIcon } from "@/components/ui/icons";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { VideoPlayer, type PlayerHandle } from "@/components/ui/VideoPlayer";
import { currentChapterIndex, type Chapter } from "@/lib/chapters";
import { formatDuration } from "@/lib/format";
import { watchPageHref } from "@/lib/library-rows";
import { refreshPlaybackAction } from "../../[category]/actions";
import { recordLibraryPlayAction } from "../../actions";
import { useLibrary } from "../../LibraryBrowser";
import type { LibraryItem } from "../../library-item";
import { Thumbnail } from "../../VideoCard";

/** The video's category, as the channel line under the title shows it. */
export type WatchCategory = { label: string; slug: string; image: string };

/**
 * The watch page's content, laid out like YouTube's (decided by Evan on
 * 2026-10-15). Everything here is drawn inside the page's LibraryBrowser,
 * which holds the hearts, the Send panel and the QR panel.
 *
 * On a tablet held sideways and on a computer (`side-by-side:`, in
 * app/globals.css): the video top left and a column on the right with "More
 * in <category>", which scrolls on its own. On a phone or a tablet held
 * upright the column moves under the video.
 *
 * Under the video: the title; the channel line (the category's tile image
 * in a round frame and its name, the whole of it a link to the category);
 * the length and the placeholder mark; then one row of buttons, Favorite,
 * Send to patient and Show QR on screen, the last two only for someone
 * holding a seat (the server checks the seat again when a link is made).
 *
 * THE PLAYER OPENS PAUSED and waits for a Play tap (VideoPlayer). A library
 * play is counted once per opening of this page, at the first time the
 * video really plays (the browser's "playing" event), as before.
 *
 * CHAPTERS (set by Pulse staff on /pulse/videos): when the video has any, a
 * fourth button, Chapters, opens the Chapters panel at the TOP of the right
 * column and pushes "More in <category>" down, like YouTube's; on a phone or
 * an upright tablet, where that column is under the video, it opens in the
 * same place, just under the buttons. The panel lists each chapter's start
 * and name, lights the one playing, and a tap jumps there (playing on, or
 * staying paused). The progress bar carries a mark at each chapter start
 * and the current chapter's name beside the time (PlayerOverlay). With no
 * chapters there is no button and no panel.
 */
export function WatchView({
  video,
  category,
  more,
  clinicName,
  logoUrl,
  senderName,
  chapters,
}: {
  video: LibraryItem;
  category: WatchCategory;
  /** Other videos in the same category this clinic may use, newest first. */
  more: LibraryItem[];
  clinicName: string;
  logoUrl: string | null;
  /** The signed-in person's name as patients see it, for the player's mark, when they hold a seat. */
  senderName: string | null;
  /** The video's chapters, sorted by time; empty for none. */
  chapters: Chapter[];
}) {
  const library = useLibrary();
  const favorite = library.isFavorite(video.id);
  const player = useRef<PlayerHandle>(null);
  const chaptersButton = useRef<HTMLButtonElement>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  /** The chapter playing now (the first until the video says otherwise), or -1 with none. Moves as the video plays. */
  const [current, setCurrent] = useState(chapters.length > 0 ? 0 : -1);

  const jumpTo = (index: number) => {
    setCurrent(index);
    player.current?.jumpTo(chapters[index].startSeconds);
  };
  const closeChapters = () => {
    setChaptersOpen(false);
    chaptersButton.current?.focus({ preventScroll: true });
  };

  return (
    <div className="grid gap-6 side-by-side:grid-cols-[minmax(0,1fr)_22rem] side-by-side:items-start xl:side-by-side:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0">
        {/* The video's box: 16:9, rounded. The player fills it, and takes the whole screen when it goes full screen. */}
        <div className="flex aspect-video w-full overflow-hidden rounded-xl bg-black text-ink" data-theme="dark">
          <VideoPlayer
            key={video.id}
            source={video.source}
            // Before a signed address runs out, the player asks the server for a fresh one; the clinic's plan is checked again then.
            refresh={async () => {
              const answer = await refreshPlaybackAction(video.id);
              return answer.ok ? answer.source : answer.reason === "ended" ? null : { kind: "unavailable" };
            }}
            title={video.title}
            placeholder={video.isPlaceholder}
            // The still chosen on /pulse; for a stream, the signed still from the video itself.
            poster={video.posterUrl ?? (video.source.kind === "stream" ? video.source.poster : undefined)}
            clinicName={clinicName}
            logoUrl={logoUrl}
            senderName={senderName}
            ref={player}
            chapters={chapters}
            // Lights the chapter playing in the panel. Only asked when there are chapters; the same number again changes nothing.
            onTimeChange={chapters.length > 0 ? (seconds) => setCurrent(currentChapterIndex(chapters, seconds)) : undefined}
            // One library play per opening. Nobody waits for the answer, and a play that could not be counted is simply not counted.
            onFirstPlay={() => void recordLibraryPlayAction(video.id).catch(() => undefined)}
          />
        </div>

        <h1 className="mt-4 text-2xl font-semibold leading-tight sm:text-3xl">{video.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          {/* Like a YouTube channel line: the category's picture in a circle and its name, and the whole of it goes to the category. */}
          <Link
            href={`/library/${category.slug}`}
            aria-label={`More from ${category.label}`}
            className="-ml-1 inline-flex min-h-12 items-center gap-3 rounded-full py-1 pl-1 pr-4 transition hover:bg-wash"
          >
            <CategoryAvatar image={category.image} label={category.label} />
            <span className="text-lg font-semibold">{category.label}</span>
          </Link>
          <span className="flex items-center gap-3 text-base text-ink-soft">
            {video.durationSeconds != null && <span>{formatDuration(video.durationSeconds)}</span>}
            {video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder animation</span>}
          </span>
        </div>

        {/* One row of buttons, each one tap and at least 48px tall. */}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => library.toggleFavorite(video)}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${video.title} from my favorites` : `Add ${video.title} to my favorites`}
            className={`${ACTION} ${favorite ? "border-transparent bg-brand/20 text-brand-bright" : ""}`}
          >
            <HeartIcon filled={favorite} className="h-5 w-5" />
            {favorite ? "Favorited" : "Favorite"}
          </button>
          {library.send && (
            <button type="button" onClick={() => library.send?.(video)} className={ACTION}>
              <ShareIcon className="h-5 w-5" />
              Send to patient
            </button>
          )}
          {library.showQr && (
            <button type="button" onClick={() => library.showQr?.(video)} className={ACTION}>
              <QrIcon className="h-5 w-5" />
              Show QR on screen
            </button>
          )}
          {chapters.length > 0 && (
            <button
              ref={chaptersButton}
              type="button"
              onClick={() => (chaptersOpen ? closeChapters() : setChaptersOpen(true))}
              aria-expanded={chaptersOpen}
              aria-controls="chapters-panel"
              className={`${ACTION} ${chaptersOpen ? "border-transparent bg-brand/20 text-brand-bright" : ""}`}
            >
              <ChaptersIcon className="h-5 w-5" />
              Chapters
            </button>
          )}
        </div>
        {!library.send && (
          <p className="mt-3 max-w-2xl text-base text-ink-soft">
            Sending a video to a patient needs a surgeon seat: ask your clinic&apos;s office admin if you should have one.
          </p>
        )}
      </div>

      {/* The right column: beside the video, scrolling on its own, when the screen is wide and sideways; under it otherwise.
          The Chapters panel, when open, is at its top and pushes "More in <category>" down. */}
      <div className="flex min-w-0 flex-col gap-6 side-by-side:sticky side-by-side:top-20 side-by-side:max-h-[calc(100vh-6rem)] side-by-side:overflow-y-auto side-by-side:pr-1">
        {chaptersOpen && chapters.length > 0 && <ChaptersPanel chapters={chapters} current={current} onJump={jumpTo} onClose={closeChapters} />}

        <section aria-labelledby="more-heading" className="min-w-0">
          <h2 id="more-heading" className="mb-3 text-xl font-semibold">
            More in {category.label}
          </h2>
          {more.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {more.map((item) => (
                <li key={item.id}>
                  <MoreItem video={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-ink-muted">Nothing else in {category.label} yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The Chapters panel, YouTube's way: a heading with a close button, then one
 * row per chapter, its start time and its name, the one playing lit. A tap
 * jumps there. Opening it puts the keyboard on its heading and brings it
 * into view (on a phone it is just under the buttons; beside the video, at
 * the top of the column, which may have been scrolled).
 */
function ChaptersPanel({ chapters, current, onJump, onClose }: { chapters: Chapter[]; current: number; onJump: (index: number) => void; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <section id="chapters-panel" aria-labelledby="chapters-heading" className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line py-1 pl-4 pr-1">
        <h2 id="chapters-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
          Chapters
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chapters"
          title="Close"
          className="flex h-12 w-12 items-center justify-center rounded-full text-ink-soft transition hover:bg-wash hover:text-ink"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      <ol className="flex flex-col p-2">
        {chapters.map((chapter, index) => {
          const playing = index === current;
          return (
            <li key={chapter.startSeconds}>
              <button
                type="button"
                onClick={() => onJump(index)}
                aria-current={playing ? "true" : undefined}
                aria-label={`${chapter.title}, starts at ${formatDuration(chapter.startSeconds)}`}
                className={`flex min-h-12 w-full items-center gap-4 rounded-xl px-3 py-2 text-left transition ${playing ? "bg-brand/15" : "hover:bg-wash"}`}
              >
                <span
                  className={`w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums ${playing ? "bg-brand text-on-brand" : "bg-sunken text-ink-soft"}`}
                >
                  {formatDuration(chapter.startSeconds)}
                </span>
                <span className={`min-w-0 flex-1 text-base leading-snug text-ink ${playing ? "font-semibold" : ""}`}>{chapter.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The look of the row of buttons under the video. */
const ACTION =
  "inline-flex min-h-12 items-center gap-2 rounded-full border border-line-strong px-5 text-base font-medium text-ink transition hover:border-brand hover:bg-wash active:scale-[0.97]";

/**
 * The category's round picture: its tile image, cropped to the circle. With
 * no image, or one that will not load, the category's first letter on a
 * quiet circle, never a broken picture. A changed image starts again.
 */
export function CategoryAvatar({ image, label }: { image: string; label: string }) {
  const img = useRef<HTMLImageElement>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showImage = image !== "" && failedFor !== image;

  // The picture can fail before React has attached onError, because the server sent the <img> in the page's HTML.
  // decode() settles either way, even for a picture that failed long ago, so it catches what the handler missed
  // (the same check as ClinicLogo).
  useEffect(() => {
    const picture = img.current;
    if (!picture || typeof picture.decode !== "function") return;
    let current = true;
    picture.decode().catch(() => {
      if (current && !(picture.complete && picture.naturalWidth > 0)) setFailedFor(image);
    });
    return () => {
      current = false;
    };
  }, [image]);

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken ring-1 ring-line" aria-hidden="true">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a still from the public CDN, shown small
        <img ref={img} src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedFor(image)} className="h-full w-full object-cover" />
      ) : (
        <span data-category-initial className="text-base font-semibold text-ink-soft">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** One video in "More in <category>", YouTube's way: a small picture on the left, the title and the length beside it. Opens its own watch page. */
function MoreItem({ video }: { video: LibraryItem }) {
  return (
    <Link
      href={watchPageHref(video.id)}
      prefetch={false}
      aria-label={video.isPlaceholder ? `Watch ${video.title} (placeholder animation)` : `Watch ${video.title}`}
      className="group flex items-start gap-3 rounded-xl p-1 transition hover:bg-wash"
    >
      <span className="relative block aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-well">
        <Thumbnail video={video} />
        {video.durationSeconds != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[13px] font-medium text-white">{formatDuration(video.durationSeconds)}</span>
        )}
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="line-clamp-3 text-base font-semibold leading-snug">{video.title}</span>
        {video.isPlaceholder && <span className={`mt-1.5 ${PLACEHOLDER_BADGE}`}>Placeholder</span>}
      </span>
    </Link>
  );
}
