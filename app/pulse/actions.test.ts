import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { reserveSeat } from "@/lib/db/seats";
import { saveSettings } from "@/lib/db/settings";
import { MAX_GRACE_DAYS } from "@/lib/billing-state";
import { recordAcceptedPlan, setStripeCustomer } from "@/lib/db/billing";
import { MAX_LINK_DAYS } from "@/lib/expiry";
import { MuxApiError, checkPlaybackId } from "@/lib/mux";
import { cancelUpload, checkUpload, dismissFailure, startUpload } from "@/lib/mux-uploads";
import { NOTE_MAX_LENGTH } from "@/lib/note-form";
import { MAX_VIDEO_SECONDS } from "@/lib/video";
import { DEFAULT_PRICING_CONFIG } from "@/lib/pricing";
import {
  activatePricingVersionAction,
  addNoteAction,
  cancelMuxUploadAction,
  checkMuxUploadAction,
  dismissUploadFailureAction,
  retryBillingEventAction,
  startMuxUploadAction,
  saveBrandingAction,
  saveCategoryConfigAction,
  addCategoryAction,
  deleteCategoryAction,
  saveDetailsAction,
  savePricingVersionAction,
  saveSettingsAction,
  saveVideoAction,
  setManagedAction,
  setPlanAction,
  setPracticeTypeAction,
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

// The settings row is shared by the whole app and belongs to no test, so the
// save itself is a stand-in here: the tests check what the action refuses and
// what it hands to the save, never the row.
vi.mock("@/lib/db/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/settings")>();
  return { ...actual, saveSettings: vi.fn() };
});

// Asking Mux about a playback id is a stand-in: each test says what Mux would answer (lib/mux.test.ts covers the real check's reading of Mux's answers).
vi.mock("@/lib/mux", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mux")>();
  return { ...actual, checkPlaybackId: vi.fn() };
});

// The upload flow is a stand-in too (lib/mux-uploads.test.ts runs the real one against the database): these tests are about who may call it and with what.
vi.mock("@/lib/mux-uploads", () => ({
  startUpload: vi.fn(),
  checkUpload: vi.fn(),
  cancelUpload: vi.fn(),
  dismissFailure: vi.fn(),
  UPLOADS_NOT_CONFIGURED: "not configured",
}));

// The upload action reads the request's Host header to pick a trusted origin; here the request is this deployment's own.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
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
const BILLING_FIXTURE_NOTE = `Vitest pulse actions billing fixture ${randomBytes(4).toString("hex")}`;
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
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.pricingVersion.deleteMany({ where: { note: BILLING_FIXTURE_NOTE } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.$disconnect();
});

describe("setStatusAction", () => {
  it("refuses a user who is not Pulse staff with not-found, and writes nothing", async () => {
    const clinicId = await makeClinic();
    signInAs("user_clinic_admin", { kind: "staff" });

    await expect(
      setStatusAction(null, form({ clinicId, status: "OPEN", reason: "trying it on" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true, statusReason: true } });
    expect(clinic?.status).toBe("PENDING");
    expect(clinic?.statusReason).toBeNull();
  });

  it("lets Pulse staff set the status, and records the reason and who did it", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    const result = await setStatusAction(null, form({ clinicId, status: "OPEN", reason: "Paid by invoice" }));
    expect(result).toEqual({ ok: "Set by hand. The clinic's status is now active." });

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { status: true, staffAccess: true, statusReason: true, statusChangedBy: true, statusChangedAt: true },
    });
    expect(clinic?.status).toBe("ACTIVE");
    expect(clinic?.staffAccess).toBe("OPEN");
    expect(clinic?.statusReason).toBe("Paid by invoice");
    expect(clinic?.statusChangedBy).toBe("Evan Miller");
    expect(clinic?.statusChangedAt).toBeInstanceOf(Date);

    // The change also went into the clinic's log, under the staff member's name.
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { kind: true, body: true, authorName: true } });
    expect(notes).toEqual([{ kind: "STATUS", body: "Access set by hand to Open: Paid by invoice Status is now Active.", authorName: "Evan Miller" }]);
  });

  it("Follow billing removes the hand setting, and a clinic with no subscription goes back to pending", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    await setStatusAction(null, form({ clinicId, status: "OPEN", reason: "Pilot" }));

    const result = await setStatusAction(null, form({ clinicId, status: "FOLLOW", reason: "Pilot over" }));

    expect(result).toEqual({ ok: "Hand setting removed. The clinic follows billing; its status is now pending." });
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true, staffAccess: true } });
    expect(clinic).toEqual({ status: "PENDING", staffAccess: null });
  });

  it("pausing a clinic whose card is still being charged says, in as many words, that Stripe was not cancelled", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    // A clinic with a live subscription on record, made the way checkout will make it.
    const version = await prisma.pricingVersion.create({
      data: { config: DEFAULT_PRICING_CONFIG, note: BILLING_FIXTURE_NOTE, createdBy: "user_vitest", createdByName: "Vitest" },
      select: { id: true },
    });
    await setStripeCustomer(clinicId, `cus_vitestactions${randomBytes(4).toString("hex")}`);
    await recordAcceptedPlan(clinicId, {
      pricingVersionId: version.id,
      categories: ["KNEE"],
      entitledCategories: ["KNEE"],
      surgeonSeats: 1,
      interval: "MONTH",
      perSeatCents: 5900,
      totalCents: 5900,
      acceptedById: "user_vitest",
      acceptedByName: "Vitest",
    });
    await prisma.clinicBilling.update({ where: { clinicId }, data: { status: "ACTIVE" } });

    const paused = await setStatusAction(null, form({ clinicId, status: "PAUSED", reason: "On hold" }));
    expect(paused?.ok).toContain("did not cancel it");
    expect(paused?.ok).toContain("keeps being charged");

    const managed = await setManagedAction(null, form({ clinicId, managedByPulse: "on" }));
    expect(managed?.ok).toContain("keeps being charged");
  });

  it("needs a reason, and only the three statuses staff may set", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await setStatusAction(null, form({ clinicId, status: "OPEN", reason: "  " }))).toMatchObject({ error: expect.any(String) });
    // What the rules work out can never be set by hand, and neither can a word that is not ours.
    for (const status of ["PAST_DUE", "PENDING", "ACTIVE", "", "toString", "__proto__"]) {
      expect(await setStatusAction(null, form({ clinicId, status, reason: "no" }))).toMatchObject({ error: expect.any(String) });
    }
    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true } }))?.status).toBe("PENDING");
  });
});

