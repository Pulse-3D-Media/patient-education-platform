import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_MAX_BYTES } from "@/lib/clinic-identity";
import { prisma } from "@/lib/db/client";
import { saveClinicNameAction, uploadClinicLogoAction } from "./actions";

/**
 * The two Server Actions behind the "Name and logo" section of
 * /admin/branding, with Clerk replaced by a stand-in and the database real
 * (the Neon testing branch).
 *
 * What these prove:
 *   - signed out, a member, and an admin of a clinic that is not open:
 *     refused, Clerk never asked, nothing written;
 *   - an admin: the clinic's OWN Clerk organization renamed, or given the
 *     logo (with the kind read from the bytes), our copy updated, and one
 *     log entry under their name;
 *   - an admin of ANOTHER clinic: a clinic id or organization id forged into
 *     the form is never read, so the change lands on their own clinic;
 *   - a file of the wrong kind (whatever it is called or claims to be), an
 *     empty one and one too large: refused before Clerk is asked;
 *   - Clerk refusing or not answering: a plain sentence, nothing written,
 *     and the failure itself never on the screen or in the log.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const updateOrganization = vi.fn();
const updateOrganizationLogo = vi.fn();

const CLERK_LOGO = "https://img.clerk.com/vitest-uploaded-logo";

function signInAs(orgId: string | null, role: "admin" | "member", userId: string | null = "user_vitest") {
  vi.mocked(auth).mockResolvedValue({
    userId,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ firstName: "Jane", lastName: "Smith", emailAddresses: [] }) },
    organizations: { updateOrganization, updateOrganizationLogo },
  } as never);
  updateOrganization.mockResolvedValue({});
  updateOrganizationLogo.mockResolvedValue({ hasImage: true, imageUrl: CLERK_LOGO });
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A file the way the browser sends it: a name, a claimed type, and the bytes. */
function fileForm(bytes: Uint8Array, name = "logo.png", type = "image/png", extra: Record<string, string> = {}) {
  const data = new FormData();
  data.append("logo", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  return data;
}

function png(size = 2_000) {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEAD);
  return bytes;
}

function nameForm(name: string, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.append("name", name);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  return data;
}

const createdClinicIds: string[] = [];
const orgMine = fakeOrgId();
const orgTheirs = fakeOrgId();
const orgPending = fakeOrgId();
let mine = "";
let theirs = "";

const MINE_NAME = "Vitest identity clinic (mine)";
const THEIRS_NAME = "Vitest identity clinic (theirs)";
const PULSE_LOGO = "https://example.com/pulse-set-logo.png";

async function makeClinic(name: string, clerkOrgId: string, status: "ACTIVE" | "PENDING") {
  const clinic = await prisma.clinic.create({ data: { name, clerkOrgId, status, logoUrl: PULSE_LOGO }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function rowOf(clinicId: string) {
  return prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true, logoUrl: true } });
}

async function logOf(clinicId: string) {
  return prisma.clinicNote.findMany({ where: { clinicId }, select: { authorName: true, kind: true, body: true } });
}

beforeAll(async () => {
  mine = await makeClinic(MINE_NAME, orgMine, "ACTIVE");
  theirs = await makeClinic(THEIRS_NAME, orgTheirs, "ACTIVE");
  await makeClinic("Vitest identity clinic (pending)", orgPending, "PENDING");
});

