import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readShownVideoValues, shownBoxesFor, type GuardedVideoValues } from "../video-form-guard";
import { prisma } from "./client";
import * as videoLock from "./video-lock";
import { updateVideoKeepingOthers, type VideoInput } from "./videos";

/**
 * The forced overlap for the video form's save (updateVideoKeepingOthers):
 * a colleague unpublishes a video AFTER a stale page's save has read the row
 * and BEFORE it writes. The stale page only changed the notes, so it means
 * to keep Published as the row says. Without the row lock it read
 * "published" a moment before the unpublish, and would write "published"
 * back over it: the unpublish silently undone. With the lock
 * (lockVideoForEdit, FOR UPDATE) the colleague's write waits until the save
 * has committed, then lands, and the video ends unpublished.
 *
 * How the gap is forced, as in lib/db/shares.race.test.ts: the lock-and-read
 * is wrapped for one call. The wrapper does the read (the real locking one,
 * or a plain unlocked one for the control), starts the colleague's write on
 * another connection, waits long enough for an unblocked write to finish
 * many times over, notes whether it did, and lets the save carry on.
 *
 * The control proves the detector would fire if the lock were removed.
 */

vi.mock("./video-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./video-lock")>();
  return { ...actual, lockVideoForEdit: vi.fn(actual.lockVideoForEdit) };
});

const real = await vi.importActual<typeof import("./video-lock")>("./video-lock");

/** How long the wrapper waits for the colleague's write. An unblocked write takes milliseconds locally, several hundred against Neon. */
const WAIT_MS = 2000;

const createdVideoIds: string[] = [];

afterAll(async () => {
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

/** The same read with no lock: the control. */
async function plainRead(tx: Prisma.TransactionClient, id: string) {
  return tx.video.findUnique({
    where: { id },
    select: { id: true, title: true, category: true, posterUrl: true, notes: true, isPublished: true, isPlaceholder: true },
  });
}

async function staleSaveWhileUnpublished(read: typeof real.lockVideoForEdit) {
  const video = await prisma.video.create({
    data: { title: `Vitest video race ${randomBytes(4).toString("hex")}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
  });
  createdVideoIds.push(video.id);

  // The stale page: drawn while the video was published, and only the notes typed.
  const input: VideoInput = {
    title: video.title,
    category: video.category,
    videoUrl: video.videoUrl,
    durationSeconds: null,
    posterUrl: null,
    isPlaceholder: false,
    isPublished: true,
    notes: "Typed on the stale page",
    muxPlaybackId: null,
    muxAssetId: null,
  };
  const boxes = new FormData();
  for (const [name, value] of Object.entries(shownBoxesFor(video as GuardedVideoValues))) boxes.append(name, value);
  const shown = readShownVideoValues(boxes);

  let finishedDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();
  vi.mocked(videoLock.lockVideoForEdit).mockImplementationOnce(async (tx, id) => {
    const facts = await read(tx, id);
    let done = false;
    // The colleague's unpublish, on its own connection.
    pending = prisma.video.update({ where: { id: video.id }, data: { isPublished: false } }).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    finishedDuringWait = done;
    return facts;
  });

  await updateVideoKeepingOthers(video.id, input, shown);
  await pending;
  const row = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
  return { finishedDuringWait, row };
}

describe("a colleague's unpublish that lands in the middle of a stale page's save", () => {
  it("waits for the save, then applies: the video ends unpublished, with the stale page's notes", async () => {
    const { finishedDuringWait, row } = await staleSaveWhileUnpublished(real.lockVideoForEdit);
    expect(finishedDuringWait).toBe(false);
    expect(row).toMatchObject({ isPublished: false, notes: "Typed on the stale page" });
  });

  it("control: with an unlocked read, the unpublish gets through in the gap and the save puts Published back", async () => {
    const { finishedDuringWait, row } = await staleSaveWhileUnpublished(plainRead);
    expect(finishedDuringWait).toBe(true);
    expect(row).toMatchObject({ isPublished: true, notes: "Typed on the stale page" });
  });
});
