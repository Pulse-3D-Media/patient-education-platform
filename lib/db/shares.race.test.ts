import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as access from "./access";
import { prisma } from "./client";
import { createShare, getShareByCode, recordShareView, ShareRefusedError } from "./shares";

/**
 * The forced overlap: a change to what the clinic may use arrives AFTER
 * createShare() has read the clinic and the video and BEFORE it inserts
 * the share. Without row locks the change would commit in that gap and
 * the link would be made under access that had just been taken away. With
 * the share locks in lib/db/access.ts the change has to wait until the
 * link is committed, and only then applies.
 *
 * How the gap is forced: lockVideoFacts is the last read before the
 * decision and the insert, so it is wrapped for one call. The wrapper does
 * the real locking read, starts the change on another connection, waits
 * long enough for an unblocked change to finish many times over, notes
 * whether it did, and then lets createShare() carry on. The replay test in
 * shares.test.ts changes the plan BEFORE createShare() starts; this one
 * changes it in the middle, which is the case the locks exist for.
 *
 * The last test is the control: the same overlap with a plain (unlocked)
 * read lets the change through, and the link is made under revoked
 * access. That is what the locks prevent, and it proves the detector would
 * fire if they were removed.
 */

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  // The real function stays the default; one test at a time swaps in a wrapper.
  return { ...actual, lockVideoFacts: vi.fn(actual.lockVideoFacts) };
});

const real = await vi.importActual<typeof import("./access")>("./access");

/** How long the wrapper waits for the change to finish. A change that is not blocked finishes in tens of milliseconds. */
const WAIT_MS = 600;

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

function tag() {
  return randomBytes(4).toString("hex");
}

async function makeClinic(data: { showPlaceholders?: boolean } = {}) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest race clinic ${tag()}`, status: "ACTIVE", categories: ["KNEE"], showPlaceholders: data.showPlaceholders ?? true },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeVideo(isPlaceholder: boolean) {
  const video = await prisma.video.create({
    data: { title: `Vitest race video ${tag()}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

let placeholderVideo = "";

beforeAll(async () => {
  placeholderVideo = await makeVideo(true);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/**
 * Make a link while `change` lands in the middle of createShare(). Uses
 * the read given (the real locking one, or the plain one for the control)
 * for the video, after which the change is started. Returns the share,
 * and whether the change had already finished by the time createShare()
 * went on to insert.
 */
async function createWhile(
  clinicId: string,
  videoId: string,
  change: () => Promise<unknown>,
  read: (tx: Parameters<typeof real.lockVideoFacts>[0], id: string) => ReturnType<typeof real.lockVideoFacts> = real.lockVideoFacts,
) {
  let changeFinishedDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();

  vi.mocked(access.lockVideoFacts).mockImplementationOnce(async (tx, id) => {
    const facts = await read(tx, id);
    let done = false;
    pending = change().then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    changeFinishedDuringWait = done;
    return facts;
  });

  const share = await createShare(clinicId, videoId, 90);
  await pending;
  return { share, changeFinishedDuringWait };
}

async function expectRefused(clinicId: string, videoId: string, reason: string) {
  await expect(createShare(clinicId, videoId, 90)).rejects.toMatchObject({ name: "ShareRefusedError", reason });
}

describe("a change that arrives while a link is being made", () => {
  it("waits when the category leaves the plan: the link is issued, then the plan changes, then a new link is refused", async () => {
    const clinic = await makeClinic();
    const { share, changeFinishedDuringWait } = await createWhile(clinic, placeholderVideo, () =>
      prisma.clinic.update({ where: { id: clinic }, data: { categories: [] } }),
    );

    expect(changeFinishedDuringWait).toBe(false);
    expect((await getShareByCode(share.code))?.id).toBe(share.id);
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinic } })).categories).toEqual([]);
    await expectRefused(clinic, placeholderVideo, "not-on-plan");
  });

  it("waits when the clinic is paused", async () => {
    const clinic = await makeClinic();
    const { share, changeFinishedDuringWait } = await createWhile(clinic, placeholderVideo, () =>
      prisma.clinic.update({ where: { id: clinic }, data: { status: "PAUSED" } }),
    );

    expect(changeFinishedDuringWait).toBe(false);
    expect((await getShareByCode(share.code))?.id).toBe(share.id);
    await expectRefused(clinic, placeholderVideo, "clinic-closed");
  });

  it("waits when placeholders are hidden from the clinic", async () => {
    const clinic = await makeClinic();
    const { share, changeFinishedDuringWait } = await createWhile(clinic, placeholderVideo, () =>
      prisma.clinic.update({ where: { id: clinic }, data: { showPlaceholders: false } }),
    );

    expect(changeFinishedDuringWait).toBe(false);
    expect((await getShareByCode(share.code))?.id).toBe(share.id);
    await expectRefused(clinic, placeholderVideo, "placeholder-hidden");
  });

  it("waits when the video is unpublished, after which the issued link stops too, as unpublishing always does", async () => {
    const clinic = await makeClinic();
    const video = await makeVideo(true);
    const { share, changeFinishedDuringWait } = await createWhile(clinic, video, () =>
      prisma.video.update({ where: { id: video }, data: { isPublished: false } }),
    );

    expect(changeFinishedDuringWait).toBe(false);
    // The link exists, and because its video is now unpublished a play is not counted.
    await recordShareView(share.code);
    const after = await getShareByCode(share.code);
    expect(after?.id).toBe(share.id);
    expect(after?.video.isPublished).toBe(false);
    expect(after?.viewCount).toBe(0);
    await expectRefused(clinic, video, "unpublished");
  });

  it("two links being made at once for the same clinic do not block each other", async () => {
    const clinic = await makeClinic();
    const started = Date.now();
    const [a, b] = await Promise.all([createShare(clinic, placeholderVideo, 90), createShare(clinic, placeholderVideo, 90)]);
    expect(a.code).not.toBe(b.code);
    expect(a.clinicId).toBe(clinic);
    expect(b.clinicId).toBe(clinic);
    // Well under the transaction's own five-second limit: neither waited for the other.
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("control: with a plain read instead of the locking one, the unpublish gets through and the link is made under revoked access", async () => {
    const clinic = await makeClinic();
    const video = await makeVideo(true);
    const { share, changeFinishedDuringWait } = await createWhile(
      clinic,
      video,
      () => prisma.video.update({ where: { id: video }, data: { isPublished: false } }),
      real.readVideoFacts,
    );

    // This is the race: the change finished in the gap, and the link exists anyway.
    expect(changeFinishedDuringWait).toBe(true);
    expect((await getShareByCode(share.code))?.video.isPublished).toBe(false);
  });

  it("still refuses when the change lands before the locked read", async () => {
    const clinic = await makeClinic();
    await prisma.clinic.update({ where: { id: clinic }, data: { categories: [] } });
    const error = await createShare(clinic, placeholderVideo, 90).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShareRefusedError);
    expect((error as ShareRefusedError).reason).toBe("not-on-plan");
  });
});
