"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { useModalFocus } from "@/components/ui/useModalFocus";
import { refreshPlaybackAction, sendShareAction, type SendResult } from "./[category]/actions";
import { SendPanel } from "./[category]/SendPanel";
import { recordLibraryPlayAction, setFavoriteAction, type FavoriteResult } from "./actions";
import type { LibraryItem } from "./library-item";

/**
 * What every library page with cards shares: the full-screen player, the
 * Send panel, and the person's hearts. The library home (its rows) and a
 * category's page (its grid) both put their cards inside one of these, so a
 * card anywhere on the page plays, sends and hearts the same way, and a
 * heart tapped in one row shows at once on the same video in every other row.
 *
 * PLAYING starts inside the tap that opened the player (browsers allow sound
 * only then). The first time the video actually starts playing after the
 * player opened, one library play is counted for this person
 * (recordLibraryPlayAction); nothing is ever shown about it.
 *
 * THE HEART changes on screen at once, and the server is told what the
 * person now wants ("a favorite" or "not a favorite", never "flip it"). Taps
 * on the same video are sent one after another, never side by side, so the
 * last tap is always the last word the server hears. If the server says no
 * (or cannot be reached), the heart goes back to how it was, unless the
 * person has tapped again since, and one plain sentence says so for a few
 * seconds. "My favorites" on the home page follows the hearts: a new heart
 * puts the video at the front of the row, a heart taken away takes it out.
 *
 * SENDING is only offered to someone holding a seat (`canSend`), and the
 * Send action checks the seat again on the server.
 */

type Library = {
  /** Is this video one of the person's favorites, as the page now shows it? */
  isFavorite: (id: string) => boolean;
  /** Tap the heart on this video. */
  toggleFavorite: (item: LibraryItem) => void;
  /** The person's favorites in the order "My favorites" shows them. */
  favorites: LibraryItem[];
  /** Open the player on this video. */
  play: (item: LibraryItem) => void;
  /** Open the Send panel for this video; null for someone without a seat. */
  send: ((item: LibraryItem) => void) | null;
};

const LibraryContext = createContext<Library | null>(null);

/** The shared library, for a card or a row inside a LibraryBrowser. */
export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary() is only for cards inside a LibraryBrowser.");
  return library;
}

/** The Send panel's state: which video, and the server's answer once it arrives. */
type Sending = { video: LibraryItem; result: SendResult | null };

/** How long the "could not be saved" sentence stays up. */
const NOTICE_MS = 6000;

