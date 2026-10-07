"use server";

import { Category, PracticeType, type StaffAccess } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { retryBillingEvent } from "@/lib/billing-events";
import { MAX_GRACE_DAYS, MIN_GRACE_DAYS } from "@/lib/billing-state";
import { saveCategoryConfig } from "@/lib/db/category-config";
import { readBrandingForm, readLogoField } from "@/lib/branding-form";
import {
  PlanSeatsRefusedError,
  getClinicForPulse,
  setClinicManagedByPulse,
  setClinicPlan,
  setClinicPracticeType,
  setClinicStatusByStaff,
  updateClinicBranding,
  updateClinicDetails,
} from "@/lib/db/clinics";
import { addClinicNote } from "@/lib/db/notes";
import { PricingError, activatePricingVersion, createPricingVersion } from "@/lib/db/pricing";
import { saveSettings, type Settings } from "@/lib/db/settings";
import { createVideo, getVideoForPulse, updateVideo, type VideoInput } from "@/lib/db/videos";
import { errorKind } from "@/lib/error-kind";
import { isValidRenewalCount, MAX_LINK_DAYS, MAX_RENEWALS, MIN_LINK_DAYS, MIN_RENEWALS } from "@/lib/expiry";
import { parseDuration } from "@/lib/format";
import { MuxApiError, checkPlaybackId } from "@/lib/mux";
import { cancelUpload, checkUpload, dismissFailure, startUpload, type ReconcileOutcome, type StartUploadResult } from "@/lib/mux-uploads";
import { NOTE_MAX_LENGTH, cleanNote } from "@/lib/note-form";
import { renameClerkOrganization } from "@/lib/organization";
import { isPlaybackIdShape } from "@/lib/playback-source";
import { validatePricingConfig, type FieldError } from "@/lib/pricing";
import { requirePulseStaff } from "@/lib/pulse";
import { setOwnerByStaff } from "@/lib/seat-changes";
import { pickTrustedOrigin } from "@/lib/trusted-origin";
import { hasPlayableSource } from "@/lib/video";

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

/** What a form gets back after it is submitted. `videoId` comes back only from the add-video form when a file is waiting to be uploaded (see saveVideoAction). */
export type FormState = { ok?: string; error?: string; videoId?: string } | null;

/**
 * What staff may set by hand, as the Status form sends it. OPEN, PAUSED and
 * CANCELED are hand settings that win over billing; FOLLOW removes the hand
 * setting so the clinic's access follows its billing again. Pending and
 * Past due are never set by hand: they are what the rules work out.
 */
const STAFF_CHOICES: Record<string, StaffAccess | null> = { OPEN: "OPEN", PAUSED: "PAUSED", CANCELED: "CANCELED", FOLLOW: null };

/** Said wherever staff close or take over a clinic whose card may still be charged. Hiding billing stops nothing in Stripe. */
const STILL_CHARGING =
  " This clinic has a card subscription in Stripe, and this did not cancel it: the card keeps being charged until the subscription is cancelled in Stripe.";

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

/**
 * Tell Next.js that what a clinic's own screens look like has changed. The
 * library's frame is a layout, which the browser otherwise keeps between
 * pages, so it is named as one. The patient page is always drawn fresh and
 * needs no telling.
 */
function refreshClinicScreens() {
  revalidatePath("/library", "layout");
  revalidatePath("/admin", "layout");
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

  const choice = String(formData.get("status") ?? "");
  if (!Object.hasOwn(STAFF_CHOICES, choice)) return { error: "Choose Open, Paused, Canceled or Follow billing." };
  const staffAccess = STAFF_CHOICES[choice];

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why, in a few words. It is kept with the change." };
  if (reason.length > SHORT_TEXT_LIMIT) return { error: `Keep the reason under ${SHORT_TEXT_LIMIT} characters.` };

  const change = await setClinicStatusByStaff(clinic.id, staffAccess, reason, staff.name);
  refreshClinic(clinic.id);
  refreshClinicScreens();
  const now = change.clinic.status.toLowerCase().replace("_", " ");
  const said = staffAccess ? `Set by hand. The clinic's status is now ${now}.` : `Hand setting removed. The clinic follows billing; its status is now ${now}.`;
  return { ok: said + (change.stillCharging ? STILL_CHARGING : "") };
}

