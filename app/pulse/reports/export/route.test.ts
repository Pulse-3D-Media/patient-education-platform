import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import * as reports from "@/lib/db/reports";
import * as pulse from "@/lib/pulse";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { GET } from "./route";

/**
 * The Download CSV route, against the real testing database with Clerk
 * replaced by the in-memory stand-in. Its links sit in March 2025, a month
 * no other test makes links in, so the clinic's own tables can be checked
 * exactly for a custom range.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 30_000 });

const STAFF = "user_vitest_pulse_staff";
const TOKEN = `zzexport${randomBytes(4).toString("hex")}`;
const SURGEON = `user_${TOKEN}`;
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const codes: string[] = [];
let clinicId = "";

const MARCH = "from=2025-03-01&to=2025-03-31";
const get = (query: string) => GET(new Request(`http://localhost/pulse/reports/export?${query}`));

beforeAll(async () => {
  const video = await prisma.video.create({ data: { title: `${TOKEN} Knee`, category: "KNEE", videoUrl: "https://example.com/v.mp4" }, select: { id: true } });
  createdVideoIds.push(video.id);
  const clinic = await prisma.clinic.create({ data: { name: `${TOKEN}, "Ortho"`, status: "ACTIVE", surgeonSeats: 2 }, select: { id: true } });
  clinicId = clinic.id;
  createdClinicIds.push(clinic.id);
  const link = (createdAt: string, viewCount: number) => {
    const code = `ve${randomBytes(5).toString("hex")}`;
    codes.push(code);
    return { code, clinicId, videoId: video.id, createdAt: new Date(createdAt), expiresAt: new Date(Date.now() + 86_400_000), viewCount, senderUserId: SURGEON, senderName: "Dr. Jane Smith, DO" };
  };
  await prisma.share.createMany({
    data: [
      link("2025-03-01T07:00:00Z", 2), // just after midnight on Mar 1 in Utah: in
      link("2025-03-15T12:00:00Z", 0),
      link("2025-04-01T05:59:00Z", 1), // 11:59 PM on Mar 31 in Utah: in
      link("2025-04-01T06:00:00Z", 9), // midnight starting Apr 1 in Utah: out
      link("2025-03-01T06:59:00Z", 9), // 11:59 PM on Feb 28 in Utah: out
    ],
  });
});

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

describe("who may download", () => {
  it("is Pulse staff only: a clinic's own admin and a signed-out visitor get a plain 404 and no file", async () => {
    const admin = `user_${TOKEN}_admin`;
    fakeClerk.addOrg(`org_${TOKEN}`, "Vitest export clinic", [{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, `org_${TOKEN}`);
    let response = await get(`table=surgeons&clinic=${clinicId}&${MARCH}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found.");

    fakeClerk.signIn(null, null);
    response = await get("table=clinics");
    expect(response.status).toBe(404);
  });

  it("says sign-in could not be checked, and gives no file, when Clerk does not answer", async () => {
    vi.spyOn(pulse, "isPulseStaff").mockRejectedValueOnce(new Error("Clerk is down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await get("table=clinics");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("could not reach sign-in");
  });
});

describe("a download", () => {
  it("is one clinic's surgeons for exactly the Utah days asked for, as an attachment that is never cached, with no code and no Clerk id", async () => {
    fakeClerk.signIn(STAFF, null);
    const response = await get(`table=surgeons&clinic=${clinicId}&${MARCH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="pulse-report-${TOKEN}-ortho-surgeons-2025-03-01-to-2025-03-31.csv"`);
    const text = await response.text();
    expect(text.replace(/^﻿/, "").trimEnd().split("\r\n")).toEqual([
      "Surgeon,Links made,Played,Played rate (%),Play starts,Renewal requests,Renewals",
      '"Dr. Jane Smith, DO",3,2,67,3,0,0',
    ]);
    expect(text).not.toContain(SURGEON);
    for (const code of codes) expect(text).not.toContain(code);
  });

  it("is one clinic's procedures, or the whole platform's clinics with this clinic on it", async () => {
    fakeClerk.signIn(STAFF, null);
    const procedures = await (await get(`table=procedures&clinic=${clinicId}&${MARCH}`)).text();
    expect(procedures).toContain(`${TOKEN} Knee,Knee,No,3,2,67,3,0,0`);

    const clinics = await (await get(`table=clinics&${MARCH}`)).text();
    expect(clinics).toContain(`"${TOKEN}, ""Ortho""",Active,No,0,0,2,3,2,67,3,0,0`);
    const categories = await get(`table=categories&days=90`);
    expect(categories.status).toBe(200);
    expect(categories.headers.get("Content-Disposition")).toMatch(/filename="pulse-report-categories-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it("refuses, in words and with no file, a table it does not know, a range it cannot read, and a table and clinic that do not go together", async () => {
    fakeClerk.signIn(STAFF, null);
    const cases: [string, number, string][] = [
      ["table=shares", 400, "That table cannot be downloaded."],
      ["table=clinics&from=2026-09-30&to=2026-09-01", 400, "The start date is after the end date. Showing the last 30 days instead."],
      ["table=surgeons", 400, "Choose a clinic for its surgeons."],
      [`table=clinics&clinic=${clinicId}`, 400, "That table is for the whole platform, not one clinic."],
      ["table=surgeons&clinic=no-such-clinic", 404, "Not found."],
    ];
    for (const [query, status, words] of cases) {
      const response = await get(query);
      expect([response.status, await response.text()]).toEqual([status, words]);
      expect(response.headers.get("Content-Disposition")).toBeNull();
    }
  });

  it("says the file could not be made, logging only the kind of failure, when the database fails", async () => {
    fakeClerk.signIn(STAFF, null);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(reports, "listCategoryReportRows").mockRejectedValueOnce(new Error("postgresql://user:secret@db.example/neondb refused"));
    const response = await get("table=categories");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("The file could not be made just now. Try again in a moment.");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });
});
