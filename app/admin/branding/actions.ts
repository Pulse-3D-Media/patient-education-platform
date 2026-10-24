"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { readBrandingForm } from "@/lib/branding-form";
import { getCurrentClinicId } from "@/lib/clinic";
import { checkLogoBytes, checkLogoSize, LOGO_MISSING, readClinicName } from "@/lib/clinic-identity";
import { getClerkOrgIdForClinic, recordClinicName, recordUploadedLogo, updateClinicBranding } from "@/lib/db/clinics";
import { errorKind } from "@/lib/error-kind";
import { renameClerkOrganization, uploadClerkOrganizationLogo } from "@/lib/organization";
import { getSignedInName } from "@/lib/people";
import { isClinicAdmin } from "@/lib/roles";

/**
 * The Server Actions behind the clinic's own Branding page: its name and
 * logo (saveClinicNameAction, uploadClinicLogoAction), and its phone, brand
 * colour and font (saveClinicBrandingAction).
 *
 * Who may save, and for which clinic, is decided here on the server, from
 * the session and nothing else:
 *
 *   - only an office admin (org:admin). A member who calls one of these gets
 *     a plain sentence and nothing is written;
 *   - the clinic is the signed-in person's own, from getCurrentClinicId().
 *     The forms carry no clinic id, and if one is added, it is never read,
 *     so one clinic cannot restyle or rename another. The Clerk organization
 *     the name and logo are written to is read from that clinic's own row;
 *   - the clinic has to be open, like every admin page but Billing.
 *
 * The logo is NOT saved by saveClinicBrandingAction, and a logo address added
 * to that form is never read. A clinic's logo is the picture its admin
 * uploads with uploadClinicLogoAction, which goes to the clinic's Clerk
 * organization (the one logo store) and is copied onto our one logo column.
 * Only Pulse staff can type a logo address, on /pulse, because such an
 * address is loaded by every patient's phone and someone at Pulse should
 * have looked at it first.
 *
 * Every save is logged under this person's name, marked "(clinic admin)" so
 * Pulse staff reading the log can tell who did it.
 *
 * On anything wrong, the form gets a sentence back and keeps what was typed
 * or chosen. The kind of an unexpected failure goes to the server log, never
 * the failure itself, and never to the screen.
 */

export type BrandingFormState = { ok?: string; error?: string } | null;

const NOT_ADMIN = "Only your clinic's office admins can change the branding.";
const NOT_OPEN = "Your clinic is not open right now, so its branding cannot be changed. See Billing.";
const NO_ORGANIZATION = "Your clinic's sign-in account is not set up for this yet. Get in touch with Pulse 3D and we will sort it out.";

/** Who the log says made the change. */
async function adminName() {
  return `${(await getSignedInName()) ?? "A clinic admin"} (clinic admin)`;
}

/** The pages that show the clinic's name, logo and look. The library's frame is a layout, which the browser otherwise keeps between pages, so it is named as one. The patient page is always fresh. */
function refreshClinicScreens() {
  revalidatePath("/admin", "layout");
  revalidatePath("/library", "layout");
}

export async function saveClinicBrandingAction(_previous: BrandingFormState, formData: FormData): Promise<BrandingFormState> {
  if (!(await isClinicAdmin())) return { error: NOT_ADMIN };

  const clinicId = await getCurrentClinicId();
  if (!clinicId) return { error: NOT_OPEN };

  const checked = readBrandingForm(formData);
  if ("error" in checked) return checked;

  try {
    const { logged } = await updateClinicBranding(clinicId, checked.values, await adminName());
    if (!logged) return { ok: "Nothing changed, so nothing was saved." };
  } catch (error) {
    console.error("Saving a clinic's branding failed", errorKind(error));
    return { error: "That did not save. Nothing was changed. Try again in a moment." };
  }

  refreshClinicScreens();
  return { ok: "Saved. Your team sees it on their next page, and patients on the next link they open." };
}

