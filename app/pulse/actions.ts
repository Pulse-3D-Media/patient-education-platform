"use server";

import { Category, ClinicStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveCategoryConfig } from "@/lib/db/category-config";
import {
  getClinicForPulse,
  setClinicManagedByPulse,
  setClinicPlan,
  setClinicStatusByStaff,
  updateClinicDetails,
} from "@/lib/db/clinics";
import { addClinicNote } from "@/lib/db/notes";
import { PricingError, activatePricingVersion, createPricingVersion } from "@/lib/db/pricing";
import { saveSettings, type Settings } from "@/lib/db/settings";
import { createVideo, getVideoForPulse, updateVideo, type VideoInput } from "@/lib/db/videos";
import { parseDuration } from "@/lib/format";
import { renameClerkOrganization } from "@/lib/organization";
import { normalizeUsPhone } from "@/lib/phone";
import { validatePricingConfig, type FieldError } from "@/lib/pricing";
import { requirePulseStaff } from "@/lib/pulse";

/**
 * Server Actions for the Pulse 3D master dashboard.
 *
 * Every action starts with requirePulseStaff(): anyone who is not Pulse
 * staff gets not-found, exactly as the pages do, before a single value is
 * read. The check is on the server; nothing sent from the browser is
 * trusted, including the clinic id, which is looked up before it is used.
 *
 * Each form action returns a small state object: { ok } with a line to show
 * on success, or { error } with what to fix. The forms show it under the
 * button.
 */

/** What a form gets back after it is submitted. */
export type FormState = { ok?: string; error?: string } | null;

/** The statuses staff may set by hand. PENDING and PAST_DUE are for the app and billing to set. */
const STAFF_STATUSES: ClinicStatus[] = ["ACTIVE", "PAUSED", "CANCELED"];

const ALL_CATEGORIES = Object.values(Category);

/** The longest a notice or reason may be. Keeps the admin banner one line or two. */
const SHORT_TEXT_LIMIT = 300;

/** The longest one note may be. */
const NOTE_LIMIT = 2000;

/** The clinic id from a form, checked to exist. Null means the form was tampered with or the clinic is gone. */
async function clinicFromForm(formData: FormData) {
  const clinicId = String(formData.get("clinicId") ?? "").trim();
  if (!clinicId) return null;
  return getClinicForPulse(clinicId);
}

/** Tell Next.js this clinic's page and the clinics table have changed. */
function refreshClinic(clinicId: string) {
  revalidatePath(`/pulse/clinics/${clinicId}`);
  revalidatePath("/pulse");
}

/** A whole number from a form field, or null when it is not one. */
function wholeNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

/** Set a clinic's status by hand, with a required reason. */
export async function setStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const status = String(formData.get("status") ?? "") as ClinicStatus;
  if (!STAFF_STATUSES.includes(status)) return { error: "Choose Active, Paused or Canceled." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why, in a few words. It is kept with the change." };
  if (reason.length > SHORT_TEXT_LIMIT) return { error: `Keep the reason under ${SHORT_TEXT_LIMIT} characters.` };

  await setClinicStatusByStaff(clinic.id, status, reason, staff.name);
  refreshClinic(clinic.id);
  return { ok: `Status set to ${status.toLowerCase()}.` };
}

/** What a form hears when it was saved with the same values it already had. */
const NOTHING_CHANGED = "Nothing changed, so nothing was saved.";

/** Set which categories a clinic has and how many surgeon seats it pays for. */
export async function setPlanAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const chosen = formData.getAll("categories").map(String);
  const unknown = chosen.filter((value) => !(ALL_CATEGORIES as string[]).includes(value));
  if (unknown.length > 0) return { error: "One of the categories is not one we have." };

  const seats = wholeNumber(formData.get("surgeonSeats"));
  if (seats === null) return { error: "Surgeon seats must be a whole number, 0 or more." };

  const { logged } = await setClinicPlan(clinic.id, chosen as Category[], seats, staff.name);
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  return { ok: `Plan saved: ${chosen.length} ${chosen.length === 1 ? "category" : "categories"}, ${seats} ${seats === 1 ? "seat" : "seats"}.` };
}

/** Turn "managed by Pulse" on or off for a clinic. */
export async function setManagedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  // An unticked checkbox sends nothing; a ticked one sends "on".
  const managed = formData.get("managedByPulse") === "on";
  const { logged } = await setClinicManagedByPulse(clinic.id, managed, staff.name);
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  return { ok: managed ? "This clinic is now managed by Pulse." : "This clinic now manages itself." };
}