/** Record what kind of practice a clinic is. A hospital is always Enterprise and is never offered card checkout. */
export async function setPracticeTypeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const value = String(formData.get("practiceType") ?? "");
  if (!(Object.values(PracticeType) as string[]).includes(value)) return { error: "Choose one of the three." };

  const { logged } = await setClinicPracticeType(clinic.id, value as PracticeType, staff.name);
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  return { ok: "Practice type saved." };
}

/**
 * Try a billing notification again, from /pulse/billing. It asks Stripe
 * where the subscription stands now and applies that, exactly as a fresh
 * delivery from Stripe would. Safe to press twice: a notification that is
 * already finished is left alone.
 */
export async function retryBillingEventAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const id = String(formData.get("eventId") ?? "").trim();
  if (!id) return { error: "That notification no longer exists." };

  try {
    const result = await retryBillingEvent(id);
    revalidatePath("/pulse/billing");
    if (!result) return { error: "That notification no longer exists." };
    if (result.status === "duplicate") return { ok: "Already finished. Nothing more to do." };
    return { ok: result.outcome || "Done." };
  } catch {
    // The kind of failure is on the row and in the server log (lib/billing-events.ts).
    revalidatePath("/pulse/billing");
    return { error: "It failed again. The kind of error is shown on the row. Stripe or the database may be unreachable; try later." };
  }
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

  // Fewer seats than are in use is refused unless this box was ticked. It is
  // an explicit, logged override, never a default: nobody is relabelled and
  // no charge is changed, but the clinic is then over its plan.
  const allowFewerSeatsThanInUse = formData.get("allowFewerSeats") === "on";

  let logged: string | null;
  try {
    ({ logged } = await setClinicPlan(clinic.id, chosen as Category[], seats, staff.name, { allowFewerSeatsThanInUse }));
  } catch (error) {
    if (error instanceof PlanSeatsRefusedError) return { error: error.message };
    throw error;
  }
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  const saved = `Plan saved: ${chosen.length} ${chosen.length === 1 ? "category" : "categories"}, ${seats} ${seats === 1 ? "seat" : "seats"}.`;
  return { ok: logged.includes("more than the") ? `${saved} This clinic now has more surgeons holding a seat than its plan pays for; see the People tab.` : saved };
}

/** Turn "managed by Pulse" on or off for a clinic. */
export async function setManagedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  // An unticked checkbox sends nothing; a ticked one sends "on".
  const managed = formData.get("managedByPulse") === "on";
  const { logged, stillCharging } = await setClinicManagedByPulse(clinic.id, managed, staff.name);
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  refreshClinicScreens();
  return { ok: (managed ? "This clinic is now managed by Pulse." : "This clinic now manages itself.") + (stillCharging ? STILL_CHARGING : "") };
}

/**
 * Make one current member of a clinic its account owner: the backup for an
 * owner who left without handing over, or a clinic made before owners
 * existed. lib/seat-changes.ts checks with Clerk that the person is in THIS
 * clinic, makes them an admin if they are not one, and logs it under the
 * staff member's name. Seats are not changed.
 */
export async function setOwnerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const userId = String(formData.get("ownerUserId") ?? "").trim();
  if (!userId) return { error: "Choose a person." };

  try {
    const outcome = await setOwnerByStaff({ clinicId: clinic.id, toUserId: userId, staffName: staff.name });
    if (!outcome.ok) return { error: outcome.message };
    refreshClinic(clinic.id);
    return { ok: outcome.message ?? "Saved." };
  } catch (error) {
    console.error("Pulse: the account owner could not be set", error instanceof Error ? error.name : "unknown error");
    return { error: "That could not be saved just now. Nothing was changed. Try again in a moment." };
  }
}

