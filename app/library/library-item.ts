import type { PlaybackSource } from "@/lib/playback-source";

/**
 * One video as the library's cards and player get it: only plain data, made
 * on the server (app/library/items.ts) for a video the clinic may use. Safe
 * for the browser; nothing here can open a video the server did not hand out.
 */
export type LibraryItem = {
  id: string;
  title: string;
  /** What to play, made on the server for this clinic (lib/playback-auth.ts): a plain file, or a signed Mux stream. */
  source: PlaybackSource;
  /** A still for the card, chosen on /pulse. Null means the video's own first frame, or the branded fallback. */
  posterUrl: string | null;
  durationSeconds: number | null;
  isPlaceholder: boolean;
};