/** Save a clinic's name, logo, phone, notice, placeholder setting and view-days override. */
export async function saveDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "The clinic needs a name." };

  const logoText = String(formData.get("logoUrl") ?? "").trim();
  if (logoText && !logoText.startsWith("https://")) return { error: "The logo address must start with https://." };

  const phoneText = String(formData.get("phone") ?? "").trim();
  const phone = phoneText ? normalizeUsPhone(phoneText) : null;
  if (phoneText && !phone) return { error: "That does not look like a US phone number. Ten digits, any format." };

  const notice = String(formData.get("noticeText") ?? "").trim();
  if (notice.length > SHORT_TEXT_LIMIT) return { error: `Keep the notice under ${SHORT_TEXT_LIMIT} characters.` };

  const overrideText = String(formData.get("viewDaysOverride") ?? "").trim();
  let viewDaysOverride: number | null = null;
  if (overrideText) {
    viewDaysOverride = wholeNumber(overrideText);
    if (viewDaysOverride === null || viewDaysOverride < 1 || viewDaysOverride > 365) {
      return { error: "View days must be a whole number from 1 to 365, or left empty to use the platform setting." };
    }
  }

  // The name is copied from the Clerk organization on every sign-in, so a
  // renamed clinic has to be renamed there too or it would change back.
  if (clinic.clerkOrgId && name !== clinic.name) {
    try {
      await renameClerkOrganization(clinic.clerkOrgId, name);
    } catch {
      return { error: "Could not rename the clinic in Clerk, so nothing was saved. Try again in a moment." };
    }
  }

  const { logged } = await updateClinicDetails(
    clinic.id,
    {
      name,
      logoUrl: logoText || null,
      phone,
      noticeText: notice || null,
      showPlaceholders: formData.get("showPlaceholders") === "on",
      viewDaysOverride,
    },
    staff.name,
  );
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  return { ok: "Details saved." };
}

/** Add one entry to a clinic's log, under the signed-in staff member's name. */
export async function addNoteAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Type the note first." };
  if (body.length > NOTE_LIMIT) return { error: `Keep a note under ${NOTE_LIMIT} characters.` };

  await addClinicNote(clinic.id, { kind: "STAFF", body, authorName: staff.name });
  revalidatePath(`/pulse/clinics/${clinic.id}`);
  return { ok: "Note added." };
}

/** Save the four platform settings. Each must be a whole number, at least 1. */
export async function saveSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const fields: (keyof Settings)[] = ["unclaimedDays", "viewDays", "graceDays", "qrDailyFlag"];
  const values: Partial<Settings> = {};
  for (const field of fields) {
    const value = wholeNumber(formData.get(field));
    if (value === null || value < 1) return { error: `${LABELS[field]} must be a whole number, at least 1.` };
    values[field] = value;
  }

  await saveSettings(values as Settings);
  revalidatePath("/pulse/settings");
  return { ok: "Settings saved." };
}

/** The names the settings form uses, for its error messages. */
const LABELS: Record<keyof Settings, string> = {
  unclaimedDays: "Unclaimed link days",
  viewDays: "Days after first view",
  graceDays: "Grace days",
  qrDailyFlag: "QR scans per day to flag",
};

// ---------------------------------------------------------------------------
// The catalogue (/pulse/videos): videos and the categories panel.
// ---------------------------------------------------------------------------

/** The longest a title may be. */
const TITLE_LIMIT = 120;

/** The longest the internal notes on a video may be. */
const VIDEO_NOTES_LIMIT = 2000;

/** A web address a browser can load without a warning: https and nothing else. */
function isHttpsUrl(text: string) {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Read a video's fields out of the form and check them. Returns the values
 * to save, or the sentence to show the staff member.
 */
function videoFromForm(formData: FormData): { input: VideoInput } | { error: string } {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "The video needs a title: the procedure name a surgeon would look for." };
  if (title.length > TITLE_LIMIT) return { error: `Keep the title under ${TITLE_LIMIT} characters.` };

  const category = String(formData.get("category") ?? "") as Category;
  if (!ALL_CATEGORIES.includes(category)) return { error: "Choose one of our categories." };

  const videoUrl = String(formData.get("videoUrl") ?? "").trim();
  if (!isHttpsUrl(videoUrl)) return { error: "The video address must be a full https:// address." };

  const durationSeconds = parseDuration(String(formData.get("durationSeconds") ?? ""));
  if (durationSeconds === undefined) return { error: "Type the length as minutes and seconds, like 4:12, or leave it empty." };

  const posterText = String(formData.get("posterUrl") ?? "").trim();
  if (posterText && !isHttpsUrl(posterText)) return { error: "The poster address must be a full https:// address, or empty." };

  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > VIDEO_NOTES_LIMIT) return { error: `Keep the notes under ${VIDEO_NOTES_LIMIT} characters.` };

  return {
    input: {
      title,
      category,
      videoUrl,
      durationSeconds,
      posterUrl: posterText || null,
      // An unticked checkbox sends nothing; a ticked one sends "on".
      isPlaceholder: formData.get("isPlaceholder") === "on",
      isPublished: formData.get("isPublished") === "on",
      notes: notes || null,
    },
  };
}