beforeEach(async () => {
  vi.resetAllMocks();
  await prisma.clinic.update({ where: { id: mine }, data: { name: MINE_NAME, logoUrl: PULSE_LOGO } });
  await prisma.clinic.update({ where: { id: theirs }, data: { name: THEIRS_NAME, logoUrl: PULSE_LOGO } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("who may change the clinic's name and logo", () => {
  it("refuses someone signed out, a member, and an admin of a clinic that is not open, without asking Clerk", async () => {
    for (const [org, role, userId, words] of [
      [null, "member", null, "office admins"],
      [orgMine, "member", "user_vitest", "office admins"],
      [orgPending, "admin", "user_vitest", "not open"],
    ] as const) {
      signInAs(org, role, userId);
      expect(await saveClinicNameAction(null, nameForm("A new name"))).toMatchObject({ error: expect.stringContaining(words) });
      expect(await uploadClinicLogoAction(null, fileForm(png()))).toMatchObject({ error: expect.stringContaining(words) });
    }

    expect(updateOrganization).not.toHaveBeenCalled();
    expect(updateOrganizationLogo).not.toHaveBeenCalled();
    expect(await rowOf(mine)).toEqual({ name: MINE_NAME, logoUrl: PULSE_LOGO });
    expect(await prisma.clinicNote.count({ where: { clinicId: { in: createdClinicIds } } })).toBe(0);
  });
});

describe("renaming the clinic", () => {
  it("renames the clinic's own organization in Clerk, then our copy, with one log entry under the admin's name", async () => {
    signInAs(orgMine, "admin");

    expect(await saveClinicNameAction(null, nameForm("  Wasatch   Knee Center "))).toMatchObject({ ok: expect.stringContaining("Saved") });

    expect(updateOrganization).toHaveBeenCalledTimes(1);
    expect(updateOrganization).toHaveBeenCalledWith(orgMine, { name: "Wasatch Knee Center" });
    expect((await rowOf(mine)).name).toBe("Wasatch Knee Center");
    expect(await logOf(mine)).toEqual([
      { authorName: "Jane Smith (clinic admin)", kind: "STATUS", body: `Details changed: name changed from "${MINE_NAME}" to "Wasatch Knee Center".` },
    ]);
  });

  it("the same name again changes nothing and writes no second entry", async () => {
    signInAs(orgMine, "admin");
    await saveClinicNameAction(null, nameForm("Wasatch Knee Center"));

    expect(await saveClinicNameAction(null, nameForm("Wasatch Knee Center"))).toMatchObject({ ok: expect.stringContaining("already") });
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(1);
  });

  it("an admin of another clinic cannot rename this one: a clinic id or organization id in the form is never read", async () => {
    signInAs(orgTheirs, "admin");

    await saveClinicNameAction(null, nameForm("Renamed by them", { clinicId: mine, id: mine, clerkOrgId: orgMine, orgId: orgMine }));

    expect(updateOrganization).toHaveBeenCalledWith(orgTheirs, { name: "Renamed by them" });
    expect(updateOrganization).not.toHaveBeenCalledWith(orgMine, expect.anything());
    expect((await rowOf(mine)).name).toBe(MINE_NAME);
    expect((await rowOf(theirs)).name).toBe("Renamed by them");
  });

  it("refuses an empty name, one too long, one on two lines and two names at once, without asking Clerk", async () => {
    signInAs(orgMine, "admin");
    const two = nameForm("One");
    two.append("name", "Two");

    for (const data of [nameForm("   "), nameForm("x".repeat(101)), nameForm("Two\nlines"), two]) {
      expect(await saveClinicNameAction(null, data)).toHaveProperty("error");
    }
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(await rowOf(mine)).toEqual({ name: MINE_NAME, logoUrl: PULSE_LOGO });
  });

  it("when Clerk refuses, says so in plain words and changes nothing", async () => {
    signInAs(orgMine, "admin");
    updateOrganization.mockRejectedValue(Object.assign(new Error("Forbidden: sk_test_secretvalue at api.clerk.com"), { status: 403 }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await saveClinicNameAction(null, nameForm("A new name"));

    expect(result).toEqual({ error: "We could not reach the sign-in service to rename your clinic, so nothing was changed. Try again in a moment." });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("sk_test_secretvalue");
    expect(await rowOf(mine)).toEqual({ name: MINE_NAME, logoUrl: PULSE_LOGO });
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(0);
    logged.mockRestore();
  });
});

describe("uploading a logo", () => {
  it("sends the picture to the clinic's own organization as what its bytes say it is, and records Clerk's address with one log entry", async () => {
    signInAs(orgMine, "admin");

    // Called "photo.bin" and claimed as plain text: the bytes are a PNG, so it is sent as one.
    const result = await uploadClinicLogoAction(null, fileForm(png(), "photo.bin", "text/plain"));

    expect(result).toMatchObject({ ok: expect.stringContaining("Uploaded") });
    expect(updateOrganizationLogo).toHaveBeenCalledTimes(1);
    const [orgId, params] = updateOrganizationLogo.mock.calls[0];
    expect(orgId).toBe(orgMine);
    expect(params.uploaderUserId).toBe("user_vitest");
    expect(params.file.type).toBe("image/png");
    expect(params.file.name).toBe("logo.png");
    expect(params.file.size).toBe(2_000);

    expect((await rowOf(mine)).logoUrl).toBe(CLERK_LOGO);
    expect(await logOf(mine)).toEqual([
      { authorName: "Jane Smith (clinic admin)", kind: "STATUS", body: "Branding changed: a new logo was uploaded, replacing the old one." },
    ]);
  });

  it("an admin of another clinic cannot change this one's logo: ids in the form are never read", async () => {
    signInAs(orgTheirs, "admin");

    await uploadClinicLogoAction(null, fileForm(png(), "logo.png", "image/png", { clinicId: mine, clerkOrgId: orgMine }));

    expect(updateOrganizationLogo.mock.calls[0][0]).toBe(orgTheirs);
    expect((await rowOf(mine)).logoUrl).toBe(PULSE_LOGO);
    expect((await rowOf(theirs)).logoUrl).toBe(CLERK_LOGO);
  });

  it("refuses a file that is not a PNG, JPG or WebP, whatever it is called, without asking Clerk", async () => {
    signInAs(orgMine, "admin");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const words = new TextEncoder().encode("not a picture at all");

    expect(await uploadClinicLogoAction(null, fileForm(svg, "logo.svg", "image/svg+xml"))).toEqual({ error: expect.stringContaining("not a PNG, JPG or WebP") });
    expect(await uploadClinicLogoAction(null, fileForm(words, "logo.png", "image/png"))).toEqual({ error: expect.stringContaining("not a PNG, JPG or WebP") });
    expect(updateOrganizationLogo).not.toHaveBeenCalled();
    expect((await rowOf(mine)).logoUrl).toBe(PULSE_LOGO);
  });

  it("refuses a file over 1 MB, an empty file, no file and a logo sent as text, without asking Clerk", async () => {
    signInAs(orgMine, "admin");
    const asText = new FormData();
    asText.append("logo", "https://evil.example/tracker.png");

    expect(await uploadClinicLogoAction(null, fileForm(png(LOGO_MAX_BYTES + 1)))).toEqual({ error: expect.stringContaining("too big") });
    expect(await uploadClinicLogoAction(null, fileForm(new Uint8Array()))).toEqual({ error: "Choose a picture first." });
    expect(await uploadClinicLogoAction(null, new FormData())).toEqual({ error: "Choose a picture first." });
    expect(await uploadClinicLogoAction(null, asText)).toEqual({ error: "Choose a picture first." });
    expect(updateOrganizationLogo).not.toHaveBeenCalled();
    expect((await rowOf(mine)).logoUrl).toBe(PULSE_LOGO);
  });

  it("takes a picture of exactly 1 MB", async () => {
    signInAs(orgMine, "admin");
    expect(await uploadClinicLogoAction(null, fileForm(png(LOGO_MAX_BYTES)))).toMatchObject({ ok: expect.stringContaining("Uploaded") });
  });

  it("when Clerk refuses or does not answer, says so in plain words and changes nothing", async () => {
    signInAs(orgMine, "admin");
    updateOrganizationLogo.mockRejectedValue(new Error("Unprocessable: postgres://user:pw@10.0.0.12/db"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await uploadClinicLogoAction(null, fileForm(png()));

    expect(result).toEqual({ error: "We could not upload the logo just now, so nothing was changed. Try again in a moment." });
    expect(JSON.stringify(result)).not.toContain("10.0.0.12");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("10.0.0.12");
    expect(await rowOf(mine)).toEqual({ name: MINE_NAME, logoUrl: PULSE_LOGO });
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(0);
    logged.mockRestore();
  });

  it("when Clerk says the organization still has no picture afterwards, says so and changes nothing", async () => {
    signInAs(orgMine, "admin");
    updateOrganizationLogo.mockResolvedValue({ hasImage: false, imageUrl: "https://img.clerk.com/initials" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await uploadClinicLogoAction(null, fileForm(png()))).toMatchObject({ error: expect.stringContaining("did not take") });
    expect((await rowOf(mine)).logoUrl).toBe(PULSE_LOGO);
    logged.mockRestore();
  });
});
