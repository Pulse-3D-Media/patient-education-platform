import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { GET as qrImage } from "../qr-codes/[id]/image/route";
import { createQrCodeAction, replaceQrCodeAction, retireQrCodeAction } from "./actions";

/**
 * The printed-code actions on /admin/links (make, retire, replace) and the
 * picture download, with Clerk replaced by the in-memory stand-in and the
 * database real. What these prove:
 *
 *   - only an admin of an open clinic can make, retire or replace a code, or
 *     download one; anyone else is refused and nothing changes;
 *   - the clinic comes from the signed-in admin, never the browser: another
 *     clinic's code id finds nothing, and its code is left as it was;
 *   - the surgeon is checked with Clerk and must hold a seat here;
 *   - pressing twice makes one code;
 *   - Replace keeps the code's own surgeon, and is refused (the old code left
 *     working) once that surgeon has left the clinic;
 *   - the picture is a PNG to save, never cached, named TEST-ONLY away from
 *     production, and gone once the code is retired.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tag = () => randomBytes(6).toString("hex");
const orgA = `org_test_${tag()}`;
const orgB = `org_test_${tag()}`;
const orgPending = `org_test_${tag()}`;
const adminA = `user_qradmina${tag()}`;
const surgeonA = `user_qrsurgeona${tag()}`;
const memberA = `user_qrmembera${tag()}`;
const adminB = `user_qradminb${tag()}`;
const adminPending = `user_qradminp${tag()}`;

const createdClinicIds: string[] = [];
let clinicA = "";
let clinicB = "";
let video = "";

async function makeClinic(name: string, clerkOrgId: string, status: "ACTIVE" | "PENDING", seated: string[]) {
  const clinic = await prisma.clinic.create({
    data: {
      name,
      clerkOrgId,
      status,
      categories: ["KNEE"],
      surgeonSeats: 10,
      seatAllocations: { create: seated.map((clerkUserId) => ({ clerkUserId, syncState: "SYNCED" as const })) },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeAll(async () => {
  fakeClerk.reset();
  fakeClerk.addOrg(orgA, "Vitest QR clinic A", [
    { userId: adminA, firstName: "Pat", lastName: "Lee", role: "org:admin" },
    { userId: surgeonA, firstName: "Jane", lastName: "Smith", role: "org:member" },
    { userId: memberA, firstName: "Sam", lastName: "Doe", role: "org:member" },
  ]);
  fakeClerk.addOrg(orgB, "Vitest QR clinic B", [{ userId: adminB, firstName: "Bo", lastName: "Other", role: "org:admin" }]);
  fakeClerk.addOrg(orgPending, "Vitest QR clinic (pending)", [{ userId: adminPending, firstName: "Pen", lastName: "Ding", role: "org:admin" }]);
  clinicA = await makeClinic("Vitest QR clinic A", orgA, "ACTIVE", [adminA, surgeonA]);
  clinicB = await makeClinic("Vitest QR clinic B", orgB, "ACTIVE", [adminB]);
  await makeClinic("Vitest QR clinic (pending)", orgPending, "PENDING", [adminPending]);
  video = (
    await prisma.video.create({
      data: { title: "Vitest QR action video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    })
  ).id;
});

beforeEach(() => fakeClerk.signIn(null, null));
afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.qrCode.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: video }] } });
  await prisma.video.deleteMany({ where: { id: video } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  fakeClerk.reset();
  await prisma.$disconnect();
});

const codesIn = (clinicId: string) => prisma.qrCode.count({ where: { clinicId } });

describe("making a printed code", () => {
  it("refuses a member, an admin of a clinic that is not open, and someone signed out, and makes nothing", async () => {
    const before = await codesIn(clinicA);
    fakeClerk.signIn(memberA, orgA);
    expect(await createQrCodeAction(video, surgeonA)).toMatchObject({ ok: false, error: expect.stringContaining("office admins") });
    fakeClerk.signIn(adminPending, orgPending);
    expect(await createQrCodeAction(video, adminPending)).toMatchObject({ ok: false });
    fakeClerk.signIn(null, null);
    expect(await createQrCodeAction(video, surgeonA)).toMatchObject({ ok: false });
    expect(await codesIn(clinicA)).toBe(before);
  });

  it("refuses a surgeon from another clinic, or no pick at all, and makes nothing", async () => {
    fakeClerk.signIn(adminA, orgA);
    const before = await codesIn(clinicA);
    expect(await createQrCodeAction(video, adminB)).toMatchObject({ ok: false });
    expect(await createQrCodeAction(video, "")).toMatchObject({ ok: false });
    expect(await createQrCodeAction(video, memberA)).toMatchObject({ ok: false, error: expect.stringContaining("seat") });
    expect(await codesIn(clinicA)).toBe(before);
  });

  it("makes one code in the admin's own clinic, and pressing again shows the same one", async () => {
    fakeClerk.signIn(adminA, orgA);
    const first = await createQrCodeAction(video, surgeonA);
    expect(first).toMatchObject({ ok: true, created: true });
    const again = await createQrCodeAction(video, surgeonA);
    expect(again).toEqual({ ok: true, id: (first as { id: string }).id, created: false });
    const row = await prisma.qrCode.findUniqueOrThrow({ where: { id: (first as { id: string }).id } });
    expect(row).toMatchObject({ clinicId: clinicA, senderUserId: surgeonA, senderFallbackName: "Dr. Jane Smith" });
  });
});

describe("retiring, replacing and downloading", () => {
  async function liveCode() {
    fakeClerk.signIn(adminA, orgA);
    // Retire whatever is live for the pair first, so each test starts with a fresh code.
    const existing = await prisma.qrCode.findMany({ where: { clinicId: clinicA, retiredAt: null }, select: { id: true } });
    for (const { id } of existing) await retireQrCodeAction(id);
    const made = await createQrCodeAction(video, surgeonA);
    return (made as { id: string }).id;
  }

  it("will not let another clinic's admin retire, replace or download the code, and leaves it working", async () => {
    const id = await liveCode();
    fakeClerk.signIn(adminB, orgB);
    expect(await retireQrCodeAction(id)).toMatchObject({ error: expect.any(String) });
    expect(await replaceQrCodeAction(id)).toMatchObject({ error: expect.any(String) });
    const picture = await qrImage(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);
    expect(picture.status).toBe(404);
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id } })).retiredAt).toBeNull();
    expect(await codesIn(clinicB)).toBe(0);
  });

  it("will not let a member retire or download it", async () => {
    const id = await liveCode();
    fakeClerk.signIn(memberA, orgA);
    expect(await retireQrCodeAction(id)).toMatchObject({ error: expect.stringContaining("office admins") });
    const picture = await qrImage(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);
    expect(picture.status).toBe(404);
  });

  it("lets the admin download the picture: a PNG to save, never cached, marked TEST-ONLY away from production", async () => {
    const id = await liveCode();
    vi.stubEnv("NODE_ENV", "development");
    const picture = await qrImage(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("Content-Type")).toBe("image/png");
    expect(picture.headers.get("Cache-Control")).toBe("private, no-store");
    expect(picture.headers.get("Content-Disposition")).toMatch(/^attachment; filename="TEST-ONLY-vitest-qr-action-video-printed-qr-[a-z0-9]{6}\.png"$/);
    const bytes = new Uint8Array(await picture.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("names the file plainly on production", async () => {
    const id = await liveCode();
    vi.stubEnv("VERCEL_ENV", "production");
    const picture = await qrImage(new Request("http://x/x", { headers: { host: "anything.example.com" } }), { params: Promise.resolve({ id }) } as never);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("Content-Disposition")).not.toContain("TEST-ONLY");
  });

  it("retires the admin's own code, after which it cannot be downloaded or retired again", async () => {
    const id = await liveCode();
    expect(await retireQrCodeAction(id)).toMatchObject({ message: expect.stringContaining("Retired") });
    expect(await retireQrCodeAction(id)).toMatchObject({ error: expect.stringContaining("already retired") });
    const picture = await qrImage(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);
    expect(picture.status).toBe(404);
  });

  it("replaces it with a new code from the same surgeon", async () => {
    const id = await liveCode();
    expect(await replaceQrCodeAction(id)).toMatchObject({ message: expect.stringContaining("Replaced") });
    const live = await prisma.qrCode.findMany({ where: { clinicId: clinicA, retiredAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(id);
    expect(live[0].senderUserId).toBe(surgeonA);
  });

  it("refuses to replace once the surgeon has left the clinic, and leaves the old code working", async () => {
    const id = await liveCode();
    fakeClerk.removeMember(orgA, surgeonA);
    try {
      expect(await replaceQrCodeAction(id)).toMatchObject({ error: expect.stringContaining("left as it was") });
      expect((await prisma.qrCode.findUniqueOrThrow({ where: { id } })).retiredAt).toBeNull();
    } finally {
      fakeClerk.addMember(orgA, { userId: surgeonA, firstName: "Jane", lastName: "Smith", role: "org:member" });
    }
  });
});
