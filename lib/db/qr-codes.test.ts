import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isExpired } from "../expiry";
import { prisma } from "./client";
import {
  createQrCode,
  getLiveQrCodeForClinic,
  getQrCodeByCode,
  listLiveQrCodesForClinic,
  listQrCodesForPulse,
  replaceQrCode,
  retireQrCode,
} from "./qr-codes";
import { getSettings } from "./settings";
import { childShareCode, getShareByCode, issueShareFromQrCode, recordSharePlay, SenderRefusedError, ShareRefusedError } from "./shares";

/**
 * Printed (permanent) QR codes against the real testing database: making,
 * retiring and replacing a code, and the link a patient's Play tap gets from
 * one (issueShareFromQrCode). What these prove:
 *
 *   - one live code per procedure per surgeon, even with five presses at once;
 *   - a code is made only when the clinic may use the video and the surgeon
 *     holds a seat, and a refusal writes nothing;
 *   - a code is 25 random characters, and a clash on it is tried again;
 *   - retiring is for good, and only this clinic's codes can be retired;
 *   - replacing is all or nothing;
 *   - each visit gets its own link, a retried visit gets the same one (five
 *     tries at once write one), and opening the page makes none;
 *   - a retired code, a closed clinic, a category off the plan, an
 *     unpublished video and a hidden placeholder hand out nothing;
 *   - a surgeon who lost their seat: the code keeps working, its links name
 *     only the clinic;
 *   - links a code already handed out outlive its retirement and a plan change;
 *   - the Pulse counts: today in UTC, and 30 days.
 *
 * Every row is made here and deleted by id afterwards.
 */

const tag = () => randomBytes(6).toString("hex");
const surgeonId = () => `user_qr${tag()}`;
const key = () => randomUUID();

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

