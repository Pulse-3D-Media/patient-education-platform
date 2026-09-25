"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentClinicId } from "@/lib/clinic";
import { getSignedInName } from "@/lib/people";
import { isClinicAdmin } from "@/lib/roles";
import { pickTrustedOrigin } from "@/lib/trusted-origin";
import {
  giveSeat,
  handOffOwner,
  inviteSomeone,
  releaseOwnSeat,
  removePerson,
  revokeInvitation,
  setAdmin,
  setPatientName,
  type Actor,
  type Outcome,
} from "@/lib/seat-changes";

/**
 * The Server Actions behind the People page: invite, revoke, admin on or off,
 * remove, give a seat, give up the owner's own seat, the name patients see
 * for a seated person, hand the account over.
 *
 * Every one is for office admins only, checked on the server first thing,
 * and only while the clinic is open: nobody is invited, and nothing here is
 * changed, before the clinic has paid. The clinic is the signed-in admin's
 * own, found on the server; who is asking comes from the session. The only
 * things the browser sends are which person or invitation, and what to do.
 * lib/seat-changes.ts then checks with Clerk that the person really is in
 * THAT clinic before anything is written, holds every change to the seat
 * limit, and keeps the account owner an admin who cannot be removed.
 *
 * Each is safe to send twice: a seat or a hold is never counted twice, and
 * asking for what is already so changes nothing.
 */

/** What every action answers: a plain sentence on failure, and sometimes one on success. */
export type ActionResult = { error?: string; message?: string };

const NOT_ADMIN = "Only your clinic's office admins can change this.";
const NOT_OPEN = "Your clinic is not open yet. Choose a plan on the Billing page first.";
const FAILED = "That could not be saved just now. Nothing was changed. Try again in a moment.";

/** Who is asking and which clinic, or the sentence that says why not. */
async function asAdmin(): Promise<{ clinicId: string; actor: Actor } | { error: string }> {
  if (!(await isClinicAdmin())) return { error: NOT_ADMIN };
  const { userId } = await auth();
  if (!userId) return { error: NOT_ADMIN };
  // Null for a clinic that is not open: the People page offers nothing then either.
  const clinicId = await getCurrentClinicId();
  if (!clinicId) return { error: NOT_OPEN };
  const name = (await getSignedInName()) ?? "An office admin";
  return { clinicId, actor: { userId, name } };
}

/** Run one change, turn its outcome into what the page shows, and refresh the page on success. */
async function run(change: (who: { clinicId: string; actor: Actor }) => Promise<Outcome>): Promise<ActionResult> {
  try {
    const who = await asAdmin();
    if ("error" in who) return { error: who.error };
    const outcome = await change(who);
    if (!outcome.ok) return { error: outcome.message };
    revalidatePath("/admin/people");
    return outcome.message ? { message: outcome.message } : {};
  } catch (error) {
    console.error("People: a change could not be saved", error instanceof Error ? error.name : "unknown error");
    return { error: FAILED };
  }
}

export async function inviteAction(email: unknown, role: unknown): Promise<ActionResult> {
  return run(async ({ clinicId, actor }) => {
    // Where the email's link lands after Clerk has checked it: our own sign-up
    // page on this deployment, chosen only from addresses the deployment knows
    // are its own (never from what the browser sent), as checkout does for Stripe.
    const origin = pickTrustedOrigin((await headers()).get("host"), process.env);
    return inviteSomeone({ clinicId, email, role, actor, acceptUrl: origin ? `${origin}/sign-up` : null });
  });
}

export async function revokeInvitationAction(invitationId: unknown): Promise<ActionResult> {
  return run(({ clinicId, actor }) => revokeInvitation({ clinicId, invitationId, actor }));
}

export async function setAdminAction(userId: unknown, on: unknown): Promise<ActionResult> {
  if (on !== true && on !== false) return { error: "Choose Member or Member with admin." };
  return run(({ clinicId, actor }) => setAdmin({ clinicId, targetUserId: userId, admin: on, actor }));
}

export async function removePersonAction(userId: unknown): Promise<ActionResult> {
  return run(({ clinicId, actor }) => removePerson({ clinicId, targetUserId: userId, actor }));
}

export async function giveSeatAction(userId: unknown): Promise<ActionResult> {
  return run(({ clinicId, actor }) => giveSeat({ clinicId, targetUserId: userId, actor }));
}

export async function releaseMySeatAction(): Promise<ActionResult> {
  return run(({ clinicId, actor }) => releaseOwnSeat({ clinicId, actor }));
}

export async function setPatientNameAction(userId: unknown, name: unknown): Promise<ActionResult> {
  return run(({ clinicId, actor }) => setPatientName({ clinicId, targetUserId: userId, name, actor }));
}

export async function handOffOwnerAction(userId: unknown): Promise<ActionResult> {
  return run(({ clinicId, actor }) => handOffOwner({ clinicId, toUserId: userId, actor }));
}
