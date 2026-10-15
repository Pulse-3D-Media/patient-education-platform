import "server-only";
import type { Video } from "@prisma/client";
import { playbackForVideo } from "@/lib/playback-auth";
import type { LibraryItem } from "./library-item";

/**
 * Turn videos the clinic may use into what the cards and the player get.
 * Server only: this is where the address to play is made (through
 * lib/playback-auth.ts: the plain file, or a signed Mux address for this
 * clinic). Every caller has just listed the videos through the access rule
 * (lib/db/videos.ts, lib/db/personal-videos.ts), which is what makes handing
 * out the address right. The player asks for a fresh one before a signed
 * address runs out (refreshPlaybackAction), and the plan is checked again then.
 */
export function toLibraryItems(videos: Video[], now: Date = new Date()): LibraryItem[] {
  return videos.map((video) => ({
    id: video.id,
    title: video.title,
    source: playbackForVideo(video, now, null),
    posterUrl: video.posterUrl,
    durationSeconds: video.durationSeconds,
    isPlaceholder: video.isPlaceholder,
  }));
}
