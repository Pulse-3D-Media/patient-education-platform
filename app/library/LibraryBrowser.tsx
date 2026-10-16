"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sendShareAction, type SendResult } from "./[category]/actions";
import { SendPanel } from "./[category]/SendPanel";
import { setFavoriteAction, type FavoriteResult } from "./actions";
import type { LibraryItem } from "./library-item";
import { ShowQrPanel } from "./watch/[videoId]/ShowQrPanel";

/**
 * What every library page with cards shares: the Send panel, the "Show QR
 * on screen" panel, and the person's hearts. The library home (its rows), a
 * category's page (its grid), the search results and the watch page all put
 * their cards inside one of these, so a card anywhere sends and hearts the
 * same way, and a heart tapped in one place shows at once on the same video
 * everywhere else on the page.
 *
 * PLAYING is not here any more: tapping a card's picture opens the video's
 * watch page (/library/watch/<id>), where the player is.
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
 * SENDING, and showing a QR code on the screen, are only offered to someone
 * holding a seat (`canSend`). Both make a patient link the same way, with
 * the Send action, which checks the seat again on the server; the QR panel
 * only shows the code large, for a patient to scan in the room.
 */

type Library = {
  /** Is this video one of the person's favorites, as the page now shows it? */
  isFavorite: (id: string) => boolean;
  /** Tap the heart on this video. */
  toggleFavorite: (item: LibraryItem) => void;
  /** The person's favorites in the order "My favorites" shows them. */
  favorites: LibraryItem[];
  /** Open the Send panel for this video; null for someone without a seat. */
  send: ((item: LibraryItem) => void) | null;
  /** Make a link for this video and show its QR code large on the screen; null for someone without a seat. */
  showQr: ((item: LibraryItem) => void) | null;
};

const LibraryContext = createContext<Library | null>(null);

/** The shared library, for a card, a row or the watch page inside a LibraryBrowser. */
export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary() is only for cards inside a LibraryBrowser.");
  return library;
}

/** The open panel: which video, which panel, and the server's answer once it arrives. */
type Sending = { video: LibraryItem; panel: "send" | "qr"; result: SendResult | null };

/** How long the "could not be saved" sentence stays up. */
const NOTICE_MS = 6000;

export function LibraryBrowser({
  children,
  favorites: initialFavorites = [],
  heartedIds = [],
  canSend,
}: {
  children: ReactNode;
  /** "My favorites" as the server read it, most recently hearted first. Only the home page shows the row. */
  favorites?: LibraryItem[];
  /** Other videos on this page the person has hearted (beyond `favorites`), so their hearts start filled. */
  heartedIds?: string[];
  /** True for someone holding a seat: they get Send (and, on the watch page, Show QR on screen). */
  canSend: boolean;
}) {
  const [favorites, setFavorites] = useState<LibraryItem[]>(initialFavorites);
  const [hearted, setHearted] = useState<Set<string>>(() => new Set([...initialFavorites.map((item) => item.id), ...heartedIds]));
  // The same set, kept up to date the moment a tap changes it, so a second tap that lands before the page has redrawn
  // still reads what the first one did (two quick taps on a filled heart end filled, as they should).
  const heartedNow = useRef<Set<string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);

  // Per video: the request still on its way (so the next one waits for it) and what the person wanted last.
  const queue = useRef(new Map<string, Promise<void>>());
  const wanted = useRef(new Map<string, boolean>());
  const noticeTimer = useRef<number | undefined>(undefined);
  // Counts Send and Show QR taps. A server answer is only shown if it belongs to the latest tap.
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

  /** Open a panel for a video ("send", or "qr" for the code on the screen) and ask the server for its link. */
  function makeLink(video: LibraryItem, panel: "send" | "qr") {
    const thisTap = ++sendCount.current;
    setSending({ video, panel, result: null });
    sendShareAction(video.id)
      // It may be that a link WAS made and only the answer was lost, so the words do not claim otherwise; an unused link simply expires.
      .catch((): SendResult => ({ ok: false, error: "We could not reach the server. Check the connection, then try again." }))
      .then((result) => {
        if (sendCount.current === thisTap) setSending({ video, panel, result });
      });
  }

  function closePanel() {
    sendCount.current++; // a late server answer is ignored
    setSending(null);
  }

  // Escape closes whichever panel is open. Their Close and Done buttons do the same for touch.
  const panelOpen = sending !== null;
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      sendCount.current++; // same as closePanel(): a late server answer is ignored
      setSending(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const library: Library = {
    isFavorite: (id) => hearted.has(id),
    toggleFavorite,
    favorites,
    send: canSend ? (video) => makeLink(video, "send") : null,
    showQr: canSend ? (video) => makeLink(video, "qr") : null,
  };

  return (
    <LibraryContext.Provider value={library}>
      {children}

      {/* The one sentence when a heart could not be saved. Announced to a screen reader; gone by itself after a few seconds. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {notice && <p className="rounded-xl border border-line bg-overlay px-4 py-3 text-base text-ink shadow-panel">{notice}</p>}
      </div>

      {sending?.panel === "send" && (
        <SendPanel
          key={sending.video.id}
          title={sending.video.title}
          placeholder={sending.video.isPlaceholder}
          result={sending.result}
          onRetry={() => makeLink(sending.video, "send")}
          onClose={closePanel}
        />
      )}

      {sending?.panel === "qr" && (
        <ShowQrPanel
          key={sending.video.id}
          title={sending.video.title}
          placeholder={sending.video.isPlaceholder}
          result={sending.result}
          onRetry={() => makeLink(sending.video, "qr")}
          onClose={closePanel}
        />
      )}
    </LibraryContext.Provider>
  );
}
