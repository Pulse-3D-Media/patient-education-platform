"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare, SenderRefusedError, ShareRefusedError } from "@/lib/db/shares";
import { ShareTermsError } from "@/lib/expiry";
import { isClinicAdmin } from "@/lib/roles";
import { resolveSender } from "@/lib/senders";

/**
 * The Server Action behind the Create link button on the Shared links page
 * (/admin/links).
 *
 * A Server Action is a function that runs on the server but can be called
 * from a button in the browser, so the database work stays on the server
 * (rule 1) while the page stays simple.
 *
 * For admins only (org:admin, see lib/roles.ts) and only for a clinic that
 * is open. Both are checked on the server, first thing: a member who somehow
 * presses the button gets a message, not a link.
 *
 * The browser sends two things: which video, and which surgeon the link is
 * from. Neither is taken on trust. The clinic comes from the signed-in
 * admin's organization, never from the browser. The surgeon is checked with
 * Clerk to be in THIS clinic (resolveSender), and createShare() then checks,
 * in the same transaction that writes the link, that they hold a seat here
 * right now and that the video is one this clinic may share.
 *
 * WHEN SOMETHING GOES WRONG the admin gets a plain sentence and can press
 * again. Refusals that are already written for a person (not on the plan,
 * not published, no seat, a link setting out of range) are shown as they
 * are; anything else goes to the server log, never to the screen.
 */

/** Shown when the request came from someone who is not an admin of an open clinic. */
const NOT_ALLOWED_MESSAGE = "Only your clinic's office admins can do this, and only while the clinic is on a plan.";

/** Shown when the link could not be made for a reason the admin cannot do anything about. */
const COULD_NOT_MAKE_LINK = "The link could not be made just now. Nothing was sent to anyone. Try again in a moment.";

/** What the Create link button gets back: the new link's code and who it is from, or a sentence to show. */
export type CreateLinkResult = { ok: true; code: string; senderName: string | null } | { ok: false; error: string };

/**
 * Make one new link for one video, from one surgeon. Pressing the button
 * again makes another link: every press is a new link, and closing the menu
 * that shows it does not delete it (an unused link stops on its own).
 */
export async function createLinkAction(videoId: unknown, senderUserId: unknown): Promise<CreateLinkResult> {
  try {
    if (!(await isClinicAdmin())) return { ok: false, error: NOT_ALLOWED_MESSAGE };
    // Null means signed out or a clinic that is not open.
    const clinicId = await getCurrentClinicId();
    if (!clinicId) return { ok: false, error: NOT_ALLOWED_MESSAGE };

    if (typeof videoId !== "string" || !videoId.trim()) return { ok: false, error: "No video was selected." };

    const sender = await resolveSender(clinicId, senderUserId);
    if (!sender.ok) return { ok: false, error: sender.message };

    const share = await createShare(clinicId, videoId.trim(), { sender: sender.sender });
    // The overview counts links and lists the newest ones.
    revalidatePath("/admin");
    return { ok: true, code: share.code, senderName: share.senderName };
  } catch (error) {
    // createShare said no: the video is not on the clinic's plan, is a
    // placeholder this clinic is not shown, is unpublished or gone, or the
    // surgeon holds no seat here right now. Each message is written for the
    // person at the desk, so it is shown as it is.
    if (error instanceof ShareRefusedError || error instanceof SenderRefusedError || error instanceof ShareTermsError) {
      return { ok: false, error: error.message };
    }
    // Anything else is ours to read. Only the kind of error is logged: no link, no id.
    console.error("Making a share link from Shared links failed", error instanceof Error ? error.name : "unknown error");
    return { ok: false, error: COULD_NOT_MAKE_LINK };
  }
}