export function LibraryBrowser({
  children,
  favorites: initialFavorites = [],
  heartedIds = [],
  canSend,
  clinicName,
  logoUrl,
  senderName,
}: {
  children: ReactNode;
  /** "My favorites" as the server read it, most recently hearted first. Only the home page shows the row. */
  favorites?: LibraryItem[];
  /** Other videos on this page the person has hearted (beyond `favorites`), so their hearts start filled. */
  heartedIds?: string[];
  /** True for someone holding a seat: their cards get the Send button. */
  canSend: boolean;
  /** The clinic's name and checked logo address, for the player's mark. */
  clinicName: string;
  logoUrl: string | null;
  /** The signed-in person's name as patients see it, for the player, when they hold a seat. */
  senderName: string | null;
}) {
  const [favorites, setFavorites] = useState<LibraryItem[]>(initialFavorites);
  const [hearted, setHearted] = useState<Set<string>>(() => new Set([...initialFavorites.map((item) => item.id), ...heartedIds]));
  // The same set, kept up to date the moment a tap changes it, so a second tap that lands before the page has redrawn
  // still reads what the first one did (two quick taps on a filled heart end filled, as they should).
  const heartedNow = useRef<Set<string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);
  const playerDialog = useRef<HTMLDivElement>(null);
  useModalFocus(playerDialog, playing !== null);

  // Per video: the request still on its way (so the next one waits for it) and what the person wanted last.
  const queue = useRef(new Map<string, Promise<void>>());
  const wanted = useRef(new Map<string, boolean>());
  const noticeTimer = useRef<number | undefined>(undefined);
  // Counts Send taps. A server answer is only shown if it belongs to the latest tap.
  const sendCount = useRef(0);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  /** Show the heart (and the favorites row) as `favorite`, on screen only. */
  function show(item: LibraryItem, favorite: boolean) {
    const next = new Set(heartedNow.current ?? hearted);
    if (favorite) next.add(item.id);
    else next.delete(item.id);
    heartedNow.current = next;
    setHearted(next);
    setFavorites((now) => {
      const without = now.filter((other) => other.id !== item.id);
      return favorite ? [item, ...without] : without;
    });
  }

  function say(sentence: string) {
    setNotice(sentence);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }

  function toggleFavorite(item: LibraryItem) {
    const favorite = !(heartedNow.current ?? hearted).has(item.id);
    wanted.current.set(item.id, favorite);
    show(item, favorite);

    // One request after another for the same video, so the server always hears the taps in the order they were made.
    const before = queue.current.get(item.id) ?? Promise.resolve();
    const after = before
      .then(() => setFavoriteAction(item.id, favorite))
      // The request itself can fail before the server answers (the tablet dropped off the Wi-Fi).
      .catch((): FavoriteResult => ({ ok: false, error: "We could not reach the server. Your favorites are as they were." }))
      .then((result) => {
        if (result.ok) return;
        // Put the heart back, unless the person has tapped again since: then that later tap decides.
        if (wanted.current.get(item.id) === favorite) {
          wanted.current.set(item.id, !favorite);
          show(item, !favorite);
        }
        say(result.error);
      });
    queue.current.set(item.id, after);
  }

  /** Open the Send panel for a video and ask the server for its link. */
  function send(video: LibraryItem) {
    const thisTap = ++sendCount.current;
    setSending({ video, result: null });
    sendShareAction(video.id)
      // It may be that a link WAS made and only the answer was lost, so the words do not claim otherwise; an unused link simply expires.
      .catch((): SendResult => ({ ok: false, error: "We could not reach the server. Check the connection, then try again." }))
      .then((result) => {
        if (sendCount.current === thisTap) setSending({ video, result });
      });
  }

  function closeSend() {
    sendCount.current++;
    setSending(null);
  }

  // Escape closes whichever overlay is open. The Close buttons do the same for touch.
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
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen]);

  const library: Library = {
    isFavorite: (id) => hearted.has(id),
    toggleFavorite,
    favorites,
    play: setPlaying,
    send: canSend ? send : null,
  };

  return (
    <LibraryContext.Provider value={library}>
      {children}

      {/* The one sentence when a heart could not be saved. Announced to a screen reader; gone by itself after a few seconds. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {notice && <p className="rounded-xl border border-line bg-overlay px-4 py-3 text-base text-ink shadow-panel">{notice}</p>}
      </div>

      {playing && (
        <div
          ref={playerDialog}
          tabIndex={-1}
          data-theme="dark"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black text-ink pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
          role="dialog"
          aria-modal="true"
          aria-label={`${playing.title}, from ${clinicName}`}
        >
          <VideoPlayer
            key={playing.id}
            source={playing.source}
            // Before a signed address runs out, the player asks the server for a fresh one; the clinic's plan is checked again then.
            refresh={async () => {
              const answer = await refreshPlaybackAction(playing.id);
              return answer.ok ? answer.source : answer.reason === "ended" ? null : { kind: "unavailable" };
            }}
            title={playing.title}
            placeholder={playing.isPlaceholder}
            // The still chosen on /pulse; for a stream, the signed still from the video itself.
            poster={playing.posterUrl ?? (playing.source.kind === "stream" ? playing.source.poster : undefined)}
            clinicName={clinicName}
            logoUrl={logoUrl}
            senderName={senderName}
            onClose={() => setPlaying(null)}
            favorite={{ on: hearted.has(playing.id), onToggle: () => toggleFavorite(playing) }}
            // One library play per opening. Nobody waits for the answer, and a play that could not be counted is simply not counted.
            onFirstPlay={() => void recordLibraryPlayAction(playing.id).catch(() => undefined)}
          />
        </div>
      )}

      {sending && (
        <SendPanel
          key={sending.video.id}
          title={sending.video.title}
          placeholder={sending.video.isPlaceholder}
          result={sending.result}
          onRetry={() => send(sending.video)}
          onClose={closeSend}
        />
      )}
    </LibraryContext.Provider>
  );
}