describe("setPracticeTypeAction", () => {
  it("is for Pulse staff only, refuses a value that is not one of the three, and logs a real change once", async () => {
    const clinicId = await makeClinic();

    signInAs("user_clinic_admin", { kind: "staff" });
    await expect(setPracticeTypeAction(null, form({ clinicId, practiceType: "HOSPITAL" }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    signInAs("user_staff", { pulseStaff: true });
    expect(await setPracticeTypeAction(null, form({ clinicId, practiceType: "CHARITY" }))).toMatchObject({ error: expect.any(String) });
    expect(await setPracticeTypeAction(null, form({ clinicId, practiceType: "HOSPITAL" }))).toEqual({ ok: "Practice type saved." });
    expect(await setPracticeTypeAction(null, form({ clinicId, practiceType: "HOSPITAL" }))).toEqual({ ok: "Nothing changed, so nothing was saved." });

    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { practiceType: true } }))?.practiceType).toBe("HOSPITAL");
    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { body: true } });
    expect(notes).toEqual([{ body: 'Practice type changed from "Not set (counts as a clinic)" to "Hospital or health system".' }]);
  });
});

describe("retryBillingEventAction", () => {
  it("is for Pulse staff only, and says so plainly when the notification is gone", async () => {
    signInAs("user_clinic_admin", { kind: "staff" });
    await expect(retryBillingEventAction(null, form({ eventId: "anything" }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    signInAs("user_staff", { pulseStaff: true });
    expect(await retryBillingEventAction(null, form({ eventId: "" }))).toMatchObject({ error: expect.any(String) });
    expect(await retryBillingEventAction(null, form({ eventId: "no_such_notification" }))).toMatchObject({ error: expect.any(String) });
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

  it("refuses a note one character over the limit with a plain message, and writes nothing", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    const result = await addNoteAction(null, form({ clinicId, body: "x".repeat(NOTE_MAX_LENGTH + 1) }));
    expect(result).toEqual({ error: "Keep a note to 2000 characters or fewer." });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });

  it("takes a note of exactly the limit, counting each line break once however the browser sent it", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    // 2,000 characters as the box counts them; a browser sends each line break as two, so more than 2,000 arrive.
    const typed = Array.from({ length: 1000 }, () => "a").join("\n") + "b";
    expect(typed.length).toBe(NOTE_MAX_LENGTH);
    const sent = typed.replace(/\n/g, "\r\n");

    expect(await addNoteAction(null, form({ clinicId, body: sent }))).toEqual({ ok: "Note added." });
    const saved = await prisma.clinicNote.findFirstOrThrow({ where: { clinicId }, select: { body: true } });
    expect(saved.body).toBe(typed);
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
    expect(notes[1].body).toContain('notice set to "Welcome"');
    expect(notes[1].body).toContain("placeholder videos hidden");
  });

  it("accepts a clinic override of exactly a year and refuses one past it, or of zero, without saving", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    const details = (viewDaysOverride: string) => form({ clinicId, name: "Vitest limits clinic", phone: "", logoUrl: "", noticeText: "", viewDaysOverride });

    expect(await saveDetailsAction(null, details(String(MAX_LINK_DAYS)))).toEqual({ ok: "Details saved." });
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).viewDaysOverride).toBe(MAX_LINK_DAYS);

    for (const bad of [String(MAX_LINK_DAYS + 1), "0", "7.5", "abc"]) {
      expect(await saveDetailsAction(null, details(bad))).toMatchObject({ error: expect.stringContaining("1 to 365") });
    }
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).viewDaysOverride).toBe(MAX_LINK_DAYS);
  });

  it("refuses a clinic name over 120 characters without saving or asking Clerk, and takes exactly 120", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    const before = (await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).name;
    const details = (name: string) => form({ clinicId, name, phone: "", logoUrl: "", noticeText: "", viewDaysOverride: "" });

    expect(await saveDetailsAction(null, details("N".repeat(121)))).toEqual({ error: "Keep the clinic's name under 120 characters." });
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).name).toBe(before);

    expect(await saveDetailsAction(null, details("N".repeat(120)))).toEqual({ ok: "Details saved." });
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).name).toBe("N".repeat(120));
  });
});

describe("saveDetailsAction and the clinic's branding", () => {
  it("does not touch the logo or the phone, even when a form sends them: those are saved by the Branding tab only", async () => {
    const clinicId = await makeClinic();
    await prisma.clinic.update({ where: { id: clinicId }, data: { logoUrl: "https://example.com/kept.png", phone: "8015550123" } });
    signInAs("user_staff", { pulseStaff: true });

    // An old copy of the form, still open in a tab, sends the two fields it used to have.
    const result = await saveDetailsAction(
      null,
      form({ clinicId, name: "Vitest details-only clinic", phone: "", logoUrl: "", noticeText: "", viewDaysOverride: "", showPlaceholders: "on" }),
    );
    expect(result).toEqual({ ok: "Details saved." });

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoUrl: true, phone: true } });
    expect(clinic).toEqual({ logoUrl: "https://example.com/kept.png", phone: "8015550123" });
  });
});

