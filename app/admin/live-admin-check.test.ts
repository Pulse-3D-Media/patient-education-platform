import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CHECK_UNREACHABLE, confirmAdminWithClerk } from "@/lib/clinic";
import { prisma } from "@/lib/db/client";
import { listSeatRows } from "@/lib/db/seats";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { saveClinicBrandingAction, saveClinicNameAction, uploadClinicLogoAction } from "./branding/actions";
import { createQrCodeAction, retireQrCodeAction, replaceQrCodeAction } from "./links/actions";
import { giveSeatAction, removePersonAction, setAdminAction } from "./people/actions";
import { reactivateLinkAction } from "./reactivate/[id]/actions";

/**
 * The live admin check (confirmAdminWithClerk in lib/clinic.ts) before the
 * highest-impact actions: people changes, making, retiring or replacing a
 * printed QR code, the clinic's branding, name and logo, and turning a paused
 * link back on. (Billing's are in
 * app/admin/billing/manage-actions.test.ts and checkout-actions.test.ts.)
 *
 * Clerk is the stand-in, the database is real (the testing branch). The
 * stand-in can freeze the session token (freezeToken), which is how a real
 * Clerk behaves for about a minute after someone is demoted or removed: the
 * token still says "admin" while Clerk itself already says otherwise. And it
 * can stop answering (hangReads), which the five-second limit has to end.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));
// A slow Clerk is waited for the full five seconds, plus a few database round trips.
vi.setConfig({ testTimeout: 30_000 });

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

const PEOPLE_NOT_ADMIN = "Only your clinic's office admins can change this.";
const LINKS_NOT_ADMIN = "Only your clinic's office admins can do this, and only while the clinic is on a plan.";
const REACTIVATE_NOT_ADMIN = "Only your clinic's office admins can turn a link back on.";
const BRANDING_NOT_ADMIN = "Only your clinic's office admins can change the branding.";

/** An open clinic with an owner (admin), a second admin, and a member who holds no seat. */
async function makeClinic() {
  const orgId = `org_test_${id()}`;
  const [owner, admin, member] = [user(), user(), user()];
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest live check ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats: 3, ownerClerkUserId: owner },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(
    orgId,
    "Vitest live check",
    [
      { userId: owner, role: "org:admin" },
      { userId: admin, role: "org:admin" },
      { userId: member, role: "org:member" },
    ],
    owner,
  );
  return { clinicId: clinic.id, orgId, owner, admin, member };
}

/** A form for Confirm on /admin/reactivate, with a made-up id of the right shape. */
function reactivateForm() {
  const form = new FormData();
  form.set("shareId", `cmvitest${id()}`);
  return form;
}

/** One published video, made on first use, for the printed-code tests. */
let videoId = "";
async function publishedVideo() {
  if (!videoId) {
    videoId = (
      await prisma.video.create({
        data: { title: "Vitest live check video", category: "KNEE", videoUrl: "https://example.com/vitest-live.mp4", isPublished: true },
        select: { id: true },
      })
    ).id;
  }
  return videoId;
}

/** A clinic from makeClinic() that may share Knee videos, with its member holding a seat (so a printed code can be from them). */
async function makeClinicForCodes() {
  const made = await makeClinic();
  await prisma.clinic.update({ where: { id: made.clinicId }, data: { categories: ["KNEE"] } });
  await prisma.seatAllocation.create({ data: { clinicId: made.clinicId, clerkUserId: made.member, syncState: "SYNCED" } });
  return { ...made, video: await publishedVideo() };
}

const qrCodesOf = (clinicId: string) => prisma.qrCode.count({ where: { clinicId } });

/** What a clinic's row holds for its branding, and how long its log is, to show nothing was written. */
async function brandingOf(clinicId: string) {
  const row = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true, logoUrl: true, brandColor: true, phone: true } });
  return { ...row, notes: await prisma.clinicNote.count({ where: { clinicId } }) };
}

function brandingForm() {
  const form = new FormData();
  form.set("brandColor", "#7A1F2B");
  form.set("brandFont", "merriweather");
  form.set("brandTheme", "light");
  form.set("phone", "(801) 555-0123");
  return form;
}

function nameForm() {
  const form = new FormData();
  form.set("name", "Renamed by the live check");
  return form;
}

/** A small PNG, known as one by its first bytes. */
function logoForm() {
  const bytes = new Uint8Array(2_000);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = new FormData();
  form.append("logo", new File([bytes], "logo.png", { type: "image/png" }));
  return form;
}

