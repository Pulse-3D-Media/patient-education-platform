import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/db/settings";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import PulseClinicsPage from "./page";

/**
 * The "Printed QR codes flagged today" list at the top of /pulse (Prompt M),
 * drawn the way Next.js draws the page, with Clerk replaced by the stand-in
 * and the real testing database. Proves the list names a code that reached
 * the flag today, and that only Pulse staff can see it: a clinic's own admin
 * gets not-found for the whole page, as before.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 60_000 });

const STAFF = "user_vitest_pulse_flag_staff";
const TOKEN = `zzflagged${randomBytes(4).toString("hex")}`;
let clinicId = "";
let videoId = "";

const page = () => PulseClinicsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never);

beforeAll(async () => {
  const flagAt = (await getSettings()).qrDailyFlag;
  videoId = (
    await prisma.video.create({
      data: { title: `${TOKEN} Knee`, category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
  clinicId = (await prisma.clinic.create({ data: { name: `${TOKEN} clinic`, status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } })).id;
  const qr = await prisma.qrCode.create({
    data: { code: randomBytes(16).toString("hex").slice(0, 25), clinicId, videoId, senderUserId: `user_${TOKEN}` },
    select: { id: true },
  });
  // Exactly the flag's worth of links today.
  await prisma.share.createMany({
    data: Array.from({ length: flagAt }, () => ({
      code: `t${randomBytes(8).toString("hex")}`,
      clinicId,
      videoId,
      qrCodeId: qr.id,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    })),
  });
});

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addStaff(STAFF);
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { clinicId } });
  await prisma.qrCode.deleteMany({ where: { clinicId } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.video.deleteMany({ where: { id: videoId } });
  await prisma.$disconnect();
});

describe("the flagged printed codes on /pulse", () => {
  it("lists a code that reached the flag today, with its clinic linked to the clinic's Links tab", async () => {
    fakeClerk.signIn(STAFF, null);
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("Printed QR codes flagged today");
    expect(html).toContain(`${TOKEN} clinic`);
    expect(html).toContain(`${TOKEN} Knee`);
    expect(html).toContain(`/pulse/clinics/${clinicId}#links`);
  });

  it("is not shown to anyone else: the whole page is not-found for a clinic's admin, signed in or not", async () => {
    const admin = `user_${TOKEN}_admin`;
    fakeClerk.addOrg(`org_${TOKEN}`, "Vitest flagged clinic", [{ userId: admin, role: "org:admin" }]);
    fakeClerk.signIn(admin, `org_${TOKEN}`);
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    fakeClerk.signIn(null, null);
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
