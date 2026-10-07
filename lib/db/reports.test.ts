import { randomBytes } from "node:crypto";
import type { ClinicStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES } from "../categories";
import { clinicIsOpen } from "../clinic-status";
import { isValidRenewalCount } from "../expiry";
import { seatSourceOf } from "../reports";
import { prisma } from "./client";
import { getClinicReport, getPlatformReport, listClinicReportRows, REPORT_PROCEDURE_LIMIT, type PlatformReport, type ReportWindow } from "./reports";
import { getSettings } from "./settings";

/**
 * The Pulse reports against the real test database.
 *
 * The testing branch holds every other test's links and clinics, so the
 * link numbers here are taken over windows in the 1990s, when no other test
 * makes a link: inside such a window every link is one of ours, and every
 * count can be checked exactly. The platform's "right now" numbers (clinics
 * by status, open seats, links waiting) cover everything, so those are
 * checked as the difference this file's clinics make, read at one fixed
 * moment before and after they are written. Test files run one at a time,
 * so nothing else writes in between. Everything made here is deleted by id.
 */

const TOKEN = `zzreport${randomBytes(4).toString("hex")}`;
/** The fixed "now" every read in this file uses. */
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

/** The window the main fixtures sit in: March 1999. */
const MARCH: ReportWindow = { since: at("1999-03-01T00:00:00Z"), until: at("1999-04-01T00:00:00Z") };

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

let knee = "";
let hip = "";
let hidden = "";
let clinicA = "";
let clinicB = "";
let clinicC = "";
let clinicD = "";
let clinicE = "";
let clinicF = "";
let clinicG = "";
let before: PlatformReport;
let allowed = 0;