/** Every branding action, each with a fresh form. */
const brandingActions = [
  ["the branding save", () => saveClinicBrandingAction(null, brandingForm())],
  ["the rename", () => saveClinicNameAction(null, nameForm())],
  ["the logo upload", () => uploadClinicLogoAction(null, logoForm())],
] as const;

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.qrCode.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  if (videoId) await prisma.video.deleteMany({ where: { id: videoId } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("confirmAdminWithClerk", () => {
  it("says yes for an admin of the clinic, with their name as Clerk has it now", async () => {
    const { clinicId, orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    const answer = await confirmAdminWithClerk(clinicId);
    expect(answer).toMatchObject({ ok: true, userId: admin });
    expect(answer.ok && answer.name).toMatch(/^Test /);
  });

  it("says no for a member, for someone signed out, and for an admin asking about another clinic", async () => {
    const mine = await makeClinic();
    const theirs = await makeClinic();
    fakeClerk.signIn(mine.member, mine.orgId);
    expect(await confirmAdminWithClerk(mine.clinicId)).toEqual({ ok: false, reason: "not-admin" });
    fakeClerk.signIn(null, null);
    expect(await confirmAdminWithClerk(mine.clinicId)).toEqual({ ok: false, reason: "not-admin" });
    // Asked about THEIR clinic's organization, where this admin is not a member.
    fakeClerk.signIn(mine.admin, mine.orgId);
    expect(await confirmAdminWithClerk(theirs.clinicId)).toEqual({ ok: false, reason: "not-admin" });
  });

  it("says no for an admin demoted, or removed, while their session token still says admin", async () => {
    const { clinicId, orgId, admin, owner } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");
    expect(await confirmAdminWithClerk(clinicId)).toEqual({ ok: false, reason: "not-admin" });

    fakeClerk.signIn(owner, orgId);
    fakeClerk.freezeToken();
    fakeClerk.removeMember(orgId, owner);
    expect(await confirmAdminWithClerk(clinicId)).toEqual({ ok: false, reason: "not-admin" });
  });

  it("gives up after the time limit when Clerk does not answer, and says so instead of hanging", async () => {
    const { clinicId, orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;
    const started = Date.now();
    expect(await confirmAdminWithClerk(clinicId)).toEqual({ ok: false, reason: "unreachable" });
    // The limit is five seconds (CLERK_TIMEOUT_MS); it waited for it and no longer.
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});

describe("people changes", () => {
  it("are refused for an admin demoted within the token window, with nothing written to Clerk or the seats", async () => {
    const { clinicId, orgId, admin, member } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");

    expect((await setAdminAction(member, true)).error).toBe(PEOPLE_NOT_ADMIN);
    expect((await removePersonAction(member)).error).toBe(PEOPLE_NOT_ADMIN);
    expect((await giveSeatAction(member)).error).toBe(PEOPLE_NOT_ADMIN);
    expect(fakeClerk.roleOf(orgId, member)).toBe("org:member");
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("are refused for an admin removed from the clinic within the token window", async () => {
    const { clinicId, orgId, admin, member } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.removeMember(orgId, admin);

    expect((await giveSeatAction(member)).error).toBe(PEOPLE_NOT_ADMIN);
    expect((await setAdminAction(member, true)).error).toBe(PEOPLE_NOT_ADMIN);
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("are answered in plain words when Clerk does not answer, with nothing changed", async () => {
    const { clinicId, orgId, admin, member } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;

    expect((await giveSeatAction(member)).error).toBe(ADMIN_CHECK_UNREACHABLE);
    expect(fakeClerk.writes).toEqual([]);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("still go through for an admin Clerk confirms (the control)", async () => {
    const { clinicId, orgId, admin, member } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    expect((await giveSeatAction(member)).error).toBeUndefined();
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([member]);
  });
});

describe("printed QR codes: Retire and Replace", () => {
  it("are refused for a demoted admin before the code is even looked up", async () => {
    const { orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");
    expect((await retireQrCodeAction(`cmvitest${id()}`)).error).toBe(LINKS_NOT_ADMIN);
    expect((await replaceQrCodeAction(`cmvitest${id()}`)).error).toBe(LINKS_NOT_ADMIN);
  });

  it("are answered in plain words when Clerk does not answer", async () => {
    const { orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;
    expect((await retireQrCodeAction(`cmvitest${id()}`)).error).toBe(ADMIN_CHECK_UNREACHABLE);
  });

  it("reach the code for an admin Clerk confirms (here, a made-up one that is not found)", async () => {
    const { orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    const outcome = await retireQrCodeAction(`cmvitest${id()}`);
    expect(outcome.error).toBeDefined();
    expect(outcome.error).not.toBe(LINKS_NOT_ADMIN);
    expect(outcome.error).not.toBe(ADMIN_CHECK_UNREACHABLE);
  });
});

describe("printed QR codes: making one", () => {
  it("is refused for an admin demoted within the token window, with no code made", async () => {
    const { clinicId, orgId, admin, member, video } = await makeClinicForCodes();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");
    expect(await createQrCodeAction(video, member)).toEqual({ ok: false, error: LINKS_NOT_ADMIN });
    expect(await qrCodesOf(clinicId)).toBe(0);
  });

  it("is refused for an admin removed from the clinic within the token window, with no code made", async () => {
    const { clinicId, orgId, admin, member, video } = await makeClinicForCodes();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.removeMember(orgId, admin);
    expect(await createQrCodeAction(video, member)).toEqual({ ok: false, error: LINKS_NOT_ADMIN });
    expect(await qrCodesOf(clinicId)).toBe(0);
  });

  it("is answered in plain words when Clerk does not answer, with no code made", async () => {
    const { clinicId, orgId, admin, member, video } = await makeClinicForCodes();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;
    expect(await createQrCodeAction(video, member)).toEqual({ ok: false, error: ADMIN_CHECK_UNREACHABLE });
    expect(await qrCodesOf(clinicId)).toBe(0);
  });

  it("still makes the code for an admin Clerk confirms, logged under their name as Clerk has it (the control)", async () => {
    const { clinicId, orgId, admin, member, video } = await makeClinicForCodes();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    expect(await createQrCodeAction(video, member)).toMatchObject({ ok: true, created: true });
    expect(await qrCodesOf(clinicId)).toBe(1);
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { authorName: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0].authorName).toMatch(/^Test /);
  });
});

describe("the clinic's branding, name and logo", () => {
  it.each(brandingActions)("%s is refused for an admin demoted within the token window, with nothing written", async (_label, run) => {
    const { clinicId, orgId, admin } = await makeClinic();
    const before = await brandingOf(clinicId);
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");
    expect(await run()).toEqual({ error: BRANDING_NOT_ADMIN });
    expect(fakeClerk.writes).toEqual([]);
    expect(await brandingOf(clinicId)).toEqual(before);
  });

  it.each(brandingActions)("%s is refused for an admin removed within the token window, with nothing written", async (_label, run) => {
    const { clinicId, orgId, admin } = await makeClinic();
    const before = await brandingOf(clinicId);
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.removeMember(orgId, admin);
    expect(await run()).toEqual({ error: BRANDING_NOT_ADMIN });
    expect(fakeClerk.writes).toEqual([]);
    expect(await brandingOf(clinicId)).toEqual(before);
  });

  it.each(brandingActions)("%s is answered in plain words when Clerk does not answer, with nothing written", async (_label, run) => {
    const { clinicId, orgId, admin } = await makeClinic();
    const before = await brandingOf(clinicId);
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;
    expect(await run()).toEqual({ error: ADMIN_CHECK_UNREACHABLE });
    expect(fakeClerk.writes).toEqual([]);
    expect(await brandingOf(clinicId)).toEqual(before);
  });

  it("all still go through for an admin Clerk confirms, logged under their name as Clerk has it (the control)", async () => {
    const { clinicId, orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    for (const [, run] of brandingActions) expect((await run())?.error).toBeUndefined();
    expect(fakeClerk.writes.map((write) => [write.op, write.failed])).toEqual([
      ["rename", false],
      ["logo", false],
    ]);
    expect(await brandingOf(clinicId)).toMatchObject({
      name: "Renamed by the live check",
      brandColor: "#7a1f2b",
      logoUrl: `https://img.clerk.com/fake-logo-${orgId}`,
    });
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { authorName: true } });
    expect(notes).toHaveLength(3);
    for (const note of notes) expect(note.authorName).toMatch(/^Test .* \(clinic admin\)$/);
  });
});

describe("turning a paused link back on", () => {
  it("is refused for an admin demoted or removed within the token window", async () => {
    const { orgId, admin, owner } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.freezeToken();
    fakeClerk.setRoleOutsideTheApp(orgId, admin, "org:member");
    expect(await reactivateLinkAction(null, reactivateForm())).toEqual({ ok: false, message: REACTIVATE_NOT_ADMIN });

    fakeClerk.signIn(owner, orgId);
    fakeClerk.freezeToken();
    fakeClerk.removeMember(orgId, owner);
    expect(await reactivateLinkAction(null, reactivateForm())).toEqual({ ok: false, message: REACTIVATE_NOT_ADMIN });
  });

  it("is answered in plain words when Clerk does not answer", async () => {
    const { orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    fakeClerk.hangReads = true;
    expect(await reactivateLinkAction(null, reactivateForm())).toEqual({ ok: false, message: ADMIN_CHECK_UNREACHABLE });
  });

  it("reaches the link for an admin Clerk confirms (here, a made-up one that is not found)", async () => {
    const { orgId, admin } = await makeClinic();
    fakeClerk.signIn(admin, orgId);
    const outcome = await reactivateLinkAction(null, reactivateForm());
    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).not.toBe(REACTIVATE_NOT_ADMIN);
    expect(outcome?.message).not.toBe(ADMIN_CHECK_UNREACHABLE);
  });
});
