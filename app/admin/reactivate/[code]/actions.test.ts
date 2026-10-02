import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import * as shares from "@/lib/db/shares";
import { addDays } from "@/lib/expiry";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { reactivateLinkAction } from "./actions";

/**
 * The Server Action behind Confirm on /admin/reactivate/<code>, with Clerk
 * replaced by the in-memory stand-in and the database real. What these
 * prove: only a signed-in office admin of an OPEN clinic can turn a link
 * back on; a member, a signed-out visitor, an admin of a clinic that has
 * not paid, and an admin of another clinic are refused with a plain
 * sentence and nothing written; a forged code finds nothing; a real press
 * renews the link once and logs it under the admin's name; a second press
 * is told the link is already working; and a failure on the server is
 * answered in plain words, never thrown at the page.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/shares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shares")>();
  return { ...actual, renewShareForClinic: vi.fn(actual.renewShareForClinic) };
});

const tag = () => randomBytes(6).toString("hex");
const orgA = `org_test_${tag()}`;
const orgB = `org_test_${tag()}`;
const orgPending = `org_test_${tag()}`;
const adminA = `user_admina${tag()}`;
const memberA = `user_membera${tag()}`;
const adminB = `user_adminb${tag()}`;
const adminPending = `user_adminp${tag()}`;

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
let clinicA = "";
let videoId = "";

/** A link made and played 20 days ago with ten days after the first play, so it paused 10 days ago. */
async function makePausedLink(clinicId: string) {
  const madeAt = addDays(new Date(), -20);
  const share = await shares.createShare(clinicId, videoId, { now: madeAt });
  expect(await shares.recordSharePlay(share.code, madeAt)).toEqual({ recorded: true, firstPlay: true });
  return share.code;
}

function form(code: string) {
  const data = new FormData();
  data.append("code", code);
  return data;
}

beforeAll(async () => {
  fakeClerk.reset();
  fakeClerk.addOrg(orgA, "Vitest reactivate clinic A", [
    { userId: adminA, firstName: "Pat", lastName: "Lee", role: "org:admin" },
    { userId: memberA, firstName: "Sam", lastName: "Member", role: "org:member" },
  ]);
  fakeClerk.addOrg(orgB, "Vitest reactivate clinic B", [{ userId: adminB, firstName: "Bo", lastName: "Other", role: "org:admin" }]);
  fakeClerk.addOrg(orgPending, "Vitest reactivate clinic P", [{ userId: adminPending, firstName: "Pen", lastName: "Ding", role: "org:admin" }]);

  const video = await prisma.video.create({
    data: { title: "Vitest reactivate video", category: "KNEE", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  videoId = video.id;
  createdVideoIds.push(videoId);

  for (const [name, clerkOrgId, status] of [
    ["Vitest reactivate clinic A", orgA, "ACTIVE"],
    ["Vitest reactivate clinic B", orgB, "ACTIVE"],
    ["Vitest reactivate clinic P", orgPending, "PENDING"],
  ] as const) {
    const clinic = await prisma.clinic.create({ data: { name, clerkOrgId, status, categories: ["KNEE"], viewDaysOverride: 10 }, select: { id: true } });
    createdClinicIds.push(clinic.id);
  }
  clinicA = createdClinicIds[0];
});

afterEach(() => {
  vi.mocked(shares.renewShareForClinic).mockClear();
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.share.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

async function renewalsOf(code: string) {
  return (await prisma.share.findUniqueOrThrow({ where: { code }, select: { renewalsUsed: true } })).renewalsUsed;
}

describe("who may press Confirm", () => {
  it("refuses a signed-out visitor and a member, writing nothing and never reaching the database", async () => {
    const code = await makePausedLink(clinicA);

    fakeClerk.signIn(null, null);
    expect(await reactivateLinkAction(null, form(code))).toEqual({ ok: false, message: "Only your clinic's office admins can turn a link back on." });

    fakeClerk.signIn(memberA, orgA);
    expect(await reactivateLinkAction(null, form(code))).toEqual({ ok: false, message: "Only your clinic's office admins can turn a link back on." });

    expect(vi.mocked(shares.renewShareForClinic)).not.toHaveBeenCalled();
    expect(await renewalsOf(code)).toBe(0);
  });

  it("refuses an admin of a clinic that is not open, with a sentence pointing at Billing", async () => {
    fakeClerk.signIn(adminPending, orgPending);
    const result = await reactivateLinkAction(null, form("k7m2xq"));
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("not open");
    expect(vi.mocked(shares.renewShareForClinic)).not.toHaveBeenCalled();
  });

  it("finds no link for another clinic's admin, and writes nothing", async () => {
    const code = await makePausedLink(clinicA);
    fakeClerk.signIn(adminB, orgB);
    expect(await reactivateLinkAction(null, form(code))).toEqual({ ok: false, message: "We couldn't find that link for your clinic." });
    expect(await renewalsOf(code)).toBe(0);
  });

  it("refuses a forged code before the database is asked", async () => {
    fakeClerk.signIn(adminA, orgA);
    for (const junk of ["", "K7M2XQ", "a".repeat(21), "k7m2xq; drop", "../k7m2xq"]) {
      expect(await reactivateLinkAction(null, form(junk))).toEqual({ ok: false, message: "We couldn't find that link for your clinic." });
    }
    expect(await reactivateLinkAction(null, new FormData())).toEqual({ ok: false, message: "We couldn't find that link for your clinic." });
    expect(vi.mocked(shares.renewShareForClinic)).not.toHaveBeenCalled();
  });
});

describe("an admin of the clinic", () => {
  it("turns the link back on once, under their name in the clinic log, and a second press is told it is already working", async () => {
    const code = await makePausedLink(clinicA);
    fakeClerk.signIn(adminA, orgA);

    const first = await reactivateLinkAction(null, form(code));
    expect(first?.ok).toBe(true);
    expect(first?.message).toContain("Done. The link works again until");
    expect(await renewalsOf(code)).toBe(1);
    const note = await prisma.clinicNote.findFirst({ where: { clinicId: clinicA, body: { contains: `Link ${code}` } } });
    expect(note?.authorName).toBe("Pat Lee (clinic admin)");

    const second = await reactivateLinkAction(null, form(code));
    expect(second?.ok).toBe(false);
    expect(second?.message).toContain("already working");
    expect(await renewalsOf(code)).toBe(1);
  });

  it("is answered in plain words when the server fails, with the detail logged there and never the code", async () => {
    const code = await makePausedLink(clinicA);
    fakeClerk.signIn(adminA, orgA);
    vi.mocked(shares.renewShareForClinic).mockRejectedValueOnce(new Error("the database went away"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await reactivateLinkAction(null, form(code))).toEqual({ ok: false, message: "That could not be done just now. Nothing was changed. Try again in a moment." });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain(code);
    log.mockRestore();
  });
});
