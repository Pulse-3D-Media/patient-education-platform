"use server";

import { revalidatePath } from "next/cache";
import { readBrandingForm } from "@/lib/branding-form";
import { getCurrentClinicId } from "@/lib/clinic";
import { updateClinicBranding } from "@/lib/db/clinics";
import { getSignedInName } from "@/lib/people";
import { isClinicAdmin } from "@/lib/roles";

/**
 * The Server Action behind the clinic's own Branding page: its phone, brand
 * colour and font.
 *
 * Who may save, and for which clinic, is decided here on the server, from
 * the session and nothing else:
 *
 *   - only an office admin (org:admin). A member who calls this gets a plain
 *     sentence and nothing is written;
 *   - the clinic is the signed-in person's own, from getCurrentClinicId().
 *     The form carries no clinic id, and if one is added to it, it is never
 *     read, so one clinic cannot restyle another;
 *   - the clinic has to be open, like every admin page but Billing.
 *
 * The logo is NOT saved here, and a logo address added to the form is never
 * read. A clinic's logo is the one it uploads to its Clerk organization
 * (People, the panel at the bottom, General); that copy reaches our one logo
 * column on the clinic's next sign-in. Only Pulse staff can type a logo
 * address, on /pulse, because such an address is loaded by every patient's
 * phone and someone at Pulse should have looked at it first.
 *
 * The three values are checked by lib/branding-form.ts, the same checks the
 * Pulse staff form gets. The write goes through updateClinicBranding, which
 * logs what changed under this person's name, marked "(clinic admin)" so
 * Pulse staff reading the log can tell who did it.
 *
 * On anything wrong, the form gets a sentence back and keeps what was typed
 * (the form holds its own values; see BrandingForm). The detail of an
 * unexpected failure goes to the server log, never to the screen.
 */

export type BrandingFormState = { ok?: string; error?: string } | null;

export async function saveClinicBrandingAction(_previous: BrandingFormState, formData: FormData): Promise<BrandingFormState> {
  if (!(await isClinicAdmin())) {
    return { error: "Only your clinic's office admins can change the branding." };
  }

  const clinicId = await getCurrentClinicId();
  if (!clinicId) {
    return { error: "Your clinic is not open right now, so its branding cannot be changed. See Billing." };
  }

  const checked = readBrandingForm(formData);
  if ("error" in checked) return checked;

  try {
    const name = (await getSignedInName()) ?? "A clinic admin";
    const { logged } = await updateClinicBranding(clinicId, checked.values, `${name} (clinic admin)`);
    if (!logged) return { ok: "Nothing changed, so nothing was saved." };
  } catch (error) {
    console.error("Saving a clinic's branding failed", error);
    return { error: "That did not save. Nothing was changed. Try again in a moment." };
  }

  // The library's frame is a layout, which the browser otherwise keeps
  // between pages, so it is named as one. The patient page is always fresh.
  revalidatePath("/admin", "layout");
  revalidatePath("/library", "layout");
  return { ok: "Saved. Your team sees it on their next page, and patients on the next link they open." };
}
