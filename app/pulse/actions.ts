"use server";

import { Category, ClinicStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  getClinicForPulse,
  setClinicManagedByPulse,
  setClinicNotes,
  setClinicPlan,
  setClinicStatusByStaff,
  updateClinicDetails,
} from "@/lib/db/clinics";
import { saveSettings, type Settings } from "@/lib/db/settings";
import { renameClerkOrganization } from "@/lib/organization";
import { normalizeUsPhone } from "@/lib/phone";
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

/** Set which categories a clinic has and how many surgeon seats it pays for. */
export async function setPlanAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const chosen = formData.getAll("categories").map(String);
  const unknown = chosen.filter((value) => !(ALL_CATEGORIES as string[]).includes(value));
  if (unknown.length > 0) return { error: "One of the categories is not one we have." };

  const seats = wholeNumber(formData.get("surgeonSeats"));
  if (seats === null) return { error: "Surgeon seats must be a whole number, 0 or more." };

  await setClinicPlan(clinic.id, chosen as Category[], seats);
  refreshClinic(clinic.id);
  return { ok: `Plan saved: ${chosen.length} ${chosen.length === 1 ? "category" : "categories"}, ${seats} ${seats === 1 ? "seat" : "seats"}.` };
}

/** Turn "managed by Pulse" on or off for a clinic. */
export async function setManagedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  // An unticked checkbox sends nothing; a ticked one sends "on".
  const managed = formData.get("managedByPulse") === "on";
  await setClinicManagedByPulse(clinic.id, managed);
  refreshClinic(clinic.id);
  return { ok: managed ? "This clinic is now managed by Pulse." : "This clinic now manages itself." };
}

/** Save a clinic's name, logo, phone, notice, placeholder setting and view-days override. */
export async function saveDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

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

  await updateClinicDetails(clinic.id, {
    name,
    logoUrl: logoText || null,
    phone,
    noticeText: notice || null,
    showPlaceholders: formData.get("showPlaceholders") === "on",
    viewDaysOverride,
  });
  refreshClinic(clinic.id);
  return { ok: "Details saved." };
}

/** What the notes box gets back after a blur: when it saved, or what went wrong. */
export type NotesState = { savedAt?: string; error?: string };

/** Save the internal notes on a clinic. Called when the notes box loses focus. */
export async function saveNotesAction(clinicId: unknown, notes: unknown): Promise<NotesState> {
  await requirePulseStaff();

  const id = typeof clinicId === "string" ? clinicId.trim() : "";
  const clinic = id ? await getClinicForPulse(id) : null;
  if (!clinic) return { error: "That clinic no longer exists." };

  const text = typeof notes === "string" ? notes.trim() : "";
  await setClinicNotes(clinic.id, text || null);
  revalidatePath(`/pulse/clinics/${clinic.id}`);
  return { savedAt: new Date().toISOString() };
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
