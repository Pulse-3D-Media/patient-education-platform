import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import PulseClinicPage from "./page";

/**
 * The Links tab of a clinic's /pulse page, drawn on the server with Clerk
 * replaced by the in-memory stand-in and the real testing database: the
 * "Disclaimer accepted" column shows when the "for education only" box was
 * first ticked on each link and how many ticks were recorded, or "Not
 * ticked". Pulse staff only: anyone else gets not-found, so nothing about the
 * box reaches the clinic side. Clicking the tab is the browser check.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/pulse",
  useSearchParams: () => new URLSearchParams(),
}));
vi.setConfig({ testTimeout: 30_000 });

const STAFF = "user_vitest_pulse_staff_links";
const TOKEN = `zzlinkstab${randomBytes(4).toString("hex")}`;
let clinicId = "";
let videoId = "";

const page = (id: string) => PulseClinicPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never);

beforeAll(async () => {
  videoId = (
    await prisma.video.create({ data: { title: `${TOKEN} Knee`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true }, select: { id: true } })
  ).id;
  clinicId = (await prisma.clinic.create({ data: { name: `${TOKEN} clinic`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } })).id;
  const soon = new Date(Date.now() + 86_400_000);
  await prisma.share.create({
    data: {
      code: `ta${randomBytes(4).toString("hex")}`,
      clinicId,
      videoId,
      expiresAt: soon,
      disclaimerFirstAcceptedAt: new Date("2026-10-09T20:14:00.000Z"),
      disclaimerAcceptances: 3,
      disclaimerVersion: "2026-10-08",
    },
  });
  await prisma.share.create({ data: { code: `tb${randomBytes(4).toString("hex")}`, clinicId, videoId, expiresAt: soon } });
});

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId } });
  await prisma.clinicNote.deleteMany({ where: { clinicId } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.video.deleteMany({ where: { id: videoId } });
  await prisma.$disconnect();
});

describe("the Links tab's 'Disclaimer accepted' column", () => {
  it("shows the first tick in Utah time and the count for a link that has one, and 'Not ticked' for one that has none", async () => {
    fakeClerk.signIn(STAFF, null);
    const html = renderToStaticMarkup(await page(clinicId));
    expect(html).toContain("Disclaimer accepted");
    expect(html).toContain("Oct 9, 2026, 2:14 PM");
    expect(html).toContain("3 ticks");
    expect(html).toContain("wording of 2026-10-08");
    expect(html).toContain("Not ticked");
    expect(html).toContain("not people");
  });

  it("is not-found for a clinic's own admin: the clinic side never sees it", async () => {
    const admin = `user_${TOKEN}_admin`;
    fakeClerk.addOrg(`org_${TOKEN}`, "Vitest links clinic", [{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, `org_${TOKEN}`);
    await expect(page(clinicId)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
