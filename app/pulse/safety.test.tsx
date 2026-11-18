import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { activatePricingVersion } from "@/lib/db/pricing";
import { saveSettingsAndCompare, SETTINGS_DEFAULTS, type Settings } from "@/lib/db/settings";
import { shortLinkId } from "@/lib/renewal-note";
import { shownBoxesFor } from "@/lib/video-form-guard";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { activatePricingVersionAction, countWorkingLinksAction, saveCategoryConfigAction, saveSettingsAction, saveVideoAction } from "./actions";
import PulseClinicPage from "./clinics/[id]/page";

/**
 * The guard rails on /pulse against a slip (audit findings D1 to D4, 2026-11-16),
 * with Clerk replaced by the stand-in and the real test database:
 *
 *   D1  unpublishing: the count the yes shows, and who did it in the log;
 *   D2  a page left open keeps a colleague's publish, unpublish or other save;
 *   D3  a clinic's Links tab never has a link's code in it;
 *   D4  who changed the settings, a category, or the active pricing, in the log.
 *
 * For every action: a clinic's own admin and a signed-out person get
 * not-found, and nothing is written. Log lines hold only what is allowed:
 * names, a title, a row id, numbers, never a link code.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "localhost:3000" })) }));

// The settings row and the active pricing version are shared by the whole app and belong to no test: their saves are
// stand-ins here, answering as the real ones do (lib/db/settings.test.ts and lib/db/pricing.test.ts cover the real ones).
vi.mock("@/lib/db/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/settings")>();
  return { ...actual, saveSettingsAndCompare: vi.fn() };
});
vi.mock("@/lib/db/pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/pricing")>();
  return { ...actual, activatePricingVersion: vi.fn() };
});

vi.setConfig({ testTimeout: 60_000 });

const TOKEN = randomBytes(4).toString("hex");
const STAFF = `user_vitest_safety_staff_${TOKEN}`;
const ADMIN = `user_vitest_safety_admin_${TOKEN}`;
const ORG = `org_vitest_safety_${TOKEN}`;
const DAY = 86_400_000;

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let logged: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF, "Van", "Miller");
  fakeClerk.addOrg(ORG, "Vitest safety clinic", [{ userId: ADMIN, role: "org:admin" }]);
  logged = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.mocked(saveSettingsAndCompare).mockImplementation(async (values: Settings) => ({ before: SETTINGS_DEFAULTS, after: values }));
});

afterEach(() => {
  vi.mocked(console.info).mockRestore();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.qrCode.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

/** The two people who must never get through: a clinic's own office admin, and nobody at all. */
const OUTSIDERS: [string, () => void][] = [
  ["a clinic admin", () => fakeClerk.signIn(ADMIN, ORG)],
  ["a signed-out person", () => fakeClerk.signIn(null, null)],
];

const asStaff = () => fakeClerk.signIn(STAFF, null);
const notFound = { digest: expect.stringContaining("404") };

async function makeVideo(data: Partial<{ isPublished: boolean; title: string }> = {}) {
  const video = await prisma.video.create({
    data: { title: `Vitest safety ${randomBytes(3).toString("hex")}`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, ...data },
  });
  createdVideoIds.push(video.id);
  return video;
}

