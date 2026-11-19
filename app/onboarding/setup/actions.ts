"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { inviteAction } from "@/app/admin/people/actions";
import { saveClinicBrandingPartAction, saveClinicNameAction } from "@/app/admin/branding/actions";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare, SenderRefusedError, ShareRefusedError } from "@/lib/db/shares";
import { recordSetupStep } from "@/lib/db/setup";
import { errorKind } from "@/lib/error-kind";
import { ShareTermsError } from "@/lib/expiry";
import { qrOriginFor } from "@/lib/qr-code";
import { qrSvg } from "@/lib/qr";
import { isClinicAdmin } from "@/lib/roles";
import { resolveSender } from "@/lib/senders";
import { hrefAfterSave, isSetupStep, type SetupStepKey } from "@/lib/setup";

/**
 * The Server Actions behind the four setup steps (app/onboarding/setup).
 *
 * NOTHING HERE IS A NEW WAY TO CHANGE A CLINIC. Each step calls the code that
 * already makes that change elsewhere, with every check it already has:
 *
 *   Clinic name   saveClinicNameAction (Clinic branding's rename: Clerk first,
 *                 then our copy, logged) and the phone through
 *                 saveClinicBrandingPartAction (the same rules as Branding).
 *   Branding      the logo is uploaded by uploadClinicLogoAction straight
 *                 from the form; the colour through saveClinicBrandingPartAction.
 *   Your team     inviteAction (People's invite: a seat held first, then
 *                 Clerk's invitation), one call per email, always as a member.
 *   Test link     createShare, exactly as Shared links makes a link: the
 *                 surgeon checked with Clerk and their seat checked in the
 *                 same transaction that writes the link.
 *
 * What is new is only where setup stands (recordSetupStep, lib/db/setup.ts),
 * written AFTER the step's own change has succeeded, so a step is never
 * marked done when its change failed. Every action is for an office admin of
 * an open clinic, checked here on the server first; the clinic is the
 * signed-in admin's own (getCurrentClinicId), never one sent by the browser.
 * On success the browser is sent on to the next step by a redirect; on
 * anything else the form keeps what was typed and shows the sentence.
 */

export type SetupFormState = { ok?: string; error?: string; fieldErrors?: Record<string, string> } | null;

const NOT_ALLOWED = "Only your clinic's office admins can set it up, and only once the clinic is open.";
const NOT_SAVED = "That could not be saved just now. Nothing was changed. Try again in a moment.";

/** The clinic, or null when the person is not an admin of an open clinic. */
async function adminClinic(): Promise<string | null> {
  if (!(await isClinicAdmin())) return null;
  return getCurrentClinicId();
}

/** Mark the step and go on. A failure to record it is not the admin's problem to fix: they are sent on all the same, and setup simply shows the step again next time. */
async function moveOn(clinicId: string, step: SetupStepKey, outcome: "done" | "skipped"): Promise<never> {
  let next: string | null = null;
  try {
    const progress = await recordSetupStep(clinicId, step, outcome);
    next = progress ? (progress.finished ? "finished" : progress.current) : "finished";
  } catch (error) {
    console.error("Recording a setup step failed", errorKind(error));
  }
  redirect(next === null ? hrefAfterSave(step) : hrefAfterSave(next));
}

/** "Skip for now": nothing about the clinic changes; setup moves on and shows the step as Later. */
export async function skipSetupStepAction(step: unknown): Promise<SetupFormState> {
  if (!isSetupStep(step)) return { error: "That step could not be found." };
  const clinicId = await adminClinic();
  if (!clinicId) return { error: NOT_ALLOWED };
  return moveOn(clinicId, step, "skipped");
}

/**
 * Step 1, "What's your clinic called?": the clinic's real name (replacing the
 * provisional one made at sign-up) and its phone. The name is saved only when
 * it changed, through the existing rename, so Clerk and our copy stay in step.
 */
export async function saveClinicStepAction(_previous: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const clinicId = await adminClinic();
  if (!clinicId) return { error: NOT_ALLOWED };

  const name = formData.get("name");
  const previousName = formData.get("previousName");
  if (typeof name !== "string" || !name.trim()) return { error: "Type your clinic's name.", fieldErrors: { name: "Type your clinic's name." } };
  // Only a comparison, to skip a rename that changes nothing; the rename itself checks the name again on the server.
  if (name.trim() !== (typeof previousName === "string" ? previousName.trim() : "")) {
    const renamed = await saveClinicNameAction(null, formData);
    if (renamed?.error) return { error: renamed.error, fieldErrors: { name: renamed.error } };
  }

  const phone = await saveClinicBrandingPartAction("phone", formData);
  if (phone?.error) return { error: phone.error, fieldErrors: { phone: phone.error } };

  return moveOn(clinicId, "clinic", "done");
}

