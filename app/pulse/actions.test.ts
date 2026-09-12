import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { DEFAULT_PRICING_CONFIG } from "@/lib/pricing";
import {
  activatePricingVersionAction,
  addNoteAction,
  saveCategoryConfigAction,
  saveDetailsAction,
  savePricingVersionAction,
  saveVideoAction,
  setManagedAction,
  setPlanAction,
  setStatusAction,
} from "./actions";

/**
 * The Server Actions behind /pulse, with Clerk replaced by a stand-in and
 * the database real (the Neon testing branch). The point of these tests:
 * a non-staff user is refused before anything is written, and a staff user
 * is not.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// revalidatePath only works inside a real request; here it just needs to not throw.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function signInAs(userId: string, publicMetadata: Record<string, unknown>) {
  vi.mocked(auth).mockResolvedValue({ userId } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: async () => ({ publicMetadata, firstName: "Evan", lastName: "Miller", emailAddresses: [] }),
    },
  } as never);
}

/** A form the way the browser would send it. */
function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];

async function makeClinic() {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest pulse clinic ${randomBytes(4).toString("hex")}` },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

describe("setStatusAction", () => {
  it("refuses a user who is not Pulse staff with not-found, and writes nothing", async () => {
    const clinicId = await makeClinic();
    signInAs("user_clinic_admin", { kind: "staff" });

    await expect(
      setStatusAction(null, form({ clinicId, status: "ACTIVE", reason: "trying it on" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true, statusReason: true } });
    expect(clinic?.status).toBe("PENDING");
    expect(clinic?.statusReason).toBeNull();
  });

  it("lets Pulse staff set the status, and records the reason and who did it", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    const result = await setStatusAction(null, form({ clinicId, status: "ACTIVE", reason: "Paid by invoice" }));
    expect(result).toEqual({ ok: "Status set to active." });

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { status: true, statusReason: true, statusChangedBy: true, statusChangedAt: true },
    });
    expect(clinic?.status).toBe("ACTIVE");
    expect(clinic?.statusReason).toBe("Paid by invoice");
    expect(clinic?.statusChangedBy).toBe("Evan Miller");
    expect(clinic?.statusChangedAt).toBeInstanceOf(Date);

    // The change also went into the clinic's log, under the staff member's name.
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { kind: true, body: true, authorName: true } });
    expect(notes).toEqual([{ kind: "STATUS", body: "Status set to Active: Paid by invoice", authorName: "Evan Miller" }]);
  });

  it("needs a reason, and only the three statuses staff may set", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await setStatusAction(null, form({ clinicId, status: "ACTIVE", reason: "  " }))).toMatchObject({ error: expect.any(String) });
    expect(await setStatusAction(null, form({ clinicId, status: "PAST_DUE", reason: "no" }))).toMatchObject({ error: expect.any(String) });
    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true } }))?.status).toBe("PENDING");
  });
});

describe("addNoteAction", () => {
  it("refuses a non-staff user and writes nothing", async () => {
    const clinicId = await makeClinic();
    signInAs("user_clinic_admin", {});
    await expect(addNoteAction(null, form({ clinicId, body: "Trying it on" }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });

  it("adds a STAFF note under the staff member's name, and needs some text", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await addNoteAction(null, form({ clinicId, body: "   " }))).toMatchObject({ error: expect.any(String) });

    const result = await addNoteAction(null, form({ clinicId, body: "Spoke to the office manager." }));
    expect(result).toEqual({ ok: "Note added." });

    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { kind: true, body: true, authorName: true } });
    expect(notes).toEqual([{ kind: "STAFF", body: "Spoke to the office manager.", authorName: "Evan Miller" }]);
  });
});

describe("setManagedAction and saveDetailsAction", () => {
  it("log what changed under the staff member's name", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await setManagedAction(null, form({ clinicId, managedByPulse: "on" }))).toEqual({ ok: "This clinic is now managed by Pulse." });

    // The test clinic has no Clerk organization, so no rename goes to Clerk.
    const details = await saveDetailsAction(
      null,
      form({ clinicId, name: "Vitest renamed clinic", phone: "801-555-0123", logoUrl: "", noticeText: "Welcome", viewDaysOverride: "" }),
    );
    expect(details).toEqual({ ok: "Details saved." });

    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, orderBy: { createdAt: "asc" }, select: { body: true, authorName: true } });
    expect(notes.map((note) => note.authorName)).toEqual(["Evan Miller", "Evan Miller"]);
    expect(notes[0].body).toBe("Managed by Pulse turned on.");
    expect(notes[1].body).toContain('name changed from "Vitest pulse clinic');
    expect(notes[1].body).toContain("phone set to (801) 555-0123");
    expect(notes[1].body).toContain('notice set to "Welcome"');
    expect(notes[1].body).toContain("placeholder videos hidden");
  });
});

describe("setPlanAction", () => {
  it("refuses a non-staff user", async () => {
    const clinicId = await makeClinic();
    signInAs("user_clinic_admin", {});
    await expect(setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "3" }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("writes the chosen categories and seats for staff", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    const result = await setPlanAction(null, form({ clinicId, categories: ["KNEE", "HIP"], surgeonSeats: "3" }));
    expect(result).toEqual({ ok: "Plan saved: 2 categories, 3 seats." });

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { categories: true, surgeonSeats: true } });
    expect(clinic?.categories).toEqual(["KNEE", "HIP"]);
    expect(clinic?.surgeonSeats).toBe(3);

    // The change is in the clinic's log under the staff member's name.
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { kind: true, body: true, authorName: true } });
    expect(notes).toEqual([
      { kind: "STATUS", body: "Plan changed: categories set to Knee, Hip (was none); surgeon seats set to 3 (was 0).", authorName: "Evan Miller" },
    ]);

    // Saving the same plan again says so and adds nothing to the log.
    const again = await setPlanAction(null, form({ clinicId, categories: ["KNEE", "HIP"], surgeonSeats: "3" }));
    expect(again).toEqual({ ok: "Nothing changed, so nothing was saved." });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(1);
  });

  it("rejects a category we do not have and a seat count that is not a whole number", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await setPlanAction(null, form({ clinicId, categories: ["ELBOW"], surgeonSeats: "3" }))).toMatchObject({ error: expect.any(String) });
    expect(await setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "2.5" }))).toMatchObject({ error: expect.any(String) });
  });
});

describe("saveVideoAction", () => {
  const fields = {
    title: "Vitest Total Ankle Replacement",
    category: "FOOT_ANKLE",
    videoUrl: "https://cdn.prod.website-files.com/test/ankle.mp4",
    durationSeconds: "2:05",
    posterUrl: "",
    isPlaceholder: "on",
    isPublished: "on",
    notes: "Sample until the real one lands.",
  };

  it("refuses a user who is not Pulse staff with not-found, and adds nothing", async () => {
    signInAs("user_clinic_admin", { kind: "staff" });
    const before = await prisma.video.count();
    await expect(saveVideoAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await prisma.video.count()).toBe(before);
  });

  it("adds a video for staff, sends them to its page, and then edits it in place", async () => {
    signInAs("user_staff", { pulseStaff: true });

    // A new video ends in a redirect to its own page (Next.js signals that by throwing).
    await expect(saveVideoAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });

    const video = await prisma.video.findFirst({ where: { title: fields.title }, orderBy: { createdAt: "desc" } });
    expect(video).not.toBeNull();
    createdVideoIds.push(video!.id);
    expect(video).toMatchObject({
      category: "FOOT_ANKLE",
      durationSeconds: 125,
      posterUrl: null,
      isPlaceholder: true,
      isPublished: true,
      notes: "Sample until the real one lands.",
    });

    // Replacing the placeholder: new address, placeholder off. Same row.
    const result = await saveVideoAction(
      null,
      form({ ...fields, id: video!.id, videoUrl: "https://cdn.prod.website-files.com/test/ankle-final.mp4", isPlaceholder: "", notes: "" }),
    );
    expect(result).toEqual({ ok: "Saved. Every link that points at this video plays the new version." });

    const edited = await prisma.video.findUnique({ where: { id: video!.id } });
    expect(edited).toMatchObject({
      id: video!.id,
      videoUrl: "https://cdn.prod.website-files.com/test/ankle-final.mp4",
      isPlaceholder: false,
      notes: null,
    });
    expect(await prisma.video.count({ where: { title: fields.title } })).toBe(1);
  });

  it("rejects a non-https address, a length that is not a length, and an unknown category", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await saveVideoAction(null, form({ ...fields, videoUrl: "http://example.com/a.mp4" }))).toMatchObject({ error: expect.any(String) });
    expect(await saveVideoAction(null, form({ ...fields, durationSeconds: "4:70" }))).toMatchObject({ error: expect.any(String) });
    expect(await saveVideoAction(null, form({ ...fields, category: "ELBOW" }))).toMatchObject({ error: expect.any(String) });
    expect(await saveVideoAction(null, form({ ...fields, id: "no-such-video" }))).toEqual({ error: "That video no longer exists." });
  });
});

describe("saveCategoryConfigAction", () => {
  it("refuses a non-staff user", async () => {
    signInAs("user_clinic_admin", {});
    await expect(saveCategoryConfigAction(null, form({ category: "KNEE", sellable: "on", comingSoonText: "" }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("saves the switch and the sentence for staff, and rejects a category we do not have", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const before = await prisma.categoryConfig.findUnique({ where: { category: "COMPLEX_SPINE" } });

    const result = await saveCategoryConfigAction(null, form({ category: "COMPLEX_SPINE", comingSoonText: "  Deformity work arrives in the spring.  " }));
    expect(result).toEqual({ ok: "Saved. This category is not for sale." });
    expect(await prisma.categoryConfig.findUnique({ where: { category: "COMPLEX_SPINE" } })).toMatchObject({
      sellable: false,
      comingSoonText: "Deformity work arrives in the spring.",
    });

    expect(await saveCategoryConfigAction(null, form({ category: "ELBOW", sellable: "on" }))).toMatchObject({ error: expect.any(String) });

    // Put the row back the way it was found (or remove it if this test made it).
    if (before) {
      await prisma.categoryConfig.update({ where: { category: "COMPLEX_SPINE" }, data: { sellable: before.sellable, comingSoonText: before.comingSoonText } });
    } else {
      await prisma.categoryConfig.delete({ where: { category: "COMPLEX_SPINE" } });
    }
  });
});

describe("savePricingVersionAction and activatePricingVersionAction", () => {
  const createdVersionIds: string[] = [];
  let activeBefore: string | null = null;

  beforeAll(async () => {
    const active = await prisma.pricingVersion.findFirst({ where: { active: true }, select: { id: true } });
    activeBefore = active?.id ?? null;
  });

  afterAll(async () => {
    // Activating one of ours took the mark off whatever was active; put it back, then remove our rows.
    await prisma.pricingVersion.updateMany({ where: { active: true }, data: { active: null } });
    if (activeBefore) await prisma.pricingVersion.updateMany({ where: { id: activeBefore }, data: { active: true } });
    await prisma.pricingVersion.deleteMany({ where: { id: { in: createdVersionIds } } });
  });

  it("refuses a user who is not Pulse staff with not-found, and writes nothing", async () => {
    signInAs("user_clinic_admin", { kind: "staff" });
    const before = await prisma.pricingVersion.count();
    await expect(savePricingVersionAction({ config: DEFAULT_PRICING_CONFIG, note: "Trying it on" })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    await expect(activatePricingVersionAction(null, form({ versionId: "anything" }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(await prisma.pricingVersion.count()).toBe(before);
  });

  it("needs a note, and sends bad numbers back beside their fields without writing", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const before = await prisma.pricingVersion.count();

    expect(await savePricingVersionAction({ config: DEFAULT_PRICING_CONFIG, note: "   " })).toMatchObject({ error: expect.stringContaining("note") });

    const bad = await savePricingVersionAction({
      config: { ...DEFAULT_PRICING_CONFIG, perSeatCents: { ...DEFAULT_PRICING_CONFIG.perSeatCents, KNEE: -1 }, yearlyMonths: 13 },
      note: "Bad numbers",
    });
    expect(bad).toMatchObject({ error: expect.any(String) });
    expect("fieldErrors" in bad ? bad.fieldErrors?.map((e) => e.field).sort() : []).toEqual(["perSeatCents.KNEE", "yearlyMonths"]);

    expect(await prisma.pricingVersion.count()).toBe(before);
  });

  it("saves a version under the staff member's id and name, then makes it active on request", async () => {
    signInAs("user_staff", { pulseStaff: true });

    const config = { ...DEFAULT_PRICING_CONFIG, perSeatCents: { ...DEFAULT_PRICING_CONFIG.perSeatCents, HIP: 6900 } };
    const saved = await savePricingVersionAction({ config, note: "  Hip to $69  " });
    expect(saved).toMatchObject({ ok: expect.stringContaining("Saved as version"), version: expect.any(Number) });
    if (!("version" in saved)) return;

    const row = await prisma.pricingVersion.findUnique({ where: { version: saved.version } });
    expect(row).not.toBeNull();
    createdVersionIds.push(row!.id);
    expect(row).toMatchObject({ note: "Hip to $69", createdBy: "user_staff", createdByName: "Evan Miller", active: null });
    expect(row!.config).toEqual(config);

    // Saving does not activate. Activating does, and says so.
    expect(await activatePricingVersionAction(null, form({ versionId: row!.id }))).toEqual({ ok: `Version ${saved.version} is now active.` });
    expect((await prisma.pricingVersion.findUnique({ where: { id: row!.id }, select: { active: true } }))?.active).toBe(true);
    expect(await prisma.pricingVersion.count({ where: { active: true } })).toBe(1);
  });

  it("answers a plain sentence, not a crash, for a version that cannot be activated", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await activatePricingVersionAction(null, form({ versionId: "" }))).toMatchObject({ error: expect.any(String) });
    expect(await activatePricingVersionAction(null, form({ versionId: "no-such-version" }))).toMatchObject({ error: expect.stringContaining("no-such-version") });
  });
});
