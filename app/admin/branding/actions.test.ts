import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import * as clinics from "@/lib/db/clinics";
import { saveClinicBrandingAction } from "./actions";

/**
 * The Server Action behind /admin/branding, with Clerk replaced by a
 * stand-in and the database real (the Neon testing branch).
 *
 * What these prove, at the permission boundary:
 *   - signed out, and a member: refused, nothing written;
 *   - an admin: saved, tidied, and logged under their name, marked as a
 *     clinic admin;
 *   - an admin of ANOTHER clinic: a clinic id forged into the form is never
 *     read, so their save lands on their own clinic and not the target;
 *   - an admin of a clinic that is not open: refused.
 *
 * And at the edge: bad values are refused whole, a logo address in the form
 * is never read (only Pulse staff set one), and an unexpected failure gives
 * a plain sentence, not the exception.
 *
 * The clinic never comes from the form: it comes from the signed-in user's
 * organization, which is what the stand-in plays.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// revalidatePath only works inside a real request; here it just needs to not throw.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// The real write, except in the one test that makes it fail.
vi.mock("@/lib/db/clinics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/clinics")>();
  return { ...actual, updateClinicBranding: vi.fn(actual.updateClinicBranding) };
});

const realClinics = await vi.importActual<typeof import("@/lib/db/clinics")>("@/lib/db/clinics");

/** Pretend Clerk says this person is signed in to this organization, as an admin or a member, called Jane Smith. */
function signInAs(orgId: string | null, role: "admin" | "member", userId: string | null = "user_vitest") {
  vi.mocked(auth).mockResolvedValue({
    userId,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ firstName: "Jane", lastName: "Smith", emailAddresses: [] }) },
  } as never);
  vi.mocked(clinics.updateClinicBranding).mockImplementation(realClinics.updateClinicBranding);
}

/** A form the way the browser would send it. */
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const createdClinicIds: string[] = [];
const orgMine = fakeOrgId();
const orgTheirs = fakeOrgId();
const orgPending = fakeOrgId();
let mine = "";
let theirs = "";
let pending = "";

const good = { brandColor: "#7A1F2B", brandFont: "merriweather", phone: "(801) 555-0123" };

