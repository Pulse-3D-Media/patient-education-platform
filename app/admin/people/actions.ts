"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicId } from "@/lib/clinic";
import { getSignedInName } from "@/lib/people";
import { isClinicAdmin, parseKind } from "@/lib/roles";
import { changeKind } from "@/lib/seat-changes";

/**
 * The Server Action behind the Surgeon / Staff control on the People page,
 * and behind its "Try again".
 *
 * Admins only, checked on the server first thing. The clinic is the signed-in
 * admin's own, found on the server; the only thing the browser sends is which
 * person and which kind. changeKind() then checks with Clerk that the person
 * really is a member of THAT clinic before anything is written, so an admin
 * of one clinic cannot reach into another, and it holds the change to the
 * clinic's seat limit (lib/seat-changes.ts).
 *
 * Safe to send twice: a person who already holds a seat is not counted
 * again, and marking someone staff who already is changes nothing.
 */
export async function setKindAction(userId: unknown, value: unknown): Promise<{ error?: string }> {
  if (!(await isClinicAdmin())) {
    return { error: "Only your clinic's office admins can change this." };
  }

  const kind = parseKind(value);
  if (!kind) return { error: "Choose Surgeon or Staff." };

  const targetUserId = typeof userId === "string" ? userId.trim() : "";
  if (!targetUserId) return { error: "No person was selected." };

  // Null for a clinic that is not open: the People page is closed then too.
  const clinicId = await getCurrentClinicId();
  if (!clinicId) return { error: "Your clinic is not open right now, so this cannot be changed." };

  try {
    const name = (await getSignedInName()) ?? "An office admin";
    const result = await changeKind({ clinicId, targetUserId, kind, actor: { type: "admin", name } });
    if (!result.ok) return { error: result.message };
  } catch (error) {
    console.error("People: a kind could not be saved", error instanceof Error ? error.name : "unknown error");
    return { error: "That could not be saved just now. Nothing was changed. Try again in a moment." };
  }

  // The seat count at the top of the page changed.
  revalidatePath("/admin/people");
  return {};
}
