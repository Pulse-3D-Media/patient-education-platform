"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicId } from "@/lib/clinic";
import { renewShareForClinic } from "@/lib/db/shares";
import { getSignedInName } from "@/lib/people";
import { isClinicAdmin } from "@/lib/roles";

/**
 * The Server Action behind Confirm on /admin/reactivate/<code>: turn one of
 * the clinic's paused links back on.
 *
 * This is the ONLY thing that turns a link back on. The email's button and
 * the overview's button only open the page; opening a page changes nothing.
 * A POST from a signed-in office admin of THIS clinic is what does it, and
 * every part of that is checked here on the server: admin (isClinicAdmin),
 * a clinic that is open (getCurrentClinicId is null otherwise, so a paused,
 * cancelled or out-of-grace clinic is refused with a sentence), and the
 * code looked up within that clinic only (renewShareForClinic takes the
 * clinic id first, so a forged code, or another clinic's code, finds no
 * link). The admin's name for the clinic log comes from Clerk, never from
 * the form.
 *
 * Pressing twice, or two admins pressing at once, renews once: the write is
 * one transaction under the link's row lock (see renewShareForClinic), and
 * the second press is told the link is already working.
 */

/** What the form shows after a press: whether it worked, and a sentence either way. */
export type ReactivateState = { ok: boolean; message: string } | null;

const NOT_ADMIN = "Only your clinic's office admins can turn a link back on.";
const NOT_OPEN = "Your clinic is not open right now, so links cannot be turned back on. The Billing page says where things stand.";
const FAILED = "That could not be done just now. Nothing was changed. Try again in a moment.";

/** What a share code looks like: a short string of lowercase letters and digits. Anything else is refused before the database is asked. */
function readCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9]{1,20}$/.test(value) ? value : null;
}

export async function reactivateLinkAction(_previous: ReactivateState, formData: FormData): Promise<ReactivateState> {
  try {
    if (!(await isClinicAdmin())) return { ok: false, message: NOT_ADMIN };
    const clinicId = await getCurrentClinicId();
    if (!clinicId) return { ok: false, message: NOT_OPEN };

    const code = readCode(formData.get("code"));
    if (!code) return { ok: false, message: "We couldn't find that link for your clinic." };

    const name = (await getSignedInName()) ?? "An office admin";
    const outcome = await renewShareForClinic(clinicId, code, name);
    if (outcome.ok) {
      // The overview's waiting list and its newest links, and this page's own details.
      revalidatePath("/admin");
      revalidatePath(`/admin/reactivate/${code}`);
    }
    return { ok: outcome.ok, message: outcome.message };
  } catch (error) {
    // Ours to read; only the kind of error is logged, never the code.
    console.error("Turning a link back on failed", error instanceof Error ? error.name : "unknown error");
    return { ok: false, message: FAILED };
  }
}