async function makeClinic(name: string, clerkOrgId: string, status: "ACTIVE" | "PENDING") {
  const clinic = await prisma.clinic.create({ data: { name, clerkOrgId, status, logoUrl: "https://example.com/their-own-logo.png" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

async function brandingOf(clinicId: string) {
  return prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { brandColor: true, brandFont: true, phone: true, logoUrl: true } });
}

const UNTOUCHED = { brandColor: null, brandFont: null, phone: null, logoUrl: "https://example.com/their-own-logo.png" };

beforeAll(async () => {
  mine = await makeClinic("Vitest branding action clinic (mine)", orgMine, "ACTIVE");
  theirs = await makeClinic("Vitest branding action clinic (theirs)", orgTheirs, "ACTIVE");
  pending = await makeClinic("Vitest branding action clinic (pending)", orgPending, "PENDING");
});

beforeEach(async () => {
  vi.resetAllMocks();
  // Every test starts from a clinic with no branding and no log.
  await prisma.clinic.updateMany({ where: { id: { in: createdClinicIds } }, data: { brandColor: null, brandFont: null, phone: null } });
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("who may save a clinic's branding", () => {
  it("refuses someone who is signed out, and writes nothing", async () => {
    signInAs(null, "member", null);

    expect(await saveClinicBrandingAction(null, form(good))).toMatchObject({ error: expect.stringContaining("office admins") });
    expect(await brandingOf(mine)).toEqual(UNTOUCHED);
  });

  it("refuses a member of the clinic, and writes nothing", async () => {
    signInAs(orgMine, "member");

    expect(await saveClinicBrandingAction(null, form(good))).toEqual({ error: "Only your clinic's office admins can change the branding." });
    expect(await brandingOf(mine)).toEqual(UNTOUCHED);
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(0);
  });

  it("refuses an admin whose clinic is not open", async () => {
    signInAs(orgPending, "admin");

    expect(await saveClinicBrandingAction(null, form(good))).toMatchObject({ error: expect.stringContaining("not open") });
    expect(await brandingOf(pending)).toEqual(UNTOUCHED);
  });

  it("lets an admin save, tidies the values, and logs it under their name as a clinic admin", async () => {
    signInAs(orgMine, "admin");

    expect(await saveClinicBrandingAction(null, form(good))).toMatchObject({ ok: expect.stringContaining("Saved") });

    expect(await brandingOf(mine)).toEqual({ brandColor: "#7a1f2b", brandFont: "merriweather", phone: "8015550123", logoUrl: "https://example.com/their-own-logo.png" });

    const notes = await prisma.clinicNote.findMany({ where: { clinicId: mine }, select: { authorName: true, kind: true, body: true } });
    expect(notes).toEqual([
      {
        authorName: "Jane Smith (clinic admin)",
        kind: "STATUS",
        body: "Branding changed: colour set to #7a1f2b; font changed from Inter to Merriweather; phone set to (801) 555-0123.",
      },
    ]);
  });

  it("an admin of another clinic cannot restyle this one: a clinic id forged into the form is never read", async () => {
    signInAs(orgTheirs, "admin");

    const result = await saveClinicBrandingAction(null, form({ ...good, clinicId: mine, id: mine }));

    // The save worked, on THEIR clinic. Mine is untouched, and has nothing in its log.
    expect(result).toMatchObject({ ok: expect.stringContaining("Saved") });
    expect(await brandingOf(mine)).toEqual(UNTOUCHED);
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(0);
    expect((await brandingOf(theirs)).brandColor).toBe("#7a1f2b");
  });
});

describe("what a clinic admin may set", () => {
  it("never reads a logo address from the form: a clinic's logo is the one it uploads to Clerk", async () => {
    signInAs(orgMine, "admin");

    await saveClinicBrandingAction(null, form({ ...good, logoUrl: "https://evil.example/tracker.png" }));

    expect((await brandingOf(mine)).logoUrl).toBe("https://example.com/their-own-logo.png");
  });

  it("refuses a bad colour, a font not on the list and a bad phone, saving none of the form", async () => {
    signInAs(orgMine, "admin");

    const bad: [Record<string, string>, string][] = [
      [{ ...good, brandColor: "teal" }, "hex colour"],
      [{ ...good, brandColor: "#12345" }, "hex colour"],
      [{ ...good, brandColor: "red; background:url(x)" }, "hex colour"],
      [{ ...good, brandFont: "papyrus" }, "fonts on the list"],
      [{ ...good, phone: "555-0123" }, "US phone number"],
    ];
    for (const [fields, words] of bad) {
      expect(await saveClinicBrandingAction(null, form(fields))).toMatchObject({ error: expect.stringContaining(words) });
    }

    expect(await brandingOf(mine)).toEqual(UNTOUCHED);
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(0);
  });

  it("an empty form goes back to the Pulse look, and the same save twice is one change", async () => {
    signInAs(orgMine, "admin");
    await saveClinicBrandingAction(null, form(good));

    expect(await saveClinicBrandingAction(null, form({ brandColor: "", brandFont: "inter", phone: "" }))).toMatchObject({ ok: expect.stringContaining("Saved") });
    expect(await brandingOf(mine)).toEqual(UNTOUCHED);

    // Sent again (a double tap, a retry after a dropped connection): nothing more is written.
    expect(await saveClinicBrandingAction(null, form({ brandColor: "", brandFont: "inter", phone: "" }))).toEqual({ ok: "Nothing changed, so nothing was saved." });
    expect(await prisma.clinicNote.count({ where: { clinicId: mine } })).toBe(2);
  });
});

describe("when the save itself fails", () => {
  it("answers a plain sentence, never the exception, and says nothing was changed", async () => {
    signInAs(orgMine, "admin");
    vi.mocked(clinics.updateClinicBranding).mockRejectedValueOnce(new Error("connection terminated unexpectedly at 10.0.0.12:5432"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await saveClinicBrandingAction(null, form(good));

    expect(result).toEqual({ error: "That did not save. Nothing was changed. Try again in a moment." });
    expect(JSON.stringify(result)).not.toContain("10.0.0.12");
    // The detail went to the server log instead.
    expect(logged).toHaveBeenCalled();
    expect(await brandingOf(mine)).toEqual(UNTOUCHED);
    logged.mockRestore();
  });
});
