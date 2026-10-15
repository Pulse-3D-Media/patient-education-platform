"use server";

import { auth } from "@clerk/nextjs/server";
import { getCurrentClinicId } from "@/lib/clinic";
import { recordLibraryPlay, setFavorite } from "@/lib/db/personal-videos";
import { errorKind } from "@/lib/error-kind";

/**
 * The two Server Actions behind a person's own library: the heart, and
 * counting a play. Anyone in an open clinic who can browse the library may
 * use both; they are about the person themselves and nobody else.
 *
 * WHO is never in what the browser sends. The clinic comes from the
 * server's own lookup (getCurrentClinicId(): null for someone signed out, or
 * at a clinic that is not open) and the person from Clerk's session. The
 * browser sends only a video id, and for the heart, whether it should be a
 * favorite. lib/db/personal-videos.ts then checks the clinic may use that
 * video, so a made-up id or one from another clinic's plan writes nothing.
 *
 * THE HEART SAYS WHAT IT WANTS, never "flip it", so a tap sent twice ends
 * the same way as a tap sent once.
 */

/** What the heart gets back: saved, or a plain sentence (the card goes back to how it was). */
export type FavoriteResult = { ok: true; favorite: boolean } | { ok: false; error: string };

/** The longest id the actions will look at. Video ids are cuids (25 characters); anything far longer is junk. */
const MAX_ID_LENGTH = 64;

/** A video id as the browser sent it, checked for shape only. Null when it is not even that. */
function readVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_ID_LENGTH ? id : null;
}

/** Heart a video, or take the heart away. `favorite` is what the person wants it to be. */
export async function setFavoriteAction(videoId: unknown, favorite: unknown): Promise<FavoriteResult> {
  try {
    const id = readVideoId(videoId);
    if (!id || typeof favorite !== "boolean") return { ok: false, error: "That could not be saved. Try again." };

    const clinicId = await getCurrentClinicId();
    const { userId } = await auth();
    if (!clinicId || !userId) return { ok: false, error: "Your favorites can't be changed right now. Sign in again, or ask your clinic's admin." };

    const outcome = await setFavorite(clinicId, userId, id, favorite);
    if (!outcome.ok) return { ok: false, error: "That video is not in your clinic's library right now, so it can't be a favorite." };
    return { ok: true, favorite };
  } catch (error) {
    // The kind of failure only: never the error itself, which could carry an id or a connection string.
    console.error("Saving a library favorite failed", errorKind(error));
    return { ok: false, error: "That could not be saved just now. Try again in a moment." };
  }
}

/**
 * Count one library play: the player was opened and the video actually
 * started playing. The player calls it once per time it is opened. Nobody
 * is told the answer (no number is ever shown on the clinic side); a play
 * that could not be counted is simply not counted.
 */
export async function recordLibraryPlayAction(videoId: unknown): Promise<{ recorded: boolean }> {
  try {
    const id = readVideoId(videoId);
    if (!id) return { recorded: false };
    const clinicId = await getCurrentClinicId();
    const { userId } = await auth();
    if (!clinicId || !userId) return { recorded: false };
    const outcome = await recordLibraryPlay(clinicId, userId, id);
    return { recorded: outcome.ok };
  } catch (error) {
    console.error("Counting a library play failed", errorKind(error));
    return { recorded: false };
  }
}