/** Save a clinic's name, notice, placeholder setting and view-days override. (Its logo and phone are branding: see saveBrandingAction.) */
export async function saveDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "The clinic needs a name." };

  const notice = String(formData.get("noticeText") ?? "").trim();
  if (notice.length > SHORT_TEXT_LIMIT) return { error: `Keep the notice under ${SHORT_TEXT_LIMIT} characters.` };

  const overrideText = String(formData.get("viewDaysOverride") ?? "").trim();
  let viewDaysOverride: number | null = null;
  if (overrideText) {
    viewDaysOverride = wholeNumber(overrideText);
    if (viewDaysOverride === null || viewDaysOverride < MIN_LINK_DAYS || viewDaysOverride > MAX_LINK_DAYS) {
      return { error: `View days must be a whole number from ${MIN_LINK_DAYS} to ${MAX_LINK_DAYS}, or left empty to use the platform setting.` };
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

/**
 * Save a clinic's branding from the Branding tab: its logo address, phone,
 * brand colour and font. The clinic's own admin can change the last three
 * too (app/admin/branding); both saves go through updateClinicBranding, so
 * both are logged and the last one wins. Only this one can set a logo
 * address, because a Pulse-set logo is an address Pulse staff have looked at
 * and approved; a clinic's own logo is the one it uploads to Clerk.
 */
export async function saveBrandingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  const checked = readBrandingForm(formData);
  if ("error" in checked) return checked;
  const logo = readLogoField(formData);
  if ("error" in logo) return logo;

  const { logged } = await updateClinicBranding(clinic.id, { ...checked.values, logoUrl: logo.logoUrl }, staff.name);
  if (!logged) return { ok: NOTHING_CHANGED };
  refreshClinic(clinic.id);
  refreshClinicScreens();
  return { ok: "Branding saved. The clinic and its patients see it from their next page load." };
}

/** Add one entry to a clinic's log, under the signed-in staff member's name. */
export async function addNoteAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePulseStaff();

  const clinic = await clinicFromForm(formData);
  if (!clinic) return { error: "That clinic no longer exists." };

  // Measured the way the box counts it: a line break is one character (see cleanNote).
  const body = cleanNote(String(formData.get("body") ?? ""));
  if (!body) return { error: "Type the note first." };
  if (body.length > NOTE_MAX_LENGTH) return { error: `Keep a note to ${NOTE_MAX_LENGTH} characters or fewer.` };

  await addClinicNote(clinic.id, { kind: "STAFF", body, authorName: staff.name });
  revalidatePath(`/pulse/clinics/${clinic.id}`);
  return { ok: "Note added." };
}

/** The two settings that become link deadlines. They may not exceed a year (MAX_LINK_DAYS), the limit the clinic override already has. */
const DAY_LIMITED: (keyof Settings)[] = ["unclaimedDays", "viewDays"];

/** Save the five platform settings. Each must be a whole number: at least 1, the two day counts no more than a year, the renewal count from 0 to 10. */
export async function saveSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const fields: (keyof Settings)[] = ["unclaimedDays", "viewDays", "graceDays", "qrDailyFlag", "maxRenewals"];
  const values: Partial<Settings> = {};
  for (const field of fields) {
    const value = wholeNumber(formData.get(field));
    // The renewal count is the one setting that may be zero (no link can ever be turned back on); the rule refuses anything past ten.
    if (field === "maxRenewals") {
      if (value === null || !isValidRenewalCount(value)) {
        return { error: `${LABELS[field]} must be a whole number from ${MIN_RENEWALS} to ${MAX_RENEWALS}.` };
      }
      values[field] = value;
      continue;
    }
    if (value === null || value < 1) return { error: `${LABELS[field]} must be a whole number, at least 1.` };
    if (DAY_LIMITED.includes(field) && value > MAX_LINK_DAYS) {
      return { error: `${LABELS[field]} must be a whole number of days from ${MIN_LINK_DAYS} to ${MAX_LINK_DAYS}.` };
    }
    // The grace period becomes a deadline too (lib/billing-state.ts refuses anything outside these limits).
    if (field === "graceDays" && value > MAX_GRACE_DAYS) {
      return { error: `${LABELS[field]} must be a whole number of days from ${MIN_GRACE_DAYS} to ${MAX_GRACE_DAYS}.` };
    }
    values[field] = value;
  }

  await saveSettings(values as Settings);
  revalidatePath("/pulse/settings");
  return { ok: "Settings saved." };
}

