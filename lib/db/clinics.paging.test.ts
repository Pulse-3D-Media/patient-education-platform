import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { PULSE_CLINICS_PAGE_SIZE, listClinicsForPulse } from "./clinics";

/**
 * The clinics table on /pulse, a page at a time, against the real test
 * database. The testing branch holds other tests' clinics too, so every
 * check here searches for a word only these clinics carry and counts within
 * that. Everything made here is deleted by id afterwards.
 */

/** A word no other clinic's name contains. */
const TOKEN = `zzpaging${randomBytes(4).toString("hex")}`;
/** A full page's worth of clinics that never made a link; with the four named ones below, the list runs onto a second page. */
const QUIET = PULSE_CLINICS_PAGE_SIZE;

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let busyOld = "";
let busyNew = "";
let paused = "";
let percent = "";

const DAY = 24 * 60 * 60 * 1000;

async function makeClinic(name: string, data: { status?: "ACTIVE" | "PAUSED"; createdAt?: Date } = {}) {
  const clinic = await prisma.clinic.create({ data: { name, ...data }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  const video = await prisma.video.create({
    data: { title: "Vitest paging video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4" },
    select: { id: true },
  });
  createdVideoIds.push(video.id);

  // Fifty clinics that never made a link, written in one insert, each a minute older than the last.
  const base = Date.now() - 30 * DAY;
  await prisma.clinic.createMany({
    data: Array.from({ length: QUIET }, (_, i) => ({ name: `${TOKEN} quiet ${String(i).padStart(2, "0")}`, createdAt: new Date(base - i * 60_000) })),
  });
  const quiet = await prisma.clinic.findMany({ where: { name: { startsWith: `${TOKEN} quiet` } }, select: { id: true } });
  createdClinicIds.push(...quiet.map((clinic) => clinic.id));

  // Two clinics that have made links (the older clinic made the newer link), and one paused clinic.
  busyOld = await makeClinic(`${TOKEN} busy old`, { status: "ACTIVE", createdAt: new Date(base - 90 * DAY) });
  busyNew = await makeClinic(`${TOKEN} busy new`, { status: "ACTIVE", createdAt: new Date(base - 80 * DAY) });
  paused = await makeClinic(`${TOKEN} paused`, { status: "PAUSED", createdAt: new Date(base - 70 * DAY) });
  // A name with the characters a search pattern treats specially.
  percent = await makeClinic(`${TOKEN} 50%_off`, { createdAt: new Date(base - 60 * DAY) });

  const link = (clinicId: string, createdAt: Date) => ({
    code: `vt${randomBytes(4).toString("hex")}`,
    clinicId,
    videoId: video.id,
    expiresAt: new Date(Date.now() + DAY),
    createdAt,
  });
  await prisma.share.createMany({
    data: [link(busyOld, new Date(Date.now() - 1 * DAY)), link(busyOld, new Date(Date.now() - 40 * DAY)), link(busyNew, new Date(Date.now() - 5 * DAY))],
  });
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

describe("listClinicsForPulse, a page at a time", () => {
  it("reads one page, not the whole list, and says how many there are in all", async () => {
    const first = await listClinicsForPulse({ query: TOKEN });
    expect(first.total).toBe(QUIET + 4);
    expect(first.page).toBe(1);
    expect(first.rows).toHaveLength(PULSE_CLINICS_PAGE_SIZE);

    const second = await listClinicsForPulse({ query: TOKEN, page: 2 });
    expect(second.total).toBe(QUIET + 4);
    expect(second.rows).toHaveLength(4);

    // Every clinic is on exactly one of the two pages.
    const seen = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(seen).size).toBe(QUIET + 4);
    expect([...seen].sort()).toEqual([...createdClinicIds].sort());
  });

  it("sorts across pages: newest link first, then clinics that never made one, newest of those first", async () => {
    const first = await listClinicsForPulse({ query: TOKEN });
    // The older clinic made the more recent link, so it leads.
    expect(first.rows[0].id).toBe(busyOld);
    expect(first.rows[1].id).toBe(busyNew);
    expect(first.rows[0]).toMatchObject({ recentLinks: 1, seatsInUse: 0, hasOwner: false });
    expect(first.rows[0].lastLinkAt).toBeInstanceOf(Date);
    // Then the never-linked ones by when they were made: the fifty quiet ones are newer than the paused and the percent clinic.
    expect(first.rows[2].name).toBe(`${TOKEN} quiet 00`);
    expect(first.rows[2].lastLinkAt).toBeNull();
    expect(first.rows.at(-1)?.name).toBe(`${TOKEN} quiet 47`);

    const second = await listClinicsForPulse({ query: TOKEN, page: 2 });
    expect(second.rows.map((row) => row.name)).toEqual([`${TOKEN} quiet 48`, `${TOKEN} quiet 49`, `${TOKEN} 50%_off`, `${TOKEN} paused`]);
  });

  it("a page past the end lands on the last page, and a page before the start on the first", async () => {
    const far = await listClinicsForPulse({ query: TOKEN, page: 99 });
    expect(far.page).toBe(2);
    expect(far.rows).toHaveLength(4);

    const before = await listClinicsForPulse({ query: TOKEN, page: 0 });
    expect(before.page).toBe(1);
    expect(before.rows).toHaveLength(PULSE_CLINICS_PAGE_SIZE);
  });

  it("filters by status in the database, with the count to match", async () => {
    const result = await listClinicsForPulse({ query: TOKEN, status: "PAUSED" });
    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([paused]);

    const active = await listClinicsForPulse({ query: TOKEN, status: "ACTIVE" });
    expect(active.rows.map((row) => row.id)).toEqual([busyOld, busyNew]);
  });

  it("searches any part of the name in any case, and reads % and _ as themselves", async () => {
    expect((await listClinicsForPulse({ query: `${TOKEN.toUpperCase()} BUSY` })).rows.map((row) => row.id)).toEqual([busyOld, busyNew]);
    expect((await listClinicsForPulse({ query: `${TOKEN} 50%_off` })).rows.map((row) => row.id)).toEqual([percent]);
    // If % were read as "anything", this would match every clinic made here.
    expect((await listClinicsForPulse({ query: `${TOKEN} %` })).total).toBe(0);
    expect((await listClinicsForPulse({ query: `${TOKEN} _aused` })).total).toBe(0);
  });

  it("answers an empty first page when nothing matches", async () => {
    expect(await listClinicsForPulse({ query: `${TOKEN} nobody` })).toEqual({ rows: [], total: 0, page: 1 });
  });

  it("with no search, still reads no more than one page", async () => {
    const all = await listClinicsForPulse();
    expect(all.rows.length).toBeLessThanOrEqual(PULSE_CLINICS_PAGE_SIZE);
    expect(all.total).toBeGreaterThanOrEqual(QUIET + 4);
  });
});
