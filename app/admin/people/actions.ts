"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { setPersonKind } from "@/lib/people";
import { isClinicAdmin, parseKind } from "@/lib/roles";

/**
 * The Server Action behind the Surgeon / Staff control on the People page.
 *
 * Admins only, checked on the server first thing. The person being changed
 * must be in the admin's own organization: the organization id comes from
 * the session, so an admin of one clinic cannot reach into another, and
 * Clerk refuses a user id that is not a member of that organization.
 */
export async function setKindAction(userId: unknown, value: unknown): Promise<{ error?: string }> {
  if (!(await isClinicAdmin())) {
    return { error: "Only your clinic's office admins can change this." };
  }

  const kind = parseKind(value);
  if (!kind) return { error: "Choose Surgeon or Staff." };

  const targetUserId = typeof userId === "string" ? userId.trim() : "";
  if (!targetUserId) return { error: "No person was selected." };

  const { orgId } = await auth();
  if (!orgId) return { error: "You are not signed in to a clinic." };

  try {
    await setPersonKind(orgId, targetUserId, kind);
  } catch {
    return { error: "Could not save that. Is this person still in the clinic?" };
  }

  // The count at the top of the page changed.
  revalidatePath("/admin/people");
  return {};
}