/** The names the settings form uses, for its error messages. */
const LABELS: Record<keyof Settings, string> = {
  unclaimedDays: "Unclaimed link days",
  viewDays: "Days after first play",
  graceDays: "Grace days",
  qrDailyFlag: "QR scans per day to flag",
  maxRenewals: "Maximum renewals",
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

/** The three boxes an upload fills in on its own, as the row has them now. Handed to videoFromForm when editing. */
type UploadWrittenFields = Pick<VideoInput, "muxPlaybackId" | "muxAssetId" | "durationSeconds">;

/**
 * Read a video's fields out of the form and check them. Returns the values
 * to save, or the sentence to show the staff member.
 *
 * When editing, `existing` is the row as it is now. Three boxes (the Mux
 * playback id, the asset id and the length) are also written by an upload
 * finishing in the background, so a form drawn before that moment shows
 * them empty. For each of those, if the staff member did not change the
 * box (what was sent equals what the form was showing, in the hidden
 * `shown...` fields), the row's current value is kept; a value the staff
 * member typed or cleared on purpose still wins. Without this a stale form
 * would wipe what the upload wrote.
 */
function videoFromForm(formData: FormData, existing: UploadWrittenFields | null = null): { input: VideoInput } | { error: string } {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "The video needs a title: the procedure name a surgeon would look for." };
  if (title.length > TITLE_LIMIT) return { error: `Keep the title under ${TITLE_LIMIT} characters.` };

  const category = String(formData.get("category") ?? "") as Category;
  if (!ALL_CATEGORIES.includes(category)) return { error: "Choose one of our categories." };

  // The CDN address is optional since October 2026: a video uploaded to Mux from the app has none.
  const videoUrl = String(formData.get("videoUrl") ?? "").trim();
  if (videoUrl && !isHttpsUrl(videoUrl)) return { error: "The video address must be a full https:// address, or empty for a video that lives in Mux." };

  const durationSeconds = parseDuration(String(formData.get("durationSeconds") ?? ""));
  if (durationSeconds === undefined) return { error: "Type the length as minutes and seconds, like 4:12, or leave it empty." };

  const posterText = String(formData.get("posterUrl") ?? "").trim();
  if (posterText && !isHttpsUrl(posterText)) return { error: "The poster address must be a full https:// address, or empty." };

  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > VIDEO_NOTES_LIMIT) return { error: `Keep the notes under ${VIDEO_NOTES_LIMIT} characters.` };

  // The Mux fields. The id's shape is checked here; whether Mux knows it, and
  // whether its policy is signed, is checked against Mux in saveVideoAction.
  const muxPlaybackId = String(formData.get("muxPlaybackId") ?? "").trim();
  if (muxPlaybackId && !isPlaybackIdShape(muxPlaybackId)) {
    return { error: "That does not look like a Mux playback id. Copy it from the asset's page in the Mux dashboard, or leave the box empty." };
  }
  const muxAssetId = String(formData.get("muxAssetId") ?? "").trim();
  if (muxAssetId && !isPlaybackIdShape(muxAssetId)) return { error: "That does not look like a Mux asset id. Copy it from the Mux dashboard, or leave the box empty." };
  if (muxAssetId && !muxPlaybackId) return { error: "An asset id on its own plays nothing. Add the signed playback id too, or leave both empty." };

  const input: VideoInput = {
    title,
    category,
    videoUrl: videoUrl || null,
    durationSeconds,
    posterUrl: posterText || null,
    // An unticked checkbox sends nothing; a ticked one sends "on".
    isPlaceholder: formData.get("isPlaceholder") === "on",
    isPublished: formData.get("isPublished") === "on",
    notes: notes || null,
    muxPlaybackId: muxPlaybackId || null,
    muxAssetId: muxAssetId || null,
  };

  // Keep what an upload wrote where the staff member left the box as the form showed it.
  if (existing) {
    const unchanged = (name: string, sent: string) => String(formData.get(name) ?? "").trim() === sent;
    if (unchanged("shownMuxPlaybackId", muxPlaybackId)) {
      input.muxPlaybackId = existing.muxPlaybackId;
      // The asset id belongs with the playback id: keep both together unless the asset box itself was changed.
      if (unchanged("shownMuxAssetId", muxAssetId)) input.muxAssetId = existing.muxAssetId;
    }
    if (unchanged("shownDurationSeconds", String(formData.get("durationSeconds") ?? "").trim()) && existing.durationSeconds !== null) {
      input.durationSeconds = existing.durationSeconds;
    }
  }

  // A video must have something to play before it is published: a CDN
  // address or a Mux playback id. One with neither may be saved (its file is
  // on its way to Mux, or its id was just cleared) but stays unpublished.
  if (input.isPublished && !hasPlayableSource(input)) {
    return { error: "A video with no file cannot be published. Give it a CDN address or upload a file to Mux first, or untick Published." };
  }
  return { input };
}

