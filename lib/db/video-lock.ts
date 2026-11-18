import type { Prisma } from "@prisma/client";
import type { GuardedVideoValues } from "../video-form-guard";

/**
 * Lock one video's row for a save from /pulse/videos, and read what the save
 * needs to decide with, inside the save's own transaction.
 *
 * FOR UPDATE: a second save of the same video (a colleague's tab, a double
 * click) waits here until the first has committed, and then reads what the
 * first wrote. Without the lock both could read the same "before", and the
 * later write would quietly put back a value the earlier one had just
 * changed (lib/video-form-guard.ts says why that matters).
 *
 * Plain SQL, because Prisma's query builder cannot ask for a row lock. Its
 * own file so the race test can step into the gap after it
 * (lib/db/videos.race.test.ts). Null for an unknown id.
 */
export async function lockVideoForEdit(tx: Prisma.TransactionClient, videoId: string): Promise<(GuardedVideoValues & { id: string }) | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Video" WHERE id = ${videoId} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, category: true, posterUrl: true, notes: true, isPublished: true, isPlaceholder: true },
  });
}
