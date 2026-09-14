import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "./access";
import { prisma } from "./client";
import * as settingsDb from "./settings";
import { createShare, getShareByCode, recordSharePlay, ShareRefusedError } from "./shares";

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
 * The control in each group is the same overlap with a plain (unlocked)
 * read: the change gets through, and the link is made under revoked
 * access, or with settings that were already replaced. That is what the
 * locks prevent, and it proves the detector would fire if they were
 * removed.
 *
 * The second group does the same for the settings: a save that lands
 * while a link is being made has to wait for the link (the settings lock
 * in lib/db/settings.ts), so the link never carries numbers that were
 * already out of date when it was written.
 */

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  // The real function stays the default; one test at a time swaps in a wrapper.
  return { ...actual, lockVideoFacts: vi.fn(actual.lockVideoFacts) };
});

vi.mock("./settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings")>();
  return { ...actual, lockSettings: vi.fn(actual.lockSettings) };
});

const real = await vi.importActual<typeof import("./access")>("./access");
const realSettings = await vi.importActual<typeof import("./settings")>("./settings");

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

  const share = await createShare(clinicId, videoId);
  await pending;
  return { share, changeFinishedDuringWait };
}

async function expectRefused(clinicId: string, videoId: string, reason: string) {
  await expect(createShare(clinicId, videoId)).rejects.toMatchObject({ name: "ShareRefusedError", reason });
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
    await recordSharePlay(share.code);
    const after = await getShareByCode(share.code);
    expect(after?.id).toBe(share.id);
    expect(after?.video.isPublished).toBe(false);
    expect(after?.viewCount).toBe(0);
    await expectRefused(clinic, video, "unpublished");
  });

  it("two links being made at once for the same clinic do not block each other", async () => {
    const clinic = await makeClinic();
    const started = Date.now();
    const [a, b] = await Promise.all([createShare(clinic, placeholderVideo), createShare(clinic, placeholderVideo)]);
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
    const error = await createShare(clinic, placeholderVideo).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShareRefusedError);
    expect((error as ShareRefusedError).reason).toBe("not-on-plan");
  });
});

/** The four settings as a row, or null when the row has never been saved. */
const SETTINGS_SELECT = { unclaimedDays: true, viewDays: true, graceDays: true, qrDailyFlag: true } as const;

async function readSettingsRow() {
  return prisma.appSettings.findUnique({ where: { id: realSettings.SETTINGS_ID }, select: SETTINGS_SELECT });
}

/** A plain read of the settings with no lock at all, for the control. What createShare did before the settings lock existed. */
async function readSettingsPlain(tx: Prisma.TransactionClient): Promise<settingsDb.Settings> {
  const row = await tx.appSettings.findUnique({ where: { id: realSettings.SETTINGS_ID }, select: SETTINGS_SELECT });
  return row ?? realSettings.SETTINGS_DEFAULTS;
}

/**
 * Make a link while a settings `change` lands in the middle of
 * createShare(): after it has read the settings and before it inserts.
 * Uses the read given (the real locking one, or the plain one for the
 * control), after which the change is started. Returns the share, and
 * whether the change had already finished by the time createShare() went
 * on to insert.
 */
async function createWhileSettingsChange(
  clinicId: string,
  videoId: string,
  change: () => Promise<unknown>,
  read: (tx: Prisma.TransactionClient) => Promise<settingsDb.Settings> = realSettings.lockSettings,
) {
  let changeFinishedDuringWait = false;
  let pending: Promise<unknown> = Promise.resolve();

  vi.mocked(settingsDb.lockSettings).mockImplementationOnce(async (tx) => {
    const values = await read(tx);
    let done = false;
    pending = change().then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    changeFinishedDuringWait = done;
    return values;
  });

  const share = await createShare(clinicId, videoId);
  await pending;
  return { share, changeFinishedDuringWait };
}

describe("a settings save that arrives while a link is being made", () => {
  // The settings row is shared by the whole app, so these tests put it back
  // exactly as they found it: saved again with its old values, or removed if
  // it did not exist before and a save here created it.
  let before: settingsDb.Settings | null = null;

  beforeEach(async () => {
    before = await readSettingsRow();
  });

  afterEach(async () => {
    if (before) await realSettings.saveSettings(before);
    else await prisma.appSettings.deleteMany({ where: { id: realSettings.SETTINGS_ID } });
  });

  /** The current numbers, and a save that changes the days after the first play to something else. */
  async function planChange() {
    const current = await realSettings.getSettings();
    const changed = { ...current, viewDays: current.viewDays === 3 ? 4 : 3 };
    return { current, changed };
  }

  it("waits: the link carries the numbers it read, the save lands only after the link is written, and the next link carries the new numbers", async () => {
    const clinic = await makeClinic();
    const { current, changed } = await planChange();

    const { share, changeFinishedDuringWait } = await createWhileSettingsChange(clinic, placeholderVideo, () => realSettings.saveSettings(changed));

    // The save could not finish while the link was being made.
    expect(changeFinishedDuringWait).toBe(false);
    // The link carries the numbers that were current when it was written.
    expect(share.daysAfterFirstPlay).toBe(current.viewDays);
    expect((await getShareByCode(share.code))?.daysAfterFirstPlay).toBe(current.viewDays);
    // The save landed afterwards, and a link made now carries the new number.
    expect((await realSettings.getSettings()).viewDays).toBe(changed.viewDays);
    expect((await createShare(clinic, placeholderVideo)).daysAfterFirstPlay).toBe(changed.viewDays);
  });

  it("uses the new numbers when the save landed before the link read them", async () => {
    const clinic = await makeClinic();
    const { changed } = await planChange();
    await realSettings.saveSettings(changed);
    expect((await createShare(clinic, placeholderVideo)).daysAfterFirstPlay).toBe(changed.viewDays);
  });

  it("control: with a plain read instead of the locked one, the save gets through and the link is written with numbers that were already replaced", async () => {
    const clinic = await makeClinic();
    const { current, changed } = await planChange();

    const { share, changeFinishedDuringWait } = await createWhileSettingsChange(
      clinic,
      placeholderVideo,
      () => realSettings.saveSettings(changed),
      readSettingsPlain,
    );

    // This is the race: the save finished in the gap, so by the time the
    // link was written the settings already said something else.
    expect(changeFinishedDuringWait).toBe(true);
    expect(share.daysAfterFirstPlay).toBe(current.viewDays);
    expect((await realSettings.getSettings()).viewDays).toBe(changed.viewDays);
  });
});