/**
 * A playback id is saved only once Mux has been asked about it (lib/mux.ts):
 * it must have the signed policy, and the key on this deployment must open
 * it. Asked when an id is first put on a video or changed; a save that
 * leaves the id as it was does not ask again, so a slow Mux never stops a
 * title from being corrected. Without Mux configured here the id is refused:
 * a video marked as moved would then play for nobody.
 */
async function checkMuxBeforeSave(input: VideoInput, existing: { muxPlaybackId: string | null } | null): Promise<string | null> {
  if (!input.muxPlaybackId || input.muxPlaybackId === existing?.muxPlaybackId) return null;
  const check = await checkPlaybackId(input.muxPlaybackId);
  return check.ok ? null : check.message;
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
 *
 * The one exception to that redirect: the add form with a file chosen for
 * upload sends `uploadPending`, and gets the new row's id back instead, so
 * the browser can start the upload for that row (the file never passes
 * through the server) and then go to the video's page itself. A video added
 * with no address, no playback id and no file to upload is refused: there
 * would be nothing to ever play.
 */
export async function saveVideoAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePulseStaff();

  const id = String(formData.get("id") ?? "").trim();
  const uploadPending = formData.get("uploadPending") === "1";
  try {
    if (id) {
      // The row as it is now is read first, so the form's boxes can be compared with what an upload may have written since the page was drawn.
      const existing = await getVideoForPulse(id);
      if (!existing) return { error: "That video no longer exists." };
      const checked = videoFromForm(formData, existing);
      if ("error" in checked) return checked;
      const refused = await checkMuxBeforeSave(checked.input, existing);
      if (refused) return { error: refused };
      await updateVideo(id, checked.input);
      refreshCatalogue(id);
      return { ok: "Saved. Every link that points at this video plays the new version." };
    }

    const checked = videoFromForm(formData);
    if ("error" in checked) return checked;
    if (!hasPlayableSource(checked.input) && !uploadPending) {
      return { error: "Give the video a CDN address, a Mux playback id, or a file to upload. With none of the three there would be nothing to play." };
    }
    const refused = await checkMuxBeforeSave(checked.input, null);
    if (refused) return { error: refused };
    const video = await createVideo(checked.input);
    refreshCatalogue(video.id);
    if (uploadPending) return { ok: "Added. Sending the file to Mux...", videoId: video.id };
    redirect(`/pulse/videos/${video.id}?added=1`);
  } catch (error) {
    // One playback id belongs to one video: the unique column refuses a second row with it (Prisma P2002).
    if (errorKind(error) === "Prisma P2002") return { error: "That playback id is already on another video. Each Mux playback id belongs to one video." };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Uploading a video to Mux from a video's page (lib/mux-uploads.ts). Not
// form actions: the upload control calls them directly. Each one checks for
// Pulse staff first, reads nothing from the browser but a video id (looked
// up before it is used), and answers in plain words. The file itself never
// comes here: the browser sends it straight to the one-time address Mux
// gives, which the server hands out once and never logs.
// ---------------------------------------------------------------------------

/** A video id as the browser sends it, or null for anything that is not one. */
function readVideoId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9]{10,40}$/i.test(value) ? value : null;
}