describe("saveBrandingAction", () => {
  const good = { logoUrl: "https://example.com/logo.png", brandColor: "#7A1F2B", brandFont: "merriweather", brandTheme: "light", phone: "801-555-0123" };

  it("refuses a user who is not Pulse staff with not-found, and writes nothing", async () => {
    const clinicId = await makeClinic();
    signInAs("user_clinic_admin", { kind: "staff" });

    await expect(saveBrandingAction(null, form({ clinicId, ...good }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoUrl: true, brandColor: true, brandFont: true, brandTheme: true, phone: true } });
    expect(clinic).toEqual({ logoUrl: null, brandColor: null, brandFont: null, brandTheme: null, phone: null });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });

  it("saves the logo, colour, font and phone for staff, tidied up, and logs it under their name", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    expect(await saveBrandingAction(null, form({ clinicId, ...good }))).toMatchObject({ ok: expect.stringContaining("Branding saved") });

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoUrl: true, brandColor: true, brandFont: true, brandTheme: true, phone: true } });
    expect(clinic).toEqual({ logoUrl: "https://example.com/logo.png", brandColor: "#7a1f2b", brandFont: "merriweather", brandTheme: "light", phone: "8015550123" });

    const notes = await prisma.clinicNote.findMany({ where: { clinicId }, select: { body: true, authorName: true, kind: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ authorName: "Evan Miller", kind: "STATUS" });
    expect(notes[0].body).toBe(
      "Branding changed: logo set to https://example.com/logo.png; colour set to #7a1f2b; font changed from Inter to Merriweather; mode changed from Dark to Light; phone set to (801) 555-0123.",
    );

    // The same form again changes nothing and logs nothing.
    expect(await saveBrandingAction(null, form({ clinicId, ...good }))).toEqual({ ok: "Nothing changed, so nothing was saved." });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(1);
  });

  it("stores the default font and an empty colour as nothing set", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    await saveBrandingAction(null, form({ clinicId, ...good }));

    await saveBrandingAction(null, form({ clinicId, logoUrl: "", brandColor: "", brandFont: "inter", brandTheme: "dark", phone: "" }));

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoUrl: true, brandColor: true, brandFont: true, brandTheme: true, phone: true } });
    expect(clinic).toEqual({ logoUrl: null, brandColor: null, brandFont: null, brandTheme: null, phone: null });
  });

  it("refuses a bad colour, a font not on the list, a bad phone and a logo that is not https, saving none of the form", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });

    const bad: [Record<string, string>, string][] = [
      [{ ...good, brandColor: "teal" }, "hex colour"],
      [{ ...good, brandColor: "red; background:url(x)" }, "hex colour"],
      [{ ...good, brandFont: "papyrus" }, "fonts on the list"],
      [{ ...good, brandTheme: "sepia" }, "Dark or Light"],
      [{ ...good, phone: "555-0123" }, "US phone number"],
      [{ ...good, logoUrl: "http://example.com/logo.png" }, "https://"],
      [{ ...good, logoUrl: "javascript:alert(1)" }, "https://"],
    ];
    for (const [fields, words] of bad) {
      expect(await saveBrandingAction(null, form({ clinicId, ...fields }))).toMatchObject({ error: expect.stringContaining(words) });
    }

    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoUrl: true, brandColor: true, brandFont: true, brandTheme: true, phone: true } });
    expect(clinic).toEqual({ logoUrl: null, brandColor: null, brandFont: null, brandTheme: null, phone: null });
    expect(await prisma.clinicNote.count({ where: { clinicId } })).toBe(0);
  });

  it("answers a plain sentence for a clinic id that does not exist", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await saveBrandingAction(null, form({ clinicId: "no-such-clinic", ...good }))).toEqual({ error: "That clinic no longer exists." });
  });
});