/** Step 2, "Add your branding": the colour (the logo is uploaded on its own, as it is picked). */
export async function saveBrandingStepAction(_previous: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const clinicId = await adminClinic();
  if (!clinicId) return { error: NOT_ALLOWED };
  const saved = await saveClinicBrandingPartAction("brandColor", formData);
  if (saved?.error) return { error: saved.error };
  return moveOn(clinicId, "branding", "done");
}

/** What the team step gets back: which addresses were sent, and a sentence for each that was not. The boxes that failed keep their address. */
export type InviteOutcome = { sent: string[]; failed: { email: string; message: string }[]; error?: string };

/**
 * Step 3, "Send invitations": one invitation per address typed, each through
 * People's own invite (a seat held first, then Clerk's invitation), always as
 * a member: nothing about admins is asked in setup. Each address is answered
 * on its own, so one bad or repeated address never stops the others, and an
 * address that went out is never sent twice by a second press (People's
 * invite says it already has an open invitation). The step is marked done
 * only when every typed address went out.
 */
export async function sendSetupInvitationsAction(emails: unknown): Promise<InviteOutcome> {
  const clinicId = await adminClinic();
  if (!clinicId) return { sent: [], failed: [], error: NOT_ALLOWED };
  if (!Array.isArray(emails) || emails.length > 50 || emails.some((email) => typeof email !== "string")) return { sent: [], failed: [], error: "Those addresses could not be read. Try again." };
  const typed = [...new Set((emails as string[]).map((email) => email.trim()).filter(Boolean))];
  if (typed.length === 0) return { sent: [], failed: [], error: "Type an email address in a box, or press Skip for now." };

  const sent: string[] = [];
  const failed: InviteOutcome["failed"] = [];
  // One after another, never at once: each holds a seat under the clinic's lock, and the order keeps the answers in the order typed.
  for (const email of typed) {
    try {
      const result = await inviteAction(email, "member");
      if (result.error) failed.push({ email, message: result.error });
      else sent.push(email);
    } catch (error) {
      console.error("Setup: an invitation could not be sent", errorKind(error));
      failed.push({ email, message: NOT_SAVED });
    }
  }
  if (failed.length === 0) await moveOn(clinicId, "team", "done");
  return { sent, failed };
}

/** "Continue" on the team step when every seat is already taken or invited: nothing to send, the step is done. */
export async function finishTeamStepAction(): Promise<SetupFormState> {
  const clinicId = await adminClinic();
  if (!clinicId) return { error: NOT_ALLOWED };
  return moveOn(clinicId, "team", "done");
}

/** What "Generate QR code" gets back: the link and its QR code as SVG markup (drawn on the server), or a sentence. */
export type TestLinkResult = { ok: true; url: string; qr: string } | { ok: false; error: string };

/**
 * Step 4, "Generate QR code": make ONE ordinary patient link for the picked
 * procedure, from the admin setting up, exactly as Shared links makes one
 * (resolveSender, then createShare, which checks in the same transaction
 * that the procedure is on the plan and the admin holds a seat), and show it
 * as a QR code to scan. It is a real link with the usual expiry, not a
 * printed code (which never runs out): the lighter choice for a test. Each
 * press makes a new link, as on Shared links.
 */
export async function makeTestLinkAction(videoId: unknown): Promise<TestLinkResult> {
  try {
    const clinicId = await adminClinic();
    if (!clinicId) return { ok: false, error: NOT_ALLOWED };
    if (typeof videoId !== "string" || !videoId.trim()) return { ok: false, error: "Pick a procedure first." };
    const { userId } = await auth();
    const sender = await resolveSender(clinicId, userId);
    if (!sender.ok) return { ok: false, error: sender.message };
    const where = qrOriginFor((await headers()).get("host"), process.env);
    if (!where) return { ok: false, error: "This site does not know its own address, so no link can be made here. Get in touch with Pulse 3D." };

    const share = await createShare(clinicId, videoId.trim(), { sender: sender.sender });
    const url = `${where.origin}/watch/${share.code}`;
    return { ok: true, url, qr: await qrSvg(url) };
  } catch (error) {
    if (error instanceof ShareRefusedError || error instanceof SenderRefusedError || error instanceof ShareTermsError) return { ok: false, error: error.message };
    console.error("Setup: making a test link failed", errorKind(error));
    return { ok: false, error: "The link could not be made just now. Try again in a moment." };
  }
}

/** "Finish" on the test step: setup is finished. */
export async function finishTestStepAction(): Promise<SetupFormState> {
  const clinicId = await adminClinic();
  if (!clinicId) return { error: NOT_ALLOWED };
  return moveOn(clinicId, "test", "done");
}