/** Turn what the flow said into the line the page shows. A failure is logged by kind and answered in words. */
function uploadOutcome(work: () => Promise<ReconcileOutcome>): Promise<FormState> {
  return work()
    .then((outcome) => (outcome.kind === "failed" || outcome.kind === "unknown" || outcome.kind === "not-confirmed" ? { error: outcome.message } : { ok: outcome.message }))
    .catch((error: unknown) => {
      console.error(`Mux upload: ${errorKind(error)}`);
      return { error: muxFailureWords(error) };
    });
}

/** What to say when a call to Mux failed: a refused token is a settings problem, anything else is "try again". The status only, never a body. */
function muxFailureWords(error: unknown): string {
  if (error instanceof MuxApiError && (error.status === 401 || error.status === 403)) {
    return `Mux refused this deployment's access token (status ${error.status}). Nothing was changed. Check MUX_TOKEN_ID and MUX_TOKEN_SECRET in the settings.`;
  }
  return "Mux could not be reached just now. Nothing was changed. Try again in a moment.";
}

/**
 * Begin an upload: ask Mux for a one-time address for this video's new file
 * and hand it to the browser. The address Mux lets the file come from is
 * this deployment's own (pickTrustedOrigin), never the Host header as sent.
 */
export async function startMuxUploadAction(videoId: unknown): Promise<StartUploadResult> {
  await requirePulseStaff();
  const id = readVideoId(videoId);
  if (!id) return { ok: false, error: "That video no longer exists." };
  try {
    const origin = pickTrustedOrigin((await headers()).get("host"), process.env);
    if (!origin) return { ok: false, error: "Uploads cannot be started from this address." };
    const result = await startUpload(id, origin);
    if (result.ok) refreshCatalogue(id);
    return result;
  } catch (error) {
    console.error(`Mux upload: could not start: ${errorKind(error)}`);
    return { ok: false, error: muxFailureWords(error) };
  }
}

/** "Check with Mux", and what the browser calls once it has sent the file: ask Mux where the upload stands and apply it. */
export async function checkMuxUploadAction(videoId: unknown): Promise<FormState> {
  await requirePulseStaff();
  const id = readVideoId(videoId);
  if (!id) return { error: "That video no longer exists." };
  const outcome = await uploadOutcome(() => checkUpload(id));
  refreshCatalogue(id);
  return outcome;
}

/** "Cancel upload": an upload whose file has not arrived is cancelled at Mux and forgotten; the video is as it was. */
export async function cancelMuxUploadAction(videoId: unknown): Promise<FormState> {
  await requirePulseStaff();
  const id = readVideoId(videoId);
  if (!id) return { error: "That video no longer exists." };
  const outcome = await uploadOutcome(() => cancelUpload(id));
  refreshCatalogue(id);
  return outcome;
}

/** "Dismiss" on the line about a failed upload. */
export async function dismissUploadFailureAction(videoId: unknown): Promise<FormState> {
  await requirePulseStaff();
  const id = readVideoId(videoId);
  if (!id) return { error: "That video no longer exists." };
  await dismissFailure(id);
  refreshCatalogue(id);
  return { ok: "Dismissed." };
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

/**
 * Tell Next.js the prices changed. Only the pricing page shows them today;
 * when the clinic-facing billing page (/admin/billing, the admin-dashboard
 * work) quotes from them, add it here.
 */
function refreshPricing() {
  revalidatePath("/pulse/pricing");
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