describe("saveSettingsAction", () => {
  const typed = (over: Partial<Record<"unclaimedDays" | "viewDays" | "graceDays" | "qrDailyFlag" | "maxRenewals", string>> = {}) =>
    form({ unclaimedDays: "90", viewDays: "7", graceDays: "14", qrDailyFlag: "200", maxRenewals: "3", ...over });

  it("refuses a user who is not Pulse staff with not-found, and saves nothing", async () => {
    signInAs("user_clinic_admin", { kind: "staff" });
    await expect(saveSettingsAction(null, typed())).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
  });

  it("accepts a year for both link day counts, the limit itself, and hands the save exactly what was typed", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await saveSettingsAction(null, typed({ unclaimedDays: String(MAX_LINK_DAYS), viewDays: String(MAX_LINK_DAYS) }))).toEqual({ ok: "Settings saved." });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledWith({ unclaimedDays: 365, viewDays: 365, graceDays: 14, qrDailyFlag: 200, maxRenewals: 3 });
  });

  it("refuses a day count past a year, or of zero, for either link setting, naming the field, without saving", async () => {
    signInAs("user_staff", { pulseStaff: true });

    expect(await saveSettingsAction(null, typed({ unclaimedDays: String(MAX_LINK_DAYS + 1) }))).toEqual({
      error: "Unclaimed link days must be a whole number of days from 1 to 365.",
    });
    expect(await saveSettingsAction(null, typed({ viewDays: String(MAX_LINK_DAYS + 1) }))).toEqual({
      error: "Days after first play must be a whole number of days from 1 to 365.",
    });
    expect(await saveSettingsAction(null, typed({ viewDays: "0" }))).toMatchObject({ error: expect.stringContaining("at least 1") });
    expect(await saveSettingsAction(null, typed({ unclaimedDays: "1.5" }))).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
  });

  it("holds the grace days to the limits the grace rule itself enforces", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await saveSettingsAction(null, typed({ graceDays: String(MAX_GRACE_DAYS + 1) }))).toEqual({
      error: "Grace days must be a whole number of days from 1 to 365.",
    });
    expect(await saveSettingsAction(null, typed({ graceDays: "0" }))).toMatchObject({ error: expect.stringContaining("at least 1") });
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
    expect(await saveSettingsAction(null, typed({ graceDays: String(MAX_GRACE_DAYS) }))).toEqual({ ok: "Settings saved." });
  });

  it("holds the maximum renewals to 0 through 10: zero is allowed (no link can be turned back on), eleven and minus one are not", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await saveSettingsAction(null, typed({ maxRenewals: "0" }))).toEqual({ ok: "Settings saved." });
    expect(vi.mocked(saveSettings)).toHaveBeenLastCalledWith(expect.objectContaining({ maxRenewals: 0 }));
    expect(await saveSettingsAction(null, typed({ maxRenewals: "10" }))).toEqual({ ok: "Settings saved." });
    expect(vi.mocked(saveSettings)).toHaveBeenLastCalledWith(expect.objectContaining({ maxRenewals: 10 }));

    vi.mocked(saveSettings).mockClear();
    for (const bad of ["11", "-1", "2.5", "", "three"]) {
      expect(await saveSettingsAction(null, typed({ maxRenewals: bad }))).toEqual({ error: "Maximum renewals must be a whole number from 0 to 10." });
    }
    expect(vi.mocked(saveSettings)).not.toHaveBeenCalled();
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

  it("will not lower the seats below the number in use unless the override box was ticked, and logs it under the staff name when it was", async () => {
    const clinicId = await makeClinic();
    signInAs("user_staff", { pulseStaff: true });
    await setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "3" }));
    for (const who of ["user_vitestpulseA", "user_vitestpulseB"]) {
      await reserveSeat(clinicId, who);
    }

    // Without the box: refused with a sentence that says what to do, and nothing saved.
    const refused = await setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "1" }));
    expect(refused?.error).toContain("2 seats are taken at this clinic (people and open invitations), so 1 seat would leave it 1 over. Nothing was saved.");
    expect(refused?.error).toContain('tick "Allow fewer seats than are in use"');
    expect((await prisma.clinic.findUnique({ where: { id: clinicId }, select: { surgeonSeats: true } }))?.surgeonSeats).toBe(3);

    // A box value the form never sends is not a tick.
    expect((await setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "1", allowFewerSeats: "true" })))?.error).toBeTruthy();

    // With the box: saved, both surgeons keep their seats, and the log says how far over.
    const saved = await setPlanAction(null, form({ clinicId, categories: ["KNEE"], surgeonSeats: "1", allowFewerSeats: "on" }));
    expect(saved?.ok).toContain("Plan saved: 1 category, 1 seat.");
    expect(saved?.ok).toContain("more surgeons holding a seat than its plan pays for");
    expect(await prisma.seatAllocation.count({ where: { clinicId } })).toBe(2);
    const last = await prisma.clinicNote.findFirst({ where: { clinicId }, orderBy: { createdAt: "desc" }, select: { body: true, authorName: true } });
    expect(last).toEqual({
      authorName: "Evan Miller",
      body: "Plan changed: surgeon seats set to 1 (was 3). 2 seats are taken, 1 more than the 1 the plan now pays for. Nobody was removed and no charge was changed; nobody else can be given a seat until that is settled.",
    });
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

  it("refuses a length over four hours (a typo like 41200 for 4:12), with nothing written, and takes exactly four hours", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const typo = { ...fields, isPublished: "", title: `Vitest too long ${randomBytes(3).toString("hex")}` };
    expect(await saveVideoAction(null, form({ ...typo, durationSeconds: "41200" }))).toEqual({
      error: "That length is over 4 hours. Type it as minutes and seconds, like 4:12, or leave it empty.",
    });
    expect(await saveVideoAction(null, form({ ...typo, durationSeconds: "4:00:01" }))).toMatchObject({ error: expect.stringContaining("over 4 hours") });
    expect(await prisma.video.count({ where: { title: typo.title } })).toBe(0);
    // Exactly four hours is accepted (a new video ends in a redirect to its page).
    await expect(saveVideoAction(null, form({ ...typo, durationSeconds: "4:00:00" }))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    const saved = await prisma.video.findFirst({ where: { title: typo.title }, select: { id: true, durationSeconds: true } });
    if (saved) createdVideoIds.push(saved.id);
    expect(saved?.durationSeconds).toBe(MAX_VIDEO_SECONDS);
  });

  describe("chapters", () => {
    /** The knee's chapters, typed out of order. */
    const KNEE_LINES = {
      chapterStart: ["1:03", "0:00", "1:37", "0:33", "1:28"],
      chapterTitle: ["The implant", "Intro", "Outro", "Preparing the knee", "The result"],
    };
    const KNEE = [
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 33, title: "Preparing the knee" },
      { startSeconds: 63, title: "The implant" },
      { startSeconds: 88, title: "The result" },
      { startSeconds: 97, title: "Outro" },
    ];
    /** What the form sends as shownChapters for the knee's chapters (chaptersKey). */
    const KNEE_SHOWN = JSON.stringify(KNEE.map((c) => [c.startSeconds, c.title]));

    /** A video of this test's own, 1:50 long, with the given chapters on the row. */
    async function chapteredVideo(chapters: unknown = []) {
      const video = await prisma.video.create({
        data: { title: `Vitest chapters ${randomBytes(3).toString("hex")}`, category: "KNEE", videoUrl: fields.videoUrl, durationSeconds: 110, isPublished: true, chapters: chapters as never },
        select: { id: true, title: true },
      });
      createdVideoIds.push(video.id);
      return video;
    }
    /** The edit form for that video, as the page draws it. */
    const editForm = (video: { id: string; title: string }, extra: Record<string, string | string[]>) =>
      form({ ...fields, category: "KNEE", durationSeconds: "1:50", shownDurationSeconds: "1:50", id: video.id, title: video.title, ...extra });
    const chaptersOf = async (id: string) => (await prisma.video.findUniqueOrThrow({ where: { id }, select: { chapters: true } })).chapters;

    it("refuses a user who is not Pulse staff with not-found, and leaves the chapters alone", async () => {
      const video = await chapteredVideo(KNEE);
      signInAs("user_clinic_admin", { kind: "staff" });
      await expect(saveVideoAction(null, editForm(video, { chapterStart: "0:00", chapterTitle: "Hijacked", shownChapters: KNEE_SHOWN }))).rejects.toMatchObject({
        digest: expect.stringContaining("404"),
      });
      expect(await chaptersOf(video.id)).toEqual(KNEE);
    });

    it("saves lines typed in any order sorted by time, and clears them when every line is removed", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const video = await chapteredVideo();
      expect(await saveVideoAction(null, editForm(video, { ...KNEE_LINES, shownChapters: "[]" }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual(KNEE);

      // A line left completely empty is ignored.
      expect(await saveVideoAction(null, editForm(video, { chapterStart: [...KNEE_LINES.chapterStart, ""], chapterTitle: [...KNEE_LINES.chapterTitle, " "], shownChapters: KNEE_SHOWN }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual(KNEE);

      expect(await saveVideoAction(null, editForm(video, { shownChapters: KNEE_SHOWN }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual([]);
    });

    it("refuses what the rules refuse, in a plain sentence, and writes nothing", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const video = await chapteredVideo(KNEE);
      const refusals: [Record<string, string | string[]>, RegExp][] = [
        [{ chapterStart: ["0:10", "0:33"], chapterTitle: ["Intro", "Next"] }, /first chapter has to start at 0:00/],
        [{ chapterStart: ["0:00", "0:33", "0:33"], chapterTitle: ["A", "B", "C"] }, /Two chapters start at 0:33/],
        [{ chapterStart: ["0:00", "1:50"], chapterTitle: ["A", "B"] }, /starts after the video ends \(1:50\)/],
        [{ chapterStart: "0:00", chapterTitle: "x".repeat(41) }, /to 40 characters/],
        [{ chapterStart: "0:00", chapterTitle: "Two\nlines" }, /on one line/],
        [{ chapterStart: Array.from({ length: 21 }, (_, i) => `0:${String(i).padStart(2, "0")}`), chapterTitle: Array.from({ length: 21 }, (_, i) => `C${i}`) }, /at most 20 chapters/],
        [{ chapterStart: ["0:00", "soon"], chapterTitle: ["A", "B"] }, /is not a time/],
        [{ chapterStart: ["0:00", "0:33"], chapterTitle: ["A"] }, /could not be read/],
      ];
      for (const [lines, sentence] of refusals) {
        expect(await saveVideoAction(null, editForm(video, { ...lines, shownChapters: KNEE_SHOWN, title: "Vitest renamed by a refused save" }))).toEqual({ error: expect.stringMatching(sentence) });
      }
      expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { title: true, chapters: true } })).toEqual({ title: video.title, chapters: KNEE });
    });

    it("a form drawn before someone else's save does not wipe chapters it did not change", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const video = await chapteredVideo();

      // Two staff members open the page while it has no chapters. The first adds the knee's chapters.
      expect(await saveVideoAction(null, editForm(video, { ...KNEE_LINES, shownChapters: "[]" }))).toMatchObject({ ok: expect.any(String) });

      // The second, from the page drawn before, fixes a note and leaves the (empty) chapters as they were shown: the first's stay.
      expect(await saveVideoAction(null, editForm(video, { notes: "Fixed a typo", shownChapters: "[]" }))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { notes: true, chapters: true } })).toEqual({ notes: "Fixed a typo", chapters: KNEE });

      // The same with chapters on both sides: shown as the knee's, someone renames one meanwhile, the stale form sends the knee's unchanged.
      const renamed = KNEE.map((c) => (c.startSeconds === 97 ? { ...c, title: "Recovery" } : c));
      await prisma.video.update({ where: { id: video.id }, data: { chapters: renamed } });
      expect(await saveVideoAction(null, editForm(video, { ...KNEE_LINES, shownChapters: KNEE_SHOWN }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual(renamed);

      // A form that DID change the chapters wins, as a change should.
      expect(await saveVideoAction(null, editForm(video, { chapterStart: ["0:00", "1:00"], chapterTitle: ["Start", "Middle"], shownChapters: KNEE_SHOWN }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual([
        { startSeconds: 0, title: "Start" },
        { startSeconds: 60, title: "Middle" },
      ]);
    });

    it("keeps the chapters when the form has no chapter section at all (a page drawn before chapters existed)", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const video = await chapteredVideo(KNEE);
      expect(await saveVideoAction(null, editForm(video, { notes: "Old page" }))).toMatchObject({ ok: expect.any(String) });
      expect(await chaptersOf(video.id)).toEqual(KNEE);
    });

    it("refuses a shorter length that would cut off chapters it keeps", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const video = await chapteredVideo(KNEE);
      expect(await saveVideoAction(null, editForm(video, { ...KNEE_LINES, shownChapters: KNEE_SHOWN, durationSeconds: "1:30" }))).toEqual({
        error: expect.stringMatching(/chapter at 1:37 starts after the video ends \(1:30\)/),
      });
      expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { durationSeconds: true } })).toEqual({ durationSeconds: 110 });
    });
  });

  describe("moving a video to Mux", () => {
    const playbackId = `Vitest${randomBytes(6).toString("hex")}`;
    const asked = () => vi.mocked(checkPlaybackId);

    /** A video of this test's own, on the CDN, to move. */
    async function cdnVideo() {
      const video = await prisma.video.create({
        data: { title: `Vitest Mux move ${randomBytes(3).toString("hex")}`, category: "FOOT_ANKLE", videoUrl: fields.videoUrl, isPublished: true },
        select: { id: true },
      });
      createdVideoIds.push(video.id);
      return video.id;
    }

    it("saves a playback id Mux confirms is signed, and keeps the CDN address as the record of the file", async () => {
      signInAs("user_staff", { pulseStaff: true });
      asked().mockResolvedValueOnce({ ok: true });
      const id = await cdnVideo();

      expect(await saveVideoAction(null, form({ ...fields, id, muxPlaybackId: playbackId, muxAssetId: "AssetId00AbCdEf" }))).toMatchObject({ ok: expect.any(String) });
      expect(asked()).toHaveBeenCalledWith(playbackId);
      expect(await prisma.video.findUnique({ where: { id }, select: { muxPlaybackId: true, muxAssetId: true, videoUrl: true } })).toEqual({
        muxPlaybackId: playbackId,
        muxAssetId: "AssetId00AbCdEf",
        videoUrl: fields.videoUrl,
      });

      // A save that leaves the id as it was does not ask Mux again, so a slow Mux never stops a title from being corrected.
      asked().mockClear();
      expect(await saveVideoAction(null, form({ ...fields, id, title: "Vitest Total Ankle Replacement (edited)", muxPlaybackId: playbackId }))).toMatchObject({ ok: expect.any(String) });
      expect(asked()).not.toHaveBeenCalled();

      // Clearing the box goes back to the CDN file, with nothing to ask. (The form says what it was showing, as the real one does.)
      expect(await saveVideoAction(null, form({ ...fields, id, muxPlaybackId: "", muxAssetId: "", shownMuxPlaybackId: playbackId, shownMuxAssetId: "AssetId00AbCdEf" }))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUnique({ where: { id }, select: { muxPlaybackId: true, muxAssetId: true } })).toEqual({ muxPlaybackId: null, muxAssetId: null });
      expect(asked()).not.toHaveBeenCalled();
    });

    it("refuses what Mux refuses (public, unknown, not configured, unreachable), in Mux's own words, and writes nothing", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const id = await cdnVideo();
      for (const reason of ["public", "refused", "not-configured", "unreachable"] as const) {
        asked().mockResolvedValueOnce({ ok: false, reason, message: `Refused because ${reason}.` });
        expect(await saveVideoAction(null, form({ ...fields, id, muxPlaybackId: playbackId }))).toEqual({ error: `Refused because ${reason}.` });
      }
      expect(await prisma.video.findUnique({ where: { id }, select: { muxPlaybackId: true } })).toEqual({ muxPlaybackId: null });
    });

    it("refuses a malformed id, and an asset id on its own, before asking Mux", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const id = await cdnVideo();
      expect(await saveVideoAction(null, form({ ...fields, id, muxPlaybackId: "has/slash00" }))).toMatchObject({ error: expect.stringContaining("playback id") });
      expect(await saveVideoAction(null, form({ ...fields, id, muxPlaybackId: "", muxAssetId: "AssetId00AbCdEf" }))).toMatchObject({ error: expect.stringContaining("asset id") });
      expect(asked()).not.toHaveBeenCalled();
    });

    it("refuses a playback id that is already on another video, in plain words", async () => {
      signInAs("user_staff", { pulseStaff: true });
      asked().mockResolvedValue({ ok: true });
      const first = await cdnVideo();
      const second = await cdnVideo();
      const shared = `Vitest${randomBytes(6).toString("hex")}`;
      expect(await saveVideoAction(null, form({ ...fields, id: first, muxPlaybackId: shared }))).toMatchObject({ ok: expect.any(String) });
      expect(await saveVideoAction(null, form({ ...fields, id: second, muxPlaybackId: shared }))).toEqual({
        error: "That playback id is already on another video. Each Mux playback id belongs to one video.",
      });
      expect(await prisma.video.findUnique({ where: { id: second }, select: { muxPlaybackId: true } })).toEqual({ muxPlaybackId: null });
    });

    it("never lets a non-staff user near it, however good the id", async () => {
      signInAs("user_clinic_admin", { kind: "staff" });
      asked().mockResolvedValue({ ok: true });
      await expect(saveVideoAction(null, form({ ...fields, muxPlaybackId: playbackId }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      expect(asked()).not.toHaveBeenCalled();
    });
  });

  describe("the CDN address is optional: a video needs an address OR a Mux id, and one with neither cannot be published", () => {
    const asked = () => vi.mocked(checkPlaybackId);
    const newest = () => prisma.video.findFirst({ where: { title: fields.title }, orderBy: { createdAt: "desc" } });

    it("adds a video with a Mux id and no address, which lives in Mux only", async () => {
      signInAs("user_staff", { pulseStaff: true });
      asked().mockResolvedValueOnce({ ok: true });
      const playbackId = `Vitest${randomBytes(6).toString("hex")}`;
      await expect(saveVideoAction(null, form({ ...fields, videoUrl: "", muxPlaybackId: playbackId }))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      const video = await newest();
      createdVideoIds.push(video!.id);
      expect(video).toMatchObject({ videoUrl: null, muxPlaybackId: playbackId, isPublished: true });
    });

    it("adds a video with an address and no id, as before", async () => {
      signInAs("user_staff", { pulseStaff: true });
      await expect(saveVideoAction(null, form({ ...fields, muxPlaybackId: "" }))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
      const video = await newest();
      createdVideoIds.push(video!.id);
      expect(video).toMatchObject({ videoUrl: fields.videoUrl, muxPlaybackId: null });
    });

    it("refuses a video with neither when it is published, and when it is added with no file to upload either, writing nothing", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const before = await prisma.video.count();
      expect(await saveVideoAction(null, form({ ...fields, videoUrl: "", muxPlaybackId: "" }))).toEqual({
        error: "A video with no file cannot be published. Give it a CDN address or upload a file to Mux first, or untick Published.",
      });
      expect(await saveVideoAction(null, form({ ...fields, videoUrl: "", muxPlaybackId: "", isPublished: "" }))).toEqual({
        error: "Give the video a CDN address, a Mux playback id, or a file to upload. With none of the three there would be nothing to play.",
      });
      expect(await prisma.video.count()).toBe(before);
      expect(asked()).not.toHaveBeenCalled();
    });

    it("adds an unpublished video with neither when a file is about to be uploaded, and answers with the new row's id instead of a redirect", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const result = await saveVideoAction(null, form({ ...fields, videoUrl: "", muxPlaybackId: "", isPublished: "", uploadPending: "1" }));
      expect(result).toMatchObject({ ok: expect.stringContaining("Added"), videoId: expect.any(String) });
      createdVideoIds.push(result!.videoId!);
      expect(await prisma.video.findUnique({ where: { id: result!.videoId! } })).toMatchObject({ videoUrl: null, muxPlaybackId: null, isPublished: false, muxUploadId: null });

      // The file flag does not let a video with neither be published, and does not stand in for a source once the upload is over.
      expect(await saveVideoAction(null, form({ ...fields, videoUrl: "", muxPlaybackId: "", uploadPending: "1" }))).toMatchObject({ error: expect.stringContaining("cannot be published") });
    });

    it("a form drawn before an upload finished keeps what the upload wrote (ids and length), while a box the staff member changed still wins", async () => {
      signInAs("user_staff", { pulseStaff: true });
      asked().mockResolvedValue({ ok: true });
      const playbackId = `Vitest${randomBytes(6).toString("hex")}`;
      // The row as the form was drawn: nothing on it yet.
      const video = await prisma.video.create({ data: { title: `Vitest stale form ${randomBytes(3).toString("hex")}`, category: "KNEE", videoUrl: null, isPublished: false } });
      createdVideoIds.push(video.id);
      // The upload finishes in the background and writes the ids and the length.
      await prisma.video.update({ where: { id: video.id }, data: { muxPlaybackId: playbackId, muxAssetId: "AssetFromUpload0", durationSeconds: 110 } });

      // The stale form is saved with its empty boxes, as it showed them: the upload's values stay, and the video can even be published.
      const stale = { ...fields, id: video.id, videoUrl: "", muxPlaybackId: "", muxAssetId: "", durationSeconds: "", shownMuxPlaybackId: "", shownMuxAssetId: "", shownDurationSeconds: "", notes: "Edited on a stale page" };
      expect(await saveVideoAction(null, form(stale))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUnique({ where: { id: video.id } })).toMatchObject({
        muxPlaybackId: playbackId,
        muxAssetId: "AssetFromUpload0",
        durationSeconds: 110,
        isPublished: true,
        notes: "Edited on a stale page",
      });
      expect(asked()).not.toHaveBeenCalled();

      // A box the staff member changed on purpose still wins: a typed length, and a cleared id (with the video unpublished).
      const fresh = { ...stale, muxPlaybackId: playbackId, muxAssetId: "AssetFromUpload0", shownMuxPlaybackId: playbackId, shownMuxAssetId: "AssetFromUpload0", shownDurationSeconds: "1:50" };
      expect(await saveVideoAction(null, form({ ...fresh, durationSeconds: "3:00" }))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUnique({ where: { id: video.id } })).toMatchObject({ muxPlaybackId: playbackId, durationSeconds: 180 });
      expect(await saveVideoAction(null, form({ ...fresh, isPublished: "", muxPlaybackId: "", muxAssetId: "", shownDurationSeconds: "3:00", durationSeconds: "3:00" }))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUnique({ where: { id: video.id } })).toMatchObject({ muxPlaybackId: null, muxAssetId: null, durationSeconds: 180 });
    });

    it("lets an edit clear a Mux-only video's id (leaving nothing to play) only while it stays unpublished, and never touches an upload in flight", async () => {
      signInAs("user_staff", { pulseStaff: true });
      const playbackId = `Vitest${randomBytes(6).toString("hex")}`;
      const video = await prisma.video.create({
        data: { title: `Vitest Mux-only ${randomBytes(3).toString("hex")}`, category: "FOOT_ANKLE", videoUrl: null, muxPlaybackId: playbackId, isPublished: true, muxUploadId: `Upload${randomBytes(6).toString("hex")}`, muxUploadState: "preparing" },
      });
      createdVideoIds.push(video.id);

      const clearing = { ...fields, id: video.id, videoUrl: "", muxPlaybackId: "", shownMuxPlaybackId: playbackId };
      expect(await saveVideoAction(null, form(clearing))).toMatchObject({ error: expect.stringContaining("cannot be published") });
      expect(await saveVideoAction(null, form({ ...clearing, isPublished: "" }))).toMatchObject({ ok: expect.any(String) });
      expect(await prisma.video.findUnique({ where: { id: video.id } })).toMatchObject({
        videoUrl: null,
        muxPlaybackId: null,
        isPublished: false,
        muxUploadId: video.muxUploadId,
        muxUploadState: "preparing",
      });
    });
  });
});

