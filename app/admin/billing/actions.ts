"use server";

import { revalidatePath } from "next/cache";
import { getBillingClinicId } from "@/lib/clinic";
import { getClinicPlan, setClinicPracticeType } from "@/lib/db/clinics";
import { getSignedInName } from "@/lib/people";

/**
 * The one thing a clinic can save on its Billing page so far: what kind of
 * practice it is. Asked once. A hospital or health system is always set up
 * by Pulse 3D and is never offered card checkout, so the answer has to be
 * on file before any checkout exists, and it is never guessed from a name.
 *
 * Who may answer, and for which clinic, is decided on the server:
 *
 *   - only an office admin, of their own clinic, found from the session by
 *     getBillingClinicId(). Unlike every other clinic action this one works
 *     for a clinic that is NOT open, because Billing is the page a closed
 *     clinic comes to. The form carries no clinic id, and one added to it
 *     is never read.
 *   - only while the answer is still "not answered". Afterwards only Pulse
 *     staff can change it (on /pulse), so a hospital that has been told it
 *     is Enterprise cannot simply answer again.
 */

export type PracticeFormState = { ok?: string; error?: string } | null;

const ANSWERS = { CLINIC: "CLINIC", HOSPITAL: "HOSPITAL" } as const;

export async function answerPracticeTypeAction(_previous: PracticeFormState, formData: FormData): Promise<PracticeFormState> {
  const clinicId = await getBillingClinicId();
  if (!clinicId) return { error: "Only your clinic's office admins can answer this." };

  const value = String(formData.get("practiceType") ?? "");
  if (!Object.hasOwn(ANSWERS, value)) return { error: "Choose one of the two." };
  const answer = ANSWERS[value as keyof typeof ANSWERS];

  try {
    const plan = await getClinicPlan(clinicId);
    if (!plan) return { error: "Your clinic could not be found. Try again in a moment." };
    if (plan.practiceType !== "UNKNOWN") {
      return { error: "This has already been answered. To change it, get in touch with Pulse 3D." };
    }
    const name = (await getSignedInName()) ?? "A clinic admin";
    const { logged } = await setClinicPracticeType(clinicId, answer, `${name} (clinic admin)`, { onlyIfUnknown: true });
    // Someone else in the clinic answered in the same moment: theirs stands.
    if (!logged) return { error: "This has already been answered. To change it, get in touch with Pulse 3D." };
  } catch (error) {
    console.error("Saving a clinic's practice type failed", error);
    return { error: "That did not save. Nothing was changed. Try again in a moment." };
  }

  revalidatePath("/admin/billing");
  return { ok: "Saved. Thank you." };
}