async function makeClinic() {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest safety clinic ${TOKEN}`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function makeLink(clinicId: string, videoId: string, expiresAt: Date, extra: Record<string, unknown> = {}) {
  const code = `zs${randomBytes(8).toString("hex")}`;
  const share = await prisma.share.create({ data: { code, clinicId, videoId, expiresAt, ...extra } });
  return share;
}

/** The video form as a page drawn from `row` would send it, with `changes` typed on top. */
function formFrom(row: Awaited<ReturnType<typeof makeVideo>>, changes: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    id: row.id,
    title: row.title,
    category: row.category,
    videoUrl: row.videoUrl ?? "",
    durationSeconds: "",
    posterUrl: row.posterUrl ?? "",
    notes: row.notes ?? "",
    muxPlaybackId: "",
    muxAssetId: "",
    shownMuxPlaybackId: "",
    shownMuxAssetId: "",
    shownDurationSeconds: "",
    ...shownBoxesFor(row),
    ...changes,
  };
  if (row.isPublished && !("isPublished" in changes)) fields.isPublished = "on";
  if (row.isPlaceholder && !("isPlaceholder" in changes)) fields.isPlaceholder = "on";
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== "" || !["isPublished", "isPlaceholder"].includes(name)) data.append(name, value);
  return data;
}

describe("D1: the count before an unpublish (countWorkingLinksAction)", () => {
  it("is a number of this video's links that work right now: not another video's, not expired or paused ones", async () => {
    const clinic = await makeClinic();
    const video = await makeVideo();
    const other = await makeVideo();
    await makeLink(clinic, video.id, new Date(Date.now() + 90 * DAY));
    await makeLink(clinic, video.id, new Date(Date.now() + DAY), { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7, firstPlayedAt: new Date(Date.now() - 6 * DAY) });
    await makeLink(clinic, video.id, new Date(Date.now() - DAY));
    await makeLink(clinic, video.id, new Date(Date.now() - 1000), { expiryPolicy: "FIRST_PLAY", daysAfterFirstPlay: 7, firstPlayedAt: new Date(Date.now() - 8 * DAY), renewalRequestedAt: new Date() });
    await makeLink(clinic, other.id, new Date(Date.now() + 90 * DAY));
    asStaff();
    expect(await countWorkingLinksAction(video.id)).toEqual({ count: 2 });
    expect(await countWorkingLinksAction("not a video id!")).toEqual({ error: "That video no longer exists." });
  });

  it.each(OUTSIDERS)("is not-found for %s", async (_who, signIn) => {
    const video = await makeVideo();
    signIn();
    await expect(countWorkingLinksAction(video.id)).rejects.toMatchObject(notFound);
  });
});

describe("D1 and D2: saving the video form (saveVideoAction)", () => {
  it("records an unpublish and a publish under the staff member's name, with the title and row id and nothing else", async () => {
    const clinic = await makeClinic();
    const video = await makeVideo({ title: `Vitest safety log ${TOKEN}` });
    const link = await makeLink(clinic, video.id, new Date(Date.now() + 90 * DAY));
    asStaff();

    expect(await saveVideoAction(null, formFrom(video, { isPublished: "" }))).toEqual({
      ok: "Saved and unpublished. Every link to this video stops working until it is published again.",
    });
    expect(logged).toEqual([`Video unpublished: "Vitest safety log ${TOKEN}" (${video.id}) by Van Miller`]);

    const now = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(await saveVideoAction(null, formFrom(now, { isPublished: "on" }))).toMatchObject({ ok: expect.any(String) });
    expect(logged[1]).toBe(`Video published: "Vitest safety log ${TOKEN}" (${video.id}) by Van Miller`);
    for (const line of logged) expect(line).not.toContain(link.code);

    // A save that does not change Published writes no line.
    expect(await saveVideoAction(null, formFrom(await prisma.video.findUniqueOrThrow({ where: { id: video.id } }), { notes: "just a note" }))).toMatchObject({ ok: expect.any(String) });
    expect(logged).toHaveLength(2);
  });

  it("a page left open, saved with only its notes changed, keeps a colleague's unpublish (and logs nothing)", async () => {
    const video = await makeVideo();
    asStaff();
    // The colleague unpublishes after this page was drawn.
    await prisma.video.update({ where: { id: video.id }, data: { isPublished: false, isPlaceholder: true, title: `${video.title} renamed` } });
    expect(await saveVideoAction(null, formFrom(video, { notes: "Typed on the stale page" }))).toMatchObject({ ok: expect.any(String) });
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({
      isPublished: false,
      isPlaceholder: true,
      title: `${video.title} renamed`,
      notes: "Typed on the stale page",
    });
    expect(logged).toEqual([]);
  });

  it("a deliberate untick on a page left open still unpublishes, even when a colleague changed the notes", async () => {
    const video = await makeVideo();
    asStaff();
    await prisma.video.update({ where: { id: video.id }, data: { notes: "Colleague's note" } });
    await saveVideoAction(null, formFrom(video, { isPublished: "" }));
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ isPublished: false, notes: "Colleague's note" });
  });

  it.each(OUTSIDERS)("is not-found for %s, and nothing is written", async (_who, signIn) => {
    const video = await makeVideo();
    signIn();
    await expect(saveVideoAction(null, formFrom(video, { isPublished: "" }))).rejects.toMatchObject(notFound);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).isPublished).toBe(true);
    expect(logged).toEqual([]);
  });
});

describe("D3: a clinic's Links tab on /pulse", () => {
  it("names each link by its video, date and the end of its row id, and has no link code (or printed code) anywhere in the page", async () => {
    const clinicId = await makeClinic();
    const video = await makeVideo({ title: `Vitest safety links ${TOKEN}` });
    const qr = await prisma.qrCode.create({
      data: { code: `zq${randomBytes(10).toString("hex")}`, clinicId, videoId: video.id, senderUserId: `user_${TOKEN}` },
    });
    const links = [
      await makeLink(clinicId, video.id, new Date(Date.now() + 90 * DAY)),
      await makeLink(clinicId, video.id, new Date(Date.now() - DAY)),
      await makeLink(clinicId, video.id, new Date(Date.now() + 5 * DAY), { qrCodeId: qr.id }),
    ];
    asStaff();
    const html = renderToStaticMarkup(await PulseClinicPage({ params: Promise.resolve({ id: clinicId }), searchParams: Promise.resolve({}) } as never));

    expect(html).toContain(`Vitest safety links ${TOKEN}`);
    for (const link of links) {
      expect(html).not.toContain(link.code);
      expect(html).toContain(shortLinkId(link.id));
    }
    expect(html).not.toContain(qr.code);
    expect(html).not.toContain(`/watch/`);
    expect(html).not.toContain(`/q/`);
  });

  it.each(OUTSIDERS)("is not-found for %s", async (_who, signIn) => {
    const clinicId = await makeClinic();
    signIn();
    await expect(PulseClinicPage({ params: Promise.resolve({ id: clinicId }), searchParams: Promise.resolve({}) } as never)).rejects.toMatchObject(notFound);
  });
});

describe("D4: who changed the settings, a category, or the active pricing", () => {
  const typed = (over: Partial<Record<keyof Settings, string>> = {}) => {
    const data = new FormData();
    for (const [name, value] of Object.entries({ ...Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([k, v]) => [k, String(v)])), ...over })) data.append(name, value);
    return data;
  };

  it("a settings save logs the staff member's name and which settings changed from what to what, numbers only", async () => {
    asStaff();
    expect(await saveSettingsAction(null, typed({ maxRenewals: "0", viewDays: "10" }))).toEqual({ ok: "Settings saved." });
    expect(logged).toEqual(["Settings changed: viewDays 7 -> 10, maxRenewals 3 -> 0 by Van Miller"]);
    // A save that changes nothing writes no line.
    expect(await saveSettingsAction(null, typed())).toEqual({ ok: "Settings saved." });
    expect(logged).toHaveLength(1);
  });

  it.each(OUTSIDERS)("settings: not-found for %s, nothing saved and nothing logged", async (_who, signIn) => {
    signIn();
    await expect(saveSettingsAction(null, typed({ maxRenewals: "0" }))).rejects.toMatchObject(notFound);
    expect(saveSettingsAndCompare).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("a category's sale switch and details are logged under the staff member's name, and a save that changes nothing is not", async () => {
    const before = await prisma.categoryConfig.findUnique({ where: { category: "KNEE" } });
    try {
      asStaff();
      const data = new FormData();
      data.append("category", "KNEE");
      data.append("comingSoonText", "");
      data.append("label", "Knee and leg");
      data.append("slug", "");
      data.append("imageUrl", "");
      data.append("sortOrder", "");
      expect(await saveCategoryConfigAction(null, data)).toEqual({ ok: "Saved. This category is not for sale." });
      expect(logged).toEqual([expect.stringMatching(/^Category changed: KNEE \((for sale yes -> no, )?name "[^"]+" -> "Knee and leg"\) by Van Miller$/)]);
      expect(await saveCategoryConfigAction(null, data)).toMatchObject({ ok: expect.any(String) });
      expect(logged).toHaveLength(1);
    } finally {
      // Put the row back the way it was found.
      if (before) await prisma.categoryConfig.update({ where: { category: "KNEE" }, data: { sellable: before.sellable, comingSoonText: before.comingSoonText, label: before.label, slug: before.slug, imageUrl: before.imageUrl, sortOrder: before.sortOrder, formerSlugs: before.formerSlugs } });
      else await prisma.categoryConfig.update({ where: { category: "KNEE" }, data: { sellable: true, comingSoonText: null, label: null } });
    }
  });

  it.each(OUTSIDERS)("category: not-found for %s, nothing written", async (_who, signIn) => {
    const before = await prisma.categoryConfig.findUnique({ where: { category: "KNEE" } });
    signIn();
    const data = new FormData();
    data.append("category", "KNEE");
    await expect(saveCategoryConfigAction(null, data)).rejects.toMatchObject(notFound);
    expect(await prisma.categoryConfig.findUnique({ where: { category: "KNEE" } })).toEqual(before);
    expect(logged).toEqual([]);
  });

  it("making a pricing version active is logged with its number and the staff member's name", async () => {
    vi.mocked(activatePricingVersion).mockResolvedValue({ version: 7 } as never);
    asStaff();
    const data = new FormData();
    data.append("versionId", "clversion0000000000000007");
    expect(await activatePricingVersionAction(null, data)).toEqual({ ok: "Version 7 is now active." });
    expect(logged).toEqual(["Pricing version 7 made active by Van Miller"]);
  });

  it.each(OUTSIDERS)("pricing: not-found for %s, nothing activated", async (_who, signIn) => {
    signIn();
    const data = new FormData();
    data.append("versionId", "clversion0000000000000007");
    await expect(activatePricingVersionAction(null, data)).rejects.toMatchObject(notFound);
    expect(activatePricingVersion).not.toHaveBeenCalled();
  });
});