async function makeVideo(data: { isPublished?: boolean; isPlaceholder?: boolean; category?: "KNEE" | "HIP" } = {}) {
  const video = await prisma.video.create({
    data: { title: `Vitest QR video ${tag()}`, category: data.category ?? "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: data.isPublished ?? true, isPlaceholder: data.isPlaceholder ?? false },
    select: { id: true, title: true },
  });
  createdVideoIds.push(video.id);
  return video;
}

/** An open Knee clinic with the given people holding seats; `named` gets "Jane Smith, DO" typed for patients. */
async function makeClinic(seated: string[], extra: { status?: "ACTIVE" | "PAUSED"; categories?: ("KNEE" | "HIP")[]; showPlaceholders?: boolean; named?: string } = {}) {
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest QR clinic ${tag()}`,
      status: extra.status ?? "ACTIVE",
      categories: extra.categories ?? ["KNEE"],
      showPlaceholders: extra.showPlaceholders ?? true,
      surgeonSeats: 10,
      seatAllocations: {
        create: seated.map((clerkUserId) => ({ clerkUserId, syncState: "SYNCED" as const, displayName: clerkUserId === extra.named ? "Dr. Jane Smith, DO" : null })),
      },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

const sender = (clerkUserId: string, fallbackName: string | null = "Dr. Pat Lee") => ({ clerkUserId, fallbackName });

async function codeOf(id: string) {
  return (await prisma.qrCode.findUniqueOrThrow({ where: { id }, select: { code: true } })).code;
}

let video = { id: "", title: "" };

beforeAll(async () => {
  video = await makeVideo();
});

afterAll(async () => {
  // Links first (they point at codes), then codes, then videos and clinics. Seats and log entries go with their clinic.
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("making a printed code", () => {
  it("makes one 25-character code for a procedure from a surgeon, live, with a log entry", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    expect(made.created).toBe(true);

    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.code).toMatch(/^[a-z0-9]{25}$/);
    expect(row).toMatchObject({ clinicId: clinic, videoId: video.id, senderUserId: surgeon, senderFallbackName: "Dr. Pat Lee", retiredAt: null });
    expect(row.liveKey).toBe(`${clinic}:${video.id}:${surgeon}`);

    const notes = await prisma.clinicNote.findMany({ where: { clinicId: clinic }, select: { body: true, authorName: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0].authorName).toBe("Ann Admin (clinic admin)");
    expect(notes[0].body).toContain(video.title);
    // The code is a secret, like a key: never in the log.
    expect(notes[0].body).not.toContain(row.code);
  });

  it("hands back the live code when the same surgeon already has one for the procedure, and writes nothing new", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const first = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const again = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    expect(again).toEqual({ id: first.id, created: false });
    expect(await prisma.qrCode.count({ where: { clinicId: clinic } })).toBe(1);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic } })).toBe(1);
  });

  it("gives a different surgeon, or a different procedure, a code of their own", async () => {
    const [one, two] = [surgeonId(), surgeonId()];
    const clinic = await makeClinic([one, two]);
    const other = await makeVideo();
    const a = await createQrCode(clinic, video.id, sender(one), "Ann Admin");
    const b = await createQrCode(clinic, video.id, sender(two), "Ann Admin");
    const c = await createQrCode(clinic, other.id, sender(one), "Ann Admin");
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("ends with exactly one live code when five presses arrive at once", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const results = await Promise.all(Array.from({ length: 5 }, () => createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.qrCode.count({ where: { clinicId: clinic, retiredAt: null } })).toBe(1);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic } })).toBe(1);
  });

  it("tries again with a new code when the random one is already taken", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const first = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const taken = await codeOf(first.id);
    const other = await makeVideo();
    const fresh = `z${randomBytes(12).toString("hex")}`;
    let calls = 0;
    const made = await createQrCode(clinic, other.id, sender(surgeon), "Ann Admin", { makeCode: () => (calls++ === 0 ? taken : fresh) });
    expect(calls).toBe(2);
    expect(await codeOf(made.id)).toBe(fresh);
  });

  it("refuses, and writes nothing, when the clinic may not use the video or the surgeon holds no seat", async () => {
    const surgeon = surgeonId();
    const paused = await makeClinic([surgeon], { status: "PAUSED" });
    const hipOnly = await makeClinic([surgeon], { categories: ["HIP"] });
    const noPlaceholders = await makeClinic([surgeon], { showPlaceholders: false });
    const open = await makeClinic([surgeon]);
    const unpublished = await makeVideo({ isPublished: false });
    const placeholder = await makeVideo({ isPlaceholder: true });

    await expect(createQrCode(paused, video.id, sender(surgeon), "A")).rejects.toMatchObject({ reason: "clinic-closed" });
    await expect(createQrCode(hipOnly, video.id, sender(surgeon), "A")).rejects.toMatchObject({ reason: "not-on-plan" });
    await expect(createQrCode(noPlaceholders, placeholder.id, sender(surgeon), "A")).rejects.toMatchObject({ reason: "placeholder-hidden" });
    await expect(createQrCode(open, unpublished.id, sender(surgeon), "A")).rejects.toBeInstanceOf(ShareRefusedError);
    // Someone with no seat here (a seat at another clinic does not count), and an id that is not a Clerk id.
    await expect(createQrCode(open, video.id, sender(surgeonId()), "A")).rejects.toBeInstanceOf(SenderRefusedError);
    await expect(createQrCode(open, video.id, sender("not-a-user"), "A")).rejects.toBeInstanceOf(SenderRefusedError);
    const otherClinicSurgeon = surgeonId();
    await makeClinic([otherClinicSurgeon]);
    await expect(createQrCode(open, video.id, sender(otherClinicSurgeon), "A")).rejects.toBeInstanceOf(SenderRefusedError);

    expect(await prisma.qrCode.count({ where: { clinicId: { in: [paused, hipOnly, noPlaceholders, open] } } })).toBe(0);
    expect(await prisma.clinicNote.count({ where: { clinicId: { in: [paused, hipOnly, noPlaceholders, open] } } })).toBe(0);
  });
});

describe("retiring and replacing", () => {
  it("retires for good: the code leaves the live list, a second retire changes nothing, and a new code can be made", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const done = await retireQrCode(clinic, made.id, "Ann Admin");
    expect(done.ok).toBe(true);
    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.retiredAt).not.toBeNull();
    expect(row.liveKey).toBeNull();

    expect(await retireQrCode(clinic, made.id, "Ann Admin")).toMatchObject({ ok: false, message: expect.stringContaining("already retired") });
    expect((await listLiveQrCodesForClinic(clinic)).rows).toHaveLength(0);
    expect(await getLiveQrCodeForClinic(clinic, made.id)).toBeNull();

    // A new code for the same pair is a new row with a new code; the old one stays retired.
    const next = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    expect(next.created).toBe(true);
    expect(next.id).not.toBe(made.id);
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id } })).retiredAt).not.toBeNull();
  });

  it("two retires at once retire once and log once", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const results = await Promise.all([retireQrCode(clinic, made.id, "A"), retireQrCode(clinic, made.id, "B")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic, body: { contains: "retired" } } })).toBe(1);
  });

  it("will not retire or replace another clinic's code", async () => {
    const surgeon = surgeonId();
    const mine = await makeClinic([surgeon]);
    const theirs = await makeClinic([surgeon]);
    const made = await createQrCode(theirs, video.id, sender(surgeon), "Ann Admin");
    expect(await retireQrCode(mine, made.id, "Intruder")).toMatchObject({ ok: false });
    expect(await replaceQrCode(mine, made.id, sender(surgeon), "Intruder")).toMatchObject({ ok: false });
    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.retiredAt).toBeNull();
    expect(await prisma.qrCode.count({ where: { clinicId: mine } })).toBe(0);
  });

  it("replaces in one step: the old code retired, a new live one for the same procedure and surgeon", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const old = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const oldCode = await codeOf(old.id);
    const result = await replaceQrCode(clinic, old.id, sender(surgeon), "Ann Admin");
    expect(result.ok).toBe(true);
    const fresh = (result as { id: string }).id;
    expect(fresh).not.toBe(old.id);
    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: fresh } });
    expect(row).toMatchObject({ videoId: video.id, senderUserId: surgeon, retiredAt: null });
    expect(row.code).not.toBe(oldCode);
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: old.id } })).retiredAt).not.toBeNull();
  });

  it("leaves the old code exactly as it was when the new one cannot be made", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const old = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const notesBefore = await prisma.clinicNote.count({ where: { clinicId: clinic } });
    // The category leaves the plan: no new code may be made, so nothing changes.
    await prisma.clinic.update({ where: { id: clinic }, data: { categories: ["HIP"] } });
    const result = await replaceQrCode(clinic, old.id, sender(surgeon), "Ann Admin");
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("left as it was") });
    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.retiredAt).toBeNull();
    expect(row.liveKey).not.toBeNull();
    expect(await prisma.qrCode.count({ where: { clinicId: clinic } })).toBe(1);
    expect(await prisma.clinicNote.count({ where: { clinicId: clinic } })).toBe(notesBefore);
  });
});

describe("the link a patient's Play tap gets", () => {
  it("is a first-play link of its own, 16 characters, from the surgeon by the name chosen for them, with the settings' days", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon], { named: surgeon });
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const visit = key();
    const outcome = await issueShareFromQrCode(await codeOf(made.id), visit);
    expect(outcome).toEqual({ ok: true, code: childShareCode(made.id, visit) });
    const code = (outcome as { code: string }).code;
    expect(code).toMatch(/^[a-z0-9]{16}$/);

    const settings = await getSettings();
    const share = await prisma.share.findUniqueOrThrow({ where: { code } });
    expect(share).toMatchObject({
      clinicId: clinic,
      videoId: video.id,
      qrCodeId: made.id,
      expiryPolicy: "FIRST_PLAY",
      firstPlayedAt: null,
      daysAfterFirstPlay: settings.viewDays,
      senderUserId: surgeon,
      senderName: "Dr. Jane Smith, DO",
    });
  });

  it("carries the tick of the 'for education only' box onto the new link, once: a retry of the same visit writes nothing more", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const qr = await codeOf((await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")).id);
    const visit = key();
    const at = new Date();
    const first = await issueShareFromQrCode(qr, visit, { disclaimerVersion: "2026-10-08", now: at });
    expect(first.ok).toBe(true);
    // The same visit asking again (a dropped connection) finds its link and counts nothing twice.
    expect(await issueShareFromQrCode(qr, visit, { disclaimerVersion: "2026-10-08" })).toEqual(first);
    const share = await prisma.share.findUniqueOrThrow({ where: { code: (first as { code: string }).code } });
    expect(share).toMatchObject({ disclaimerFirstAcceptedAt: at, disclaimerAcceptances: 1, disclaimerVersion: "2026-10-08", viewCount: 0, firstPlayedAt: null });

    // A link made without one (the tests' own calls) has no record.
    const plain = await issueShareFromQrCode(qr, key());
    const bare = await prisma.share.findUniqueOrThrow({ where: { code: (plain as { code: string }).code } });
    expect(bare).toMatchObject({ disclaimerFirstAcceptedAt: null, disclaimerAcceptances: 0, disclaimerVersion: null });
  });

  it("names the surgeon by the name recorded when the code was made, when none was chosen for them", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon, "Dr. Pat Lee"), "Ann Admin");
    const outcome = await issueShareFromQrCode(await codeOf(made.id), key());
    const share = await prisma.share.findUniqueOrThrow({ where: { code: (outcome as { code: string }).code } });
    expect(share.senderName).toBe("Dr. Pat Lee");
  });

  it("gives two visits two links, and the same visit asking again the same link", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const qr = await codeOf((await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")).id);
    const [visitA, visitB] = [key(), key()];
    const a1 = await issueShareFromQrCode(qr, visitA);
    const a2 = await issueShareFromQrCode(qr, visitA);
    const b = await issueShareFromQrCode(qr, visitB);
    expect(a1).toEqual(a2);
    expect(b.ok && a1.ok && b.code !== a1.code).toBe(true);
    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(2);
  });

  it("writes one link when the same visit's five tries arrive at once", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const qr = await codeOf((await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")).id);
    const visit = key();
    const results = await Promise.all(Array.from({ length: 5 }, () => issueShareFromQrCode(qr, visit)));
    expect(new Set(results.map((r) => (r.ok ? r.code : "refused"))).size).toBe(1);
    expect(results[0].ok).toBe(true);
    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(1);
  });

  it("makes nothing when only the page is opened: reading the code writes no link", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const qr = await codeOf((await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")).id);
    const found = await getQrCodeByCode(qr);
    expect(found).toMatchObject({ clinicId: clinic, retiredAt: null });
    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(0);
  });

  it("hands out nothing from a retired code, but a visit that already got its link still gets it back", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const qr = await codeOf(made.id);
    const early = key();
    const first = await issueShareFromQrCode(qr, early);
    await retireQrCode(clinic, made.id, "Ann Admin");

    expect(await issueShareFromQrCode(qr, key())).toEqual({ ok: false, reason: "retired" });
    expect(await issueShareFromQrCode(qr, early)).toEqual(first);
    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(1);
    expect((await getQrCodeByCode(qr))?.retiredAt).not.toBeNull();
  });

  it("hands out nothing, and writes nothing, for a closed clinic, a category off the plan, an unpublished video or a hidden placeholder", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const placeholder = await makeVideo({ isPlaceholder: true });
    const qr = await codeOf((await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin")).id);
    const placeholderQr = await codeOf((await createQrCode(clinic, placeholder.id, sender(surgeon), "Ann Admin")).id);

    await prisma.clinic.update({ where: { id: clinic }, data: { status: "PAUSED" } });
    expect(await issueShareFromQrCode(qr, key())).toEqual({ ok: false, reason: "clinic-closed" });
    await prisma.clinic.update({ where: { id: clinic }, data: { status: "ACTIVE", categories: ["HIP"] } });
    expect(await issueShareFromQrCode(qr, key())).toEqual({ ok: false, reason: "not-on-plan" });
    await prisma.clinic.update({ where: { id: clinic }, data: { categories: ["KNEE"], showPlaceholders: false } });
    expect(await issueShareFromQrCode(placeholderQr, key())).toEqual({ ok: false, reason: "placeholder-hidden" });
    await prisma.video.update({ where: { id: placeholder.id }, data: { isPublished: false } });
    await prisma.clinic.update({ where: { id: clinic }, data: { showPlaceholders: true } });
    expect(await issueShareFromQrCode(placeholderQr, key())).toEqual({ ok: false, reason: "unpublished" });

    expect(await prisma.share.count({ where: { clinicId: clinic } })).toBe(0);
    // And back on the plan, it works again: nothing was spoiled.
    expect((await issueShareFromQrCode(qr, key())).ok).toBe(true);
  });

  it("answers a code nobody has with no-such-code", async () => {
    expect(await issueShareFromQrCode("a".repeat(25), key())).toEqual({ ok: false, reason: "no-such-code" });
  });

  it("keeps working when the surgeon loses their seat, with links that name only the clinic", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon], { named: surgeon });
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    await prisma.seatAllocation.deleteMany({ where: { clinicId: clinic, clerkUserId: surgeon } });

    const outcome = await issueShareFromQrCode(await codeOf(made.id), key());
    const share = await prisma.share.findUniqueOrThrow({ where: { code: (outcome as { code: string }).code } });
    expect(share).toMatchObject({ senderUserId: null, senderName: null, qrCodeId: made.id });

    // The office's list says it needs a look; the patient's page names only the clinic.
    const live = await listLiveQrCodesForClinic(clinic);
    expect(live.rows[0]).toMatchObject({ id: made.id, surgeonSeated: false });
    expect((await getQrCodeByCode(await codeOf(made.id)))?.senderName).toBeNull();
  });

  it("leaves links it already handed out working after the code is retired and the category leaves the plan", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "Ann Admin");
    const outcome = await issueShareFromQrCode(await codeOf(made.id), key());
    const code = (outcome as { code: string }).code;

    await retireQrCode(clinic, made.id, "Ann Admin");
    await prisma.clinic.update({ where: { id: clinic }, data: { categories: ["HIP"] } });

    const share = await getShareByCode(code);
    expect(share && !isExpired(share, new Date())).toBe(true);
    expect(await recordSharePlay(code)).toEqual({ recorded: true, firstPlay: true });
  });
});

describe("the lists", () => {
  it("lists one clinic's live codes only, newest first", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const other = await makeClinic([surgeon]);
    const second = await makeVideo();
    const a = await createQrCode(clinic, video.id, sender(surgeon), "A");
    const b = await createQrCode(clinic, second.id, sender(surgeon), "A");
    await createQrCode(other, video.id, sender(surgeon), "A");
    const retired = await createQrCode(clinic, (await makeVideo()).id, sender(surgeon), "A");
    await retireQrCode(clinic, retired.id, "A");

    const live = await listLiveQrCodesForClinic(clinic);
    expect(live.total).toBe(2);
    expect(live.rows.map((row) => row.id)).toEqual([b.id, a.id]);
    expect(live.rows[0]).toMatchObject({ videoTitle: second.title, surgeonSeated: true, surgeonName: "Dr. Pat Lee", isPublished: true });
  });

  it("counts, for Pulse, the links each code handed out since midnight UTC and in the last 30 days", async () => {
    const surgeon = surgeonId();
    const clinic = await makeClinic([surgeon]);
    const made = await createQrCode(clinic, video.id, sender(surgeon), "A");
    const retired = await createQrCode(clinic, (await makeVideo()).id, sender(surgeon), "A");
    await retireQrCode(clinic, retired.id, "A");

    const now = new Date("2026-10-08T15:00:00.000Z");
    const at = (iso: string) => ({
      code: `t${randomBytes(8).toString("hex")}`,
      clinicId: clinic,
      videoId: video.id,
      qrCodeId: made.id,
      expiresAt: new Date("2027-01-01"),
      createdAt: new Date(iso),
    });
    await prisma.share.createMany({
      data: [
        at("2026-10-08T00:00:00.000Z"), // midnight UTC itself: today
        at("2026-10-08T14:59:00.000Z"), // today
        at("2026-10-07T23:59:59.999Z"), // yesterday, in the 30 days
        at("2026-09-08T15:00:00.000Z"), // exactly 30 days before now: in
        at("2026-09-08T14:59:59.999Z"), // a moment before that: out
      ],
    });

    const report = await listQrCodesForPulse(clinic, now);
    expect(report.total).toBe(2);
    // The live code first, then the retired one.
    expect(report.rows.map((row) => row.id)).toEqual([made.id, retired.id]);
    expect(report.rows[0]).toMatchObject({ issuedToday: 2, issuedRecently: 4, retiredAt: null });
    expect(report.rows[1]).toMatchObject({ issuedToday: 0, issuedRecently: 0 });
    expect(report.rows[1].retiredAt).not.toBeNull();
  });
});