describe("the upload actions", () => {
  const flow = { start: vi.mocked(startUpload), check: vi.mocked(checkUpload), cancel: vi.mocked(cancelUpload), dismiss: vi.mocked(dismissFailure) };

  beforeEach(() => {
    for (const fn of Object.values(flow)) fn.mockReset();
  });

  it("hands an upload address only to Pulse staff: anyone else gets not-found before Mux is asked", async () => {
    signInAs("user_clinic_admin", { kind: "staff" });
    await expect(startMuxUploadAction("clz0000000000000000000000")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(checkMuxUploadAction("clz0000000000000000000000")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(cancelMuxUploadAction("clz0000000000000000000000")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(dismissUploadFailureAction("clz0000000000000000000000")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    for (const fn of Object.values(flow)) expect(fn).not.toHaveBeenCalled();
  });

  it("starts an upload for staff with this deployment's own origin, never the browser's word, and passes Mux's address straight back", async () => {
    signInAs("user_staff", { pulseStaff: true });
    flow.start.mockResolvedValue({ ok: true, uploadId: "UploadAbc12345", url: "https://storage.googleapis.com/bucket/one-time" });
    expect(await startMuxUploadAction("clz0000000000000000000000")).toEqual({ ok: true, uploadId: "UploadAbc12345", url: "https://storage.googleapis.com/bucket/one-time" });
    expect(flow.start).toHaveBeenCalledWith("clz0000000000000000000000", "http://localhost:3000");
  });

  it("refuses a video id that is not one, before anything is asked, and answers a failure in plain words", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect(await startMuxUploadAction("../../etc")).toEqual({ ok: false, error: "That video no longer exists." });
    expect(await startMuxUploadAction({ id: "x" })).toEqual({ ok: false, error: "That video no longer exists." });
    expect(await checkMuxUploadAction("")).toEqual({ error: "That video no longer exists." });
    expect(flow.start).not.toHaveBeenCalled();
    expect(flow.check).not.toHaveBeenCalled();

    vi.spyOn(console, "error").mockImplementation(() => {});
    flow.start.mockRejectedValue(new Error("fetch failed https://api.mux.com"));
    expect(await startMuxUploadAction("clz0000000000000000000000")).toEqual({ ok: false, error: expect.stringMatching(/^Mux could not be reached/) });
    flow.check.mockRejectedValue(new Error("fetch failed https://api.mux.com"));
    expect(await checkMuxUploadAction("clz0000000000000000000000")).toEqual({ error: expect.stringMatching(/^Mux could not be reached/) });

    // A refused token is a settings problem and is said as one, with the status and never a body.
    flow.start.mockRejectedValue(new MuxApiError(401));
    expect(await startMuxUploadAction("clz0000000000000000000000")).toEqual({ ok: false, error: expect.stringMatching(/refused this deployment's access token \(status 401\)/) });
    flow.check.mockRejectedValue(new MuxApiError(403));
    expect(await checkMuxUploadAction("clz0000000000000000000000")).toEqual({ error: expect.stringMatching(/status 403/) });
  });

  it("turns what the flow said into the line under the button: a failure as an error, the rest as a plain line", async () => {
    signInAs("user_staff", { pulseStaff: true });
    flow.check.mockResolvedValue({ kind: "preparing", message: "Mux is preparing it." });
    expect(await checkMuxUploadAction("clz0000000000000000000000")).toEqual({ ok: "Mux is preparing it." });
    flow.check.mockResolvedValue({ kind: "failed", message: "It failed." });
    expect(await checkMuxUploadAction("clz0000000000000000000000")).toEqual({ error: "It failed." });
    flow.cancel.mockResolvedValue({ kind: "cancelled", message: "Cancelled." });
    expect(await cancelMuxUploadAction("clz0000000000000000000000")).toEqual({ ok: "Cancelled." });
    flow.dismiss.mockResolvedValue(undefined);
    expect(await dismissUploadFailureAction("clz0000000000000000000000")).toEqual({ ok: "Dismissed." });
    expect(flow.dismiss).toHaveBeenCalledWith("clz0000000000000000000000");
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
      config: { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [-1, ...DEFAULT_PRICING_CONFIG.perSeatByCountCents.slice(1)], yearlyMonths: 13 },
      note: "Bad numbers",
    });
    expect(bad).toMatchObject({ error: expect.any(String) });
    expect("fieldErrors" in bad ? bad.fieldErrors?.map((e) => e.field).sort() : []).toEqual(["perSeatByCountCents.0", "yearlyMonths"]);

    expect(await prisma.pricingVersion.count()).toBe(before);
  });

  it("saves a version under the staff member's id and name, then makes it active on request", async () => {
    signInAs("user_staff", { pulseStaff: true });

    const config = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [5900, 9500, 10900, 12500, 13900, 13900] };
    const saved = await savePricingVersionAction({ config, note: "  Two categories to $95  " });
    expect(saved).toMatchObject({ ok: expect.stringContaining("Saved as version"), version: expect.any(Number) });
    if (!("version" in saved)) return;

    const row = await prisma.pricingVersion.findUnique({ where: { version: saved.version } });
    expect(row).not.toBeNull();
    createdVersionIds.push(row!.id);
    expect(row).toMatchObject({ note: "Two categories to $95", createdBy: "user_staff", createdByName: "Evan Miller", active: null });
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

describe("saveCategoryConfigAction, the details boxes", () => {
  const FIELDS = { sellable: true, comingSoonText: true, label: true, slug: true, imageUrl: true, sortOrder: true, formerSlugs: true } as const;
  const details = (changes: Record<string, string>) =>
    form({ category: "SHOULDER", sellable: "on", comingSoonText: "", label: "", slug: "", imageUrl: "", sortOrder: "", ...changes });

  it("refuses a non-staff user before anything is written", async () => {
    signInAs("user_clinic_admin", {});
    const before = await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS });
    await expect(saveCategoryConfigAction(null, details({ label: "Shoulder and Arm", slug: "shoulder-arm" }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS })).toEqual(before);
  });

  it("saves a new name and address for staff, refuses bad boxes in words, and goes back to the defaults when emptied", async () => {
    signInAs("user_staff", { pulseStaff: true });
    await saveCategoryConfigAction(null, details({})); // makes sure the row exists
    const before = await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS });

    try {
      expect(await saveCategoryConfigAction(null, details({ label: "Shoulder and Arm", slug: "vitest-shoulder-arm", sortOrder: "45" }))).toEqual({
        ok: "Saved. This category is for sale.",
      });
      expect(await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS })).toMatchObject({
        label: "Shoulder and Arm",
        slug: "vitest-shoulder-arm",
        sortOrder: 45,
      });

      const now = await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS });
      const bads: Record<string, string>[] = [{ slug: "Shoulder Arm" }, { slug: "knee" }, { slug: "search" }, { imageUrl: "http://example.com/a.jpg" }, { sortOrder: "0" }, { label: "x".repeat(41) }];
      for (const bad of bads) {
        expect(await saveCategoryConfigAction(null, details({ label: "Changed", ...bad }))).toEqual({ error: expect.any(String) });
      }
      // Nothing a refused save carried was written.
      expect(await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS })).toEqual(now);

      expect(await saveCategoryConfigAction(null, details({}))).toEqual({ ok: "Saved. This category is for sale." });
      expect(await prisma.categoryConfig.findUnique({ where: { category: "SHOULDER" }, select: FIELDS })).toMatchObject({
        label: null,
        slug: null,
        sortOrder: null,
        formerSlugs: ["vitest-shoulder-arm"],
      });
    } finally {
      if (before) await prisma.categoryConfig.update({ where: { category: "SHOULDER" }, data: before });
    }
  });
});

