import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import PulseClinicReportPage from "./clinics/[id]/page";
import PulseReportsPage from "./page";

/**
 * The two report pages, drawn on the server the way Next.js draws them, with
 * Clerk replaced by the in-memory stand-in and the real testing database.
 * Proves who may open them, that they draw their numbers and definitions,
 * and that no link code reaches the page. Clicking is the browser check.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 30_000 });

const STAFF = "user_vitest_pulse_staff";
const TOKEN = `zzreportpage${randomBytes(4).toString("hex")}`;
const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinicId = "";
const codes: string[] = [];

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const reportsPage = (search: Record<string, string> = {}) => PulseReportsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(search) } as never);
const clinicPage = (id: string, search: Record<string, string> = {}) =>
  PulseClinicReportPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) } as Props as never);

beforeAll(async () => {
  const video = await prisma.video.create({
    data: { title: `${TOKEN} Knee`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
  const clinic = await prisma.clinic.create({ data: { name: `${TOKEN} clinic`, status: "ACTIVE", surgeonSeats: 2, categories: ["KNEE"] }, select: { id: true } });
  clinicId = clinic.id;
  createdClinicIds.push(clinic.id);
  for (const [viewCount, senderName] of [
    [2, "Dr. Report Test, MD"],
    [0, "Dr. Report Test, MD"],
    [0, null],
  ] as const) {
    const code = `vp${randomBytes(5).toString("hex")}`;
    codes.push(code);
    await prisma.share.create({
      data: { code, clinicId, videoId: video.id, expiresAt: new Date(Date.now() + 86_400_000), viewCount, senderName, senderUserId: senderName ? `user_${TOKEN}` : null },
    });
  }
});

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

describe("who may open the reports", () => {
  it("is not-found for anyone who is not Pulse staff, a clinic's own admin included, signed in or not", async () => {
    const admin = `user_${TOKEN}_admin`;
    fakeClerk.addOrg(`org_${TOKEN}`, "Vitest report clinic", [{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, `org_${TOKEN}`);
    await expect(reportsPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(clinicPage(clinicId)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    fakeClerk.signIn(null, null);
    await expect(reportsPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is not-found for a clinic id that does not exist, even for staff", async () => {
    fakeClerk.signIn(STAFF, null);
    await expect(clinicPage("no-such-clinic")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});

describe("the platform page", () => {
  it("draws the totals, the tables and the definitions, says what the period is, and holds no link code", async () => {
    fakeClerk.signIn(STAFF, null);
    const html = renderToStaticMarkup(await reportsPage());
    for (const words of ["Links made in this period", "Clinics and seats right now", "By category", "By procedure", "By clinic", "What the numbers mean"]) {
      expect(html).toContain(words);
    }
    expect(html).toContain("Links made in the last 30 days, with the plays and renewals recorded on them so far.");
    expect(html).toContain("A link is not a person");
    expect(html).toContain("Clinics do not see this page.");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/pulse/reports?days=90"');
    for (const code of codes) expect(html).not.toContain(code);
  });

  it("covers 90 days when asked, and treats junk as 30", async () => {
    fakeClerk.signIn(STAFF, null);
    expect(renderToStaticMarkup(await reportsPage({ days: "90" }))).toContain("Links made in the last 90 days");
    expect(renderToStaticMarkup(await reportsPage({ days: "9999" }))).toContain("Links made in the last 30 days");
  });
});

describe("one clinic's page", () => {
  it("draws the clinic's numbers by surgeon and by procedure, with the placeholder mark, and holds no link code", async () => {
    fakeClerk.signIn(STAFF, null);
    const html = renderToStaticMarkup(await clinicPage(clinicId));
    expect(html).toContain(`${TOKEN} clinic`);
    expect(html).toContain("0 of 2 in use");
    expect(html).toContain("Knee");
    expect(html).toContain("Dr. Report Test, MD");
    expect(html).toContain("No surgeon recorded (older links)");
    expect(html).toContain(`${TOKEN} Knee`);
    expect(html).toContain("Placeholder");
    // Three links made, one played: 33%.
    expect(html).toContain("33% of links made");
    for (const code of codes) expect(html).not.toContain(code);
  });
});
