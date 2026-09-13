"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare, deleteShareForClinic } from "@/lib/db/shares";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { isClinicAdmin } from "@/lib/roles";

/**
 * Server Actions for the Shared links page (/admin/links).
 *
 * A Server Action is a function that runs on the server but can be called
 * from a form in the browser, so the database work stays on the server
 * (rule 1) while the page stays a simple form.
 *
 * Every action here is for admins only (org:admin, see lib/roles.ts) and
 * only for a clinic that is open. Both are checked on the server, first
 * thing, in every action: a member who somehow submits the form gets a
 * message, not a link.
 */

/** Shown when the request came from someone who is not an admin of an open clinic. */
const NOT_ALLOWED_MESSAGE = "Only your clinic's office admins can do this, and only while the clinic is on a plan.";

/**
 * The clinic id for an admin of an open clinic, or null. Every action starts
 * with this. Null means signed out, not an admin, or the clinic is not open;
 * the message above covers all three without saying which.
 */
async function adminClinicId(): Promise<string | null> {
  if (!(await isClinicAdmin())) return null;
  return getCurrentClinicId();
}

/** What the create-link form gets back: the new code, or a message to show. */
type CreateShareState = { code?: string; error?: string } | null;

/**
 * Handles the "Create share link" form for one video.
 * The form sends one field, videoId (hidden). How long the link works is
 * not chosen on the form: every link gets SHARE_EXPIRY_DAYS.
 */
export async function createShareAction(
  _previous: CreateShareState,
  formData: FormData,
): Promise<CreateShareState> {
  // The clinic comes from the signed-in user's organization, never from the form.
  const clinicId = await adminClinicId();
  if (!clinicId) {
    return { error: NOT_ALLOWED_MESSAGE };
  }

  const videoId = String(formData.get("videoId") ?? "").trim();

  if (!videoId) {
    return { error: "No video was selected." };
  }

  try {
    const share = await createShare(clinicId, videoId, SHARE_EXPIRY_DAYS);
    // Tell Next.js the links page and the overview changed, so the list and the counts refresh.
    revalidatePath("/admin/links");
    revalidatePath("/admin");
    return { code: share.code };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the link." };
  }
}

/** What the Cancel link popup gets back: nothing on success, or a message to show. */
type CancelShareState = { error?: string };

/**
 * Handles "Yes, cancel it" in the popup for one share link. The link is
 * deleted, so it stops working at once, and the admin list is refreshed.
 */
export async function cancelShareAction(code: string): Promise<CancelShareState> {
  const clinicId = await adminClinicId();
  if (!clinicId) {
    return { error: NOT_ALLOWED_MESSAGE };
  }

  const trimmed = typeof code === "string" ? code.trim() : "";
  if (!trimmed) {
    return { error: "No link was selected." };
  }

  try {
    // deleteShareForClinic says whether a row was actually removed. If it was
    // not (someone cancelled it moments ago in another tab), the end result is
    // the same, the link is gone, so that still counts as success here.
    await deleteShareForClinic(clinicId, trimmed);
    // Tell Next.js the links page and the overview changed, so the list and the counts refresh.
    revalidatePath("/admin/links");
    revalidatePath("/admin");
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not cancel the link." };
  }
}