describe("addCategoryAction (the + in the Categories panel)", () => {
  const tag = randomBytes(3).toString("hex");
  const added: string[] = [];
  afterAll(async () => {
    await prisma.categoryConfig.deleteMany({ where: { category: { in: added } } });
  });
  const fields = (changes: Record<string, string> = {}) =>
    form({ label: `Vitest Wrist ${tag}`, slug: `vitest-wrist-${tag}`, imageUrl: "", sortOrder: "", ...changes });

  it("refuses a non-staff user before anything is written", async () => {
    signInAs("user_clinic_admin", {});
    const before = await prisma.categoryConfig.count();
    await expect(addCategoryAction(null, fields())).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await prisma.categoryConfig.count()).toBe(before);
  });

  it("adds one for staff, not for sale, and refuses bad or taken boxes in words with nothing written", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const before = await prisma.categoryConfig.count();
    const bads: Record<string, string>[] = [{ label: "" }, { label: "Knee" }, { slug: "" }, { slug: "knee" }, { slug: "Not A Slug" }, { imageUrl: "http://example.com/a.jpg" }, { sortOrder: "0" }];
    for (const bad of bads) expect(await addCategoryAction(null, fields(bad))).toEqual({ error: expect.any(String) });
    expect(await prisma.categoryConfig.count()).toBe(before);

    const result = await addCategoryAction(null, fields());
    expect(result).toMatchObject({ ok: expect.stringContaining("not for sale") });
    const row = await prisma.categoryConfig.findFirst({ where: { slug: `vitest-wrist-${tag}` } });
    if (row) added.push(row.category);
    expect(row).toMatchObject({ label: `Vitest Wrist ${tag}`, sellable: false });

    // The same again is refused: the name and the address are taken now.
    expect(await addCategoryAction(null, fields())).toEqual({ error: expect.stringContaining("already a category") });

    // And the panel will not put it on sale.
    expect(await saveCategoryConfigAction(null, form({ category: row!.category, sellable: "on", comingSoonText: "", label: row!.label!, slug: row!.slug!, imageUrl: "", sortOrder: "" }))).toEqual({
      error: expect.stringContaining("cannot be put on sale yet"),
    });
  });
});

