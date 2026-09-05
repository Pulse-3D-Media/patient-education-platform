"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare } from "@/lib/db/shares";
import { EXPIRY_DAYS } from "./expiry";

/**
 * Server Actions for the admin console.
 *
 * A Server Action is a function that runs on the server but can be called
 * from a form in the browser, so the database work stays on the server
 * (rule 1) while the page stays a simple form.
 */

/** What the create-link form gets back: the new code, or a message to show. */
type CreateShareState = { code?: string; error?: string } | null;

/**
 * Handles the "Create share link" form for one video.
 * The form sends two fields: videoId (hidden) and days (the dropdown).
 */
export async function createShareAction(
  _previous: CreateShareState,
  formData: FormData,
): Promise<CreateShareState> {
  // The clinic comes from the server, never from the form. In Phase 1 that is
  // the CLINIC_ID environment variable; in Phase 2 it will be the signed-in user.
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    return { error: "CLINIC_ID is not set. Run npm run db:seed and copy the id into .env." };
  }

  const videoId = String(formData.get("videoId") ?? "").trim();
  const days = Number(formData.get("days"));

  if (!videoId) {
    return { error: "No video was selected." };
  }
  if (!(EXPIRY_DAYS as readonly number[]).includes(days)) {
    return { error: "Choose 3, 7, 14 or 30 days." };
  }

  try {
    const share = await createShare(clinicId, videoId, days);
    // Tell Next.js the admin page's data changed so the links list refreshes.
    revalidatePath("/admin");
    return { code: share.code };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the link." };
  }
}