/** Tell Next.js the catalogue changed, wherever it is shown. */
function refreshCatalogue(videoId?: string) {
  revalidatePath("/pulse/videos");
  if (videoId) revalidatePath(`/pulse/videos/${videoId}`);
  revalidatePath("/library");
  revalidatePath("/admin");
}

/**
 * Add a video, or change one in place. The form carries the video's id in a
 * hidden field when it is editing; an empty id means "add". Editing keeps
 * the same row, so every share link and QR code already pointing at it
 * keeps working. A new video is sent on to its own page once saved.
 */
export async function saveVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const checked = videoFromForm(formData);
  if ("error" in checked) return checked;

  const id = String(formData.get("id") ?? "").trim();
  if (id) {
    const existing = await getVideoForPulse(id);
    if (!existing) return { error: "That video no longer exists." };
    await updateVideo(id, checked.input);
    refreshCatalogue(id);
    return { ok: "Saved. Every link that points at this video plays the new version." };
  }

  const video = await createVideo(checked.input);
  refreshCatalogue(video.id);
  redirect(`/pulse/videos/${video.id}?added=1`);
}

/** Save one category's "for sale" switch and its coming-soon sentence. */
export async function saveCategoryConfigAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const category = String(formData.get("category") ?? "") as Category;
  if (!ALL_CATEGORIES.includes(category)) return { error: "That is not one of our categories." };

  const text = String(formData.get("comingSoonText") ?? "").trim();
  if (text.length > SHORT_TEXT_LIMIT) return { error: `Keep the sentence under ${SHORT_TEXT_LIMIT} characters.` };

  const saved = await saveCategoryConfig(category, {
    sellable: formData.get("sellable") === "on",
    comingSoonText: text || null,
  });
  refreshCatalogue();
  return { ok: saved.sellable ? "Saved. This category is for sale." : "Saved. This category is not for sale." };
}

// ---------------------------------------------------------------------------
// Pricing (/pulse/pricing): saving a version and making one active.
// ---------------------------------------------------------------------------

/** The longest a version note may be. */
const VERSION_NOTE_LIMIT = 300;

/** What the pricing editor gets back after "Save as a new version". */
export type PricingSaveResult =
  | { ok: string; version: number }
  | { error: string; fieldErrors?: FieldError[] };

/** Tell Next.js the prices changed: the pricing page, and every admin console's plan card. */
function refreshPricing() {
  revalidatePath("/pulse/pricing");
  revalidatePath("/admin");
}

/**
 * Save the editor's numbers as a new pricing version. The browser already
 * checked them; they are checked again here, and the errors go back beside
 * the fields. The draft in the editor is never cleared by this: a failed
 * save leaves the numbers exactly as typed. Saving does not make the new
 * version active; that is its own action below.
 */
export async function savePricingVersionAction(input: { config: unknown; note: unknown }): Promise<PricingSaveResult> {
  const staff = await requirePulseStaff();

  const note = String(input.note ?? "").trim();
  if (!note) return { error: "Say what changed and why. The note is kept with the version." };
  if (note.length > VERSION_NOTE_LIMIT) return { error: `Keep the note under ${VERSION_NOTE_LIMIT} characters.` };

  const checked = validatePricingConfig(input.config);
  if (!checked.ok) return { error: "Some of the numbers are not right. See the fields marked below.", fieldErrors: checked.errors };

  const version = await createPricingVersion(checked.config, note, staff);
  refreshPricing();
  return { ok: `Saved as version ${version.version}. It is not active until you make it active.`, version: version.version };
}

/** Make one saved version the active one. The version's id comes from the history list. */
export async function activatePricingVersionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const versionId = String(formData.get("versionId") ?? "").trim();
  if (!versionId) return { error: "Choose a version to make active." };

  try {
    const version = await activatePricingVersion(versionId);
    refreshPricing();
    return { ok: `Version ${version.version} is now active.` };
  } catch (error) {
    if (error instanceof PricingError) return { error: error.message };
    throw error;
  }
}