async function makeVideo(title: string, category: "KNEE" | "HIP", extra: { isPlaceholder?: boolean; isPublished?: boolean } = {}) {
  const video = await prisma.video.create({
    data: { title: `${TOKEN} ${title}`, category, videoUrl: "https://example.com/vitest.mp4", isPublished: true, ...extra },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  return video.id;
}

async function makeClinic(
  name: string,
  data: { status: ClinicStatus; managedByPulse?: boolean; staffAccess?: "OPEN" | "PAUSED"; graceEndsAt?: Date; surgeonSeats?: number; categories?: ("KNEE" | "HIP")[] },
) {
  const clinic = await prisma.clinic.create({ data: { name: `${TOKEN} ${name}`, ...data }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

type LinkData = {
  createdAt: Date;
  videoId?: string;
  viewCount?: number;
  renewalRequests?: number;
  renewalsUsed?: number;
  senderUserId?: string | null;
  senderName?: string | null;
  expiryPolicy?: "FIXED" | "FIRST_PLAY";
  firstPlayedAt?: Date | null;
  expiresAt?: Date;
  daysAfterFirstPlay?: number | null;
  renewalRequestedAt?: Date | null;
};

function link(clinicId: string, data: LinkData) {
  return {
    code: `vr${randomBytes(5).toString("hex")}`,
    clinicId,
    videoId: data.videoId ?? knee,
    expiresAt: data.expiresAt ?? new Date(NOW.getTime() + DAY),
    ...data,
  };
}

beforeAll(async () => {
  const settings = await getSettings();
  allowed = isValidRenewalCount(settings.maxRenewals) ? settings.maxRenewals : 0;
  // The platform's "right now" numbers before any of this file's rows exist.
  before = await getPlatformReport(MARCH, NOW);

  knee = await makeVideo("Knee video", "KNEE");
  hip = await makeVideo("Hip placeholder", "HIP", { isPlaceholder: true });
  hidden = await makeVideo("Hidden video", "KNEE", { isPublished: false });

  // A: open, paying by card, 3 seats on its plan, 2 people and 1 invitation holding seats.
  clinicA = await makeClinic("A card", { status: "ACTIVE", surgeonSeats: 3, categories: ["KNEE", "HIP"] });
  await prisma.seatAllocation.createMany({
    data: [
      { clinicId: clinicA, clerkUserId: `user_${TOKEN}1`, syncState: "SYNCED" },
      { clinicId: clinicA, clerkUserId: `user_${TOKEN}2`, syncState: "SYNCED" },
    ],
  });
  await prisma.seatInvitation.create({ data: { clinicId: clinicA } });
  // B: open, managed by Pulse. C: past due, still in grace (open, card). F: opened by hand (open, Pulse).
  clinicB = await makeClinic("B managed", { status: "ACTIVE", managedByPulse: true, surgeonSeats: 5 });
  clinicC = await makeClinic("C grace", { status: "PAST_DUE", graceEndsAt: new Date(NOW.getTime() + DAY), surgeonSeats: 2 });
  clinicF = await makeClinic("F by hand", { status: "ACTIVE", staffAccess: "OPEN", surgeonSeats: 4 });
  // D: past due, grace over. E: past due with no deadline. G: paused by hand. All closed.
  clinicD = await makeClinic("D grace over", { status: "PAST_DUE", graceEndsAt: new Date(NOW.getTime() - 1), surgeonSeats: 7 });
  clinicE = await makeClinic("E no deadline", { status: "PAST_DUE", surgeonSeats: 7 });
  clinicG = await makeClinic("G paused", { status: "PAUSED", staffAccess: "PAUSED", surgeonSeats: 7 });

  await prisma.share.createMany({
    data: [
      // In March 1999. The first is made at the very start of the window, which counts.
      link(clinicA, { createdAt: MARCH.since, viewCount: 3, renewalRequests: 2, renewalsUsed: 1, senderUserId: `user_${TOKEN}1`, senderName: "Dr. One" }),
      link(clinicA, { createdAt: at("1999-03-10T00:00:00Z"), senderUserId: `user_${TOKEN}1`, senderName: "Dr. One, MD" }),
      link(clinicA, { createdAt: at("1999-03-11T00:00:00Z"), videoId: hip, viewCount: 1, senderUserId: `user_${TOKEN}2`, senderName: "Dr. Two" }),
      link(clinicA, { createdAt: at("1999-03-12T00:00:00Z"), senderUserId: null, senderName: null }),
      link(clinicB, { createdAt: at("1999-03-20T00:00:00Z"), videoId: hip, viewCount: 2 }),
      // Just outside it: a moment before, and exactly at the end (which does not count).
      link(clinicA, { createdAt: new Date(MARCH.since.getTime() - 1), viewCount: 5, renewalRequests: 4, renewalsUsed: 2 }),
      link(clinicA, { createdAt: MARCH.until, viewCount: 9 }),
      // Paused links a patient asked about, long ago. Only the first is waiting: the second's video is not published, the
      // third is still working, the fourth has no request.
      link(clinicA, {
        createdAt: at("1998-12-01T00:00:00Z"),
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: at("1998-12-02T00:00:00Z"),
        expiresAt: at("1998-12-12T00:00:00Z"),
        daysAfterFirstPlay: 10,
        renewalRequestedAt: at("1998-12-13T00:00:00Z"),
        viewCount: 1,
      }),
      link(clinicA, {
        createdAt: at("1998-12-01T00:00:00Z"),
        videoId: hidden,
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: at("1998-12-02T00:00:00Z"),
        expiresAt: at("1998-12-12T00:00:00Z"),
        daysAfterFirstPlay: 10,
        renewalRequestedAt: at("1998-12-13T00:00:00Z"),
      }),
      link(clinicA, {
        createdAt: at("1998-12-01T00:00:00Z"),
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: at("1998-12-02T00:00:00Z"),
        expiresAt: new Date(NOW.getTime() + DAY),
        daysAfterFirstPlay: 10,
        renewalRequestedAt: at("1998-12-13T00:00:00Z"),
      }),
      link(clinicA, {
        createdAt: at("1998-12-01T00:00:00Z"),
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: at("1998-12-02T00:00:00Z"),
        expiresAt: at("1998-12-12T00:00:00Z"),
        daysAfterFirstPlay: 10,
      }),
    ],
  });
}, 60_000);

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
}, 60_000);

describe("the platform report", () => {
  it("counts exactly the links made in the window: the start counts, the end does not", async () => {
    const report = await getPlatformReport(MARCH, NOW);
    expect(report.links).toEqual({ made: 5, played: 3, playStarts: 6, renewalRequests: 2, renewals: 1 });
  });

  it("lists every category in screen order, with zeros where nothing was made", async () => {
    const report = await getPlatformReport(MARCH, NOW);
    expect(report.categories.find((row) => row.category === "KNEE")).toEqual({ category: "KNEE", made: 3, played: 1, playStarts: 3, renewalRequests: 2, renewals: 1 });
    expect(report.categories.find((row) => row.category === "HIP")).toEqual({ category: "HIP", made: 2, played: 2, playStarts: 3, renewalRequests: 0, renewals: 0 });
    expect(report.categories.find((row) => row.category === "SPINE")).toEqual({ category: "SPINE", made: 0, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 });
    expect(report.categories.map((row) => row.category)).toEqual(CATEGORIES.map((category) => category.value));
  });

  it("lists the procedures most links first, with the placeholder mark", async () => {
    const report = await getPlatformReport(MARCH, NOW);
    expect(report.proceduresCapped).toBe(false);
    expect(report.procedures).toEqual([
      { videoId: knee, title: `${TOKEN} Knee video`, category: "KNEE", isPlaceholder: false, made: 3, played: 1, playStarts: 3, renewalRequests: 2, renewals: 1 },
      { videoId: hip, title: `${TOKEN} Hip placeholder`, category: "HIP", isPlaceholder: true, made: 2, played: 2, playStarts: 3, renewalRequests: 0, renewals: 0 },
    ]);
  });

  it("an empty window is all zeros, not a failure", async () => {
    const report = await getPlatformReport({ since: at("1990-01-01T00:00:00Z"), until: at("1990-02-01T00:00:00Z") }, NOW);
    expect(report.links).toEqual({ made: 0, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 });
    expect(report.procedures).toEqual([]);
    expect(report.categories.every((row) => row.made === 0)).toBe(true);
  });

  it("counts clinics by status, and only OPEN clinics' seats, split by who provides them, agreeing with clinicIsOpen and seatSourceOf", async () => {
    const after = await getPlatformReport(MARCH, NOW);
    const delta = (status: ClinicStatus) => after.clinicsByStatus[status] - before.clinicsByStatus[status];
    expect([delta("ACTIVE"), delta("PAST_DUE"), delta("PAUSED"), delta("PENDING"), delta("CANCELED")]).toEqual([3, 3, 1, 0, 0]);

    // Worked out from the app's own two rules, clinic by clinic, rather than written down by hand.
    const mine = await prisma.clinic.findMany({
      where: { id: { in: createdClinicIds } },
      select: { status: true, graceEndsAt: true, managedByPulse: true, staffAccess: true, surgeonSeats: true, _count: { select: { seatAllocations: true, seatInvitations: true } } },
    });
    const expected = { card: { clinics: 0, seatsOnPlans: 0, seatsInUse: 0 }, pulse: { clinics: 0, seatsOnPlans: 0, seatsInUse: 0 } };
    for (const clinic of mine) {
      if (!clinicIsOpen(clinic, NOW)) continue;
      const totals = expected[seatSourceOf(clinic)];
      totals.clinics += 1;
      totals.seatsOnPlans += clinic.surgeonSeats;
      totals.seatsInUse += clinic._count.seatAllocations + clinic._count.seatInvitations;
    }
    // And, written down, what those rules say: A and C pay by card; B and F are Pulse's; D, E and G are closed.
    expect(expected).toEqual({ card: { clinics: 2, seatsOnPlans: 5, seatsInUse: 3 }, pulse: { clinics: 2, seatsOnPlans: 9, seatsInUse: 0 } });

    for (const source of ["card", "pulse"] as const) {
      expect({
        clinics: after.openSeats[source].clinics - before.openSeats[source].clinics,
        seatsOnPlans: after.openSeats[source].seatsOnPlans - before.openSeats[source].seatsOnPlans,
        seatsInUse: after.openSeats[source].seatsInUse - before.openSeats[source].seatsInUse,
      }).toEqual(expected[source]);
    }
  });

  it("counts a paused link waiting for its clinic, and not one whose video is hidden, still working, or never asked about", async () => {
    const after = await getPlatformReport(MARCH, NOW);
    expect(after.waitingNow - before.waitingNow).toBe(allowed > 0 ? 1 : 0);
  });
});

describe("one clinic's report", () => {
  it("counts only that clinic's links, by surgeon and by procedure", async () => {
    const report = await getClinicReport(clinicA, MARCH, NOW);
    expect(report).not.toBeNull();
    if (!report) return;
    expect(report.clinic).toMatchObject({ id: clinicA, status: "ACTIVE", open: true, categories: ["KNEE", "HIP"], surgeonSeats: 3, seatsInUse: 3 });
    expect(report.links).toEqual({ made: 4, played: 2, playStarts: 4, renewalRequests: 2, renewals: 1 });
    expect(report.waitingNow).toBe(allowed > 0 ? 1 : 0);
    expect(report.surgeonsCapped).toBe(false);
    // Dr. One's name is the one on their newest link in the window.
    expect(report.surgeons).toEqual([
      { userId: `user_${TOKEN}1`, name: "Dr. One, MD", made: 2, played: 1, playStarts: 3, renewalRequests: 2, renewals: 1 },
      { userId: `user_${TOKEN}2`, name: "Dr. Two", made: 1, played: 1, playStarts: 1, renewalRequests: 0, renewals: 0 },
      { userId: null, name: null, made: 1, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 },
    ]);
    expect(report.procedures.map((row) => [row.videoId, row.made, row.played])).toEqual([
      [knee, 3, 1],
      [hip, 1, 1],
    ]);
  });

  it("never counts another clinic's links: B sees only its own one", async () => {
    const report = await getClinicReport(clinicB, MARCH, NOW);
    expect(report?.links).toEqual({ made: 1, played: 1, playStarts: 2, renewalRequests: 0, renewals: 0 });
    expect(report?.surgeons).toEqual([{ userId: null, name: null, made: 1, played: 1, playStarts: 2, renewalRequests: 0, renewals: 0 }]);
    expect(report?.waitingNow).toBe(0);
  });

  it("says whether the clinic is open with the app's own rule", async () => {
    for (const [id, open] of [
      [clinicC, true],
      [clinicD, false],
      [clinicE, false],
      [clinicF, true],
      [clinicG, false],
    ] as const) {
      expect((await getClinicReport(id, MARCH, NOW))?.clinic.open).toBe(open);
    }
  });

  it("is null for a clinic id that does not exist", async () => {
    expect(await getClinicReport("no-such-clinic", MARCH, NOW)).toBeNull();
  });
});

describe("the clinic table", () => {
  it("puts the clinics that made the most links first, a page at a time, and says how many clinics there are", async () => {
    const total = await prisma.clinic.count();
    const first = await listClinicReportRows(MARCH, 1, 2);
    expect(first.total).toBe(total);
    expect(first.page).toBe(1);
    expect(first.rows.map((row) => [row.id, row.made])).toEqual([
      [clinicA, 4],
      [clinicB, 1],
    ]);
    expect(first.rows[0]).toMatchObject({ status: "ACTIVE", managedByPulse: false, staffAccess: null, categoryCount: 2, surgeonSeats: 3, seatsInUse: 3, played: 2, playStarts: 4 });
    expect(first.rows[1]).toMatchObject({ managedByPulse: true });

    // Every other clinic made nothing in 1999.
    const second = await listClinicReportRows(MARCH, 2, 2);
    expect(second.rows).toHaveLength(Math.min(2, total - 2));
    expect(second.rows.every((row) => row.made === 0)).toBe(true);
  });

  it("pulls a page past the end back to the last page", async () => {
    const total = await prisma.clinic.count();
    const far = await listClinicReportRows(MARCH, 10_000, 50);
    expect(far.page).toBe(Math.max(1, Math.ceil(total / 50)));
    expect(far.rows.length).toBeLessThanOrEqual(50);
  });
});

describe("with a realistic amount of history", () => {
  const YEAR_START = at("1997-01-01T00:00:00Z").getTime();
  const JUNE: ReportWindow = { since: at("1997-06-01T00:00:00Z"), until: at("1997-07-01T00:00:00Z") };
  let busy = "";
  const made: { createdAt: Date; viewCount: number; renewalRequests: number }[] = [];

  beforeAll(async () => {
    busy = await makeClinic("busy", { status: "ACTIVE", surgeonSeats: 10 });
    // 730 links over 1997, one every twelve hours, with a pattern of plays and requests.
    for (let i = 0; i < 730; i++) made.push({ createdAt: new Date(YEAR_START + i * 12 * 60 * 60 * 1000), viewCount: i % 3, renewalRequests: i % 5 === 0 ? 1 : 0 });
    await prisma.share.createMany({ data: made.map((row) => link(busy, row)) });
  }, 60_000);

  it("counts a 30-day window of a year's links exactly", async () => {
    const inJune = made.filter((row) => row.createdAt >= JUNE.since && row.createdAt < JUNE.until);
    const report = await getClinicReport(busy, JUNE, NOW);
    expect(report?.links).toEqual({
      made: inJune.length,
      played: inJune.filter((row) => row.viewCount > 0).length,
      playStarts: inJune.reduce((sum, row) => sum + row.viewCount, 0),
      renewalRequests: inJune.reduce((sum, row) => sum + row.renewalRequests, 0),
      renewals: 0,
    });
    expect(inJune.length).toBe(60);
  });

  it("cuts the procedure list at its limit and says so", { timeout: 60_000 }, async () => {
    // More procedures than the list shows, each with one link in a window of its own.
    const window: ReportWindow = { since: at("1996-01-01T00:00:00Z"), until: at("1996-02-01T00:00:00Z") };
    await prisma.video.createMany({
      data: Array.from({ length: REPORT_PROCEDURE_LIMIT + 1 }, (_, i) => ({ title: `${TOKEN} many ${String(i).padStart(3, "0")}`, category: "KNEE" as const })),
    });
    const many = await prisma.video.findMany({ where: { title: { startsWith: `${TOKEN} many` } }, select: { id: true } });
    createdVideoIds.push(...many.map((video) => video.id));
    await prisma.share.createMany({ data: many.map((video) => link(busy, { createdAt: at("1996-01-15T00:00:00Z"), videoId: video.id })) });

    const report = await getPlatformReport(window, NOW);
    expect(report.procedures).toHaveLength(REPORT_PROCEDURE_LIMIT);
    expect(report.proceduresCapped).toBe(true);
    expect(report.links.made).toBe(REPORT_PROCEDURE_LIMIT + 1);
    // The category total is not cut: it counts every link.
    expect(report.categories.find((row) => row.category === "KNEE")?.made).toBe(REPORT_PROCEDURE_LIMIT + 1);
  });
});