/**
 * Rename the clinic. The name lives on the clinic's Clerk organization, so
 * Clerk is renamed first; if Clerk refuses or does not answer, nothing is
 * changed anywhere. Then our copy is updated and logged. If that last step
 * fails, Clerk already has the new name and the next page copies it over,
 * so the sentence says to reload and check.
 */
export async function saveClinicNameAction(_previous: BrandingFormState, formData: FormData): Promise<BrandingFormState> {
  if (!(await isClinicAdmin())) return { error: NOT_ADMIN };

  const clinicId = await getCurrentClinicId();
  if (!clinicId) return { error: NOT_OPEN };

  const values = formData.getAll("name");
  if (values.length !== 1 || typeof values[0] !== "string") return { error: "Send the clinic name as one line of text." };
  const checked = readClinicName(values[0]);
  if ("error" in checked) return checked;

  const clerkOrgId = await getClerkOrgIdForClinic(clinicId);
  if (!clerkOrgId) return { error: NO_ORGANIZATION };

  try {
    await renameClerkOrganization(clerkOrgId, checked.name);
  } catch (error) {
    console.error("Renaming a clinic in Clerk failed", errorKind(error));
    return { error: "We could not reach the sign-in service to rename your clinic, so nothing was changed. Try again in a moment." };
  }

  try {
    const { logged } = await recordClinicName(clinicId, checked.name, await adminName());
    refreshClinicScreens();
    if (!logged) return { ok: "That is already your clinic's name, so nothing was changed." };
  } catch (error) {
    console.error("Recording a clinic's new name failed", errorKind(error));
    return { error: "The new name was sent, but we could not confirm it was saved. Reload the page to check." };
  }

  return { ok: "Saved. Your team sees the new name on their next page, and patients on the next link they open." };
}

/**
 * Upload a new logo. The file is checked here by its size and its bytes (a
 * PNG, JPG or WebP picture of 1 MB or less; what the browser says about it
 * is never trusted), sent to the clinic's Clerk organization, and the
 * address Clerk serves it from is copied onto our row and logged. Nothing
 * of the file is kept by us. If Clerk refuses or does not answer, nothing is
 * changed.
 */
export async function uploadClinicLogoAction(_previous: BrandingFormState, formData: FormData): Promise<BrandingFormState> {
  if (!(await isClinicAdmin())) return { error: NOT_ADMIN };

  const clinicId = await getCurrentClinicId();
  if (!clinicId) return { error: NOT_OPEN };

  const { userId } = await auth();
  if (!userId) return { error: NOT_ADMIN };

  const files = formData.getAll("logo");
  if (files.length !== 1 || typeof files[0] === "string") return { error: LOGO_MISSING };
  const file = files[0];

  // The size first, so an oversized file is never read into memory.
  const sizeProblem = checkLogoSize(file.size);
  if (sizeProblem) return { error: sizeProblem };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkLogoBytes(bytes);
  if ("error" in checked) return checked;

  const clerkOrgId = await getClerkOrgIdForClinic(clinicId);
  if (!clerkOrgId) return { error: NO_ORGANIZATION };

  let logoUrl: string | null;
  try {
    ({ logoUrl } = await uploadClerkOrganizationLogo(clerkOrgId, { bytes, kind: checked.kind }, userId));
  } catch (error) {
    console.error("Uploading a clinic logo to Clerk failed", errorKind(error));
    return { error: "We could not upload the logo just now, so nothing was changed. Try again in a moment." };
  }
  if (!logoUrl) {
    console.error("Uploading a clinic logo to Clerk failed", "no image afterwards");
    return { error: "The logo did not take. Nothing was changed. Try again, or try a different picture." };
  }

  try {
    await recordUploadedLogo(clinicId, logoUrl, await adminName());
  } catch (error) {
    // Clerk has the logo; the next page copies it over.
    console.error("Recording a clinic's new logo failed", errorKind(error));
    return { error: "The logo was uploaded, but we could not confirm it was saved. Reload the page to check." };
  }

  refreshClinicScreens();
  return { ok: "Uploaded. Your team sees the new logo on their next page, and patients on the next link they open." };
}