describe("deleteCategoryAction", () => {
  it("refuses a non-staff user, never deletes a starting category, and deletes an unused added one for staff", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const tag = randomBytes(3).toString("hex");
    expect(await addCategoryAction(null, form({ label: `Vitest Gone ${tag}`, slug: `vitest-gone-${tag}`, imageUrl: "", sortOrder: "" }))).toMatchObject({ ok: expect.any(String) });
    const row = await prisma.categoryConfig.findFirst({ where: { slug: `vitest-gone-${tag}` } });
    expect(row).not.toBeNull();
    try {
      signInAs("user_clinic_admin", {});
      await expect(deleteCategoryAction(row!.category)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      expect(await prisma.categoryConfig.findUnique({ where: { category: row!.category } })).not.toBeNull();

      signInAs("user_staff", { pulseStaff: true });
      expect(await deleteCategoryAction("KNEE")).toEqual({ error: expect.stringContaining("never be deleted") });
      expect(await deleteCategoryAction("NOT_A_CATEGORY")).toEqual({ error: "That category no longer exists." });
      expect(await deleteCategoryAction(row!.category)).toEqual({ ok: `Deleted Vitest Gone ${tag}.` });
      expect(await prisma.categoryConfig.findUnique({ where: { category: row!.category } })).toBeNull();
    } finally {
      await prisma.categoryConfig.deleteMany({ where: { category: row!.category } });
    }
  });
});
