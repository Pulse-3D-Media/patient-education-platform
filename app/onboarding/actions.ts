"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCurrentClinic } from "@/lib/clinic";
import { parseKind } from "@/lib/roles";
import { changeKind } from "@/lib/seat-changes";

/**
 * Records the signed-in person's own answer to the surgeon-or-staff
 * question, then sends them to the library.
 *
 * Only the person's own membership can be changed here, and only in their
 * active organization: both ids come from the session on the server, never
 * from the browser. Changing someone else's kind is the admin's job, in the
 * People section.
 *
 * ASKED ONCE. Whether the question has already been answered is read from
 * Clerk on the server, here and again inside changeKind(). If it has, nothing
 * is changed, whatever was sent: a person who answered "No" cannot send this
 * action again later to make themselves a surgeon.
 *
 * "Yes" goes through the clinic's seat limit like every other route
 * (lib/seat-changes.ts). When a seat is free the person gets it. When none
 * is, which is always the case before the clinic has chosen a plan, their
 * answer is kept as a request: they are let in as a surgeon waiting for a
 * seat, no seat is taken and nothing is charged. Their office admin sees it
 * on the People page.
 */
export async function setMyKindAction(value: unknown): Promise<{ error: string } | undefined> {
  const kind = parseKind(value);
  if (!kind) return { error: "Choose Yes or No." };

  const { userId, orgId } = await auth();
  if (!userId || !orgId) return { error: "You are not signed in to a clinic. Sign in and try again." };

  let outcome: "done" | { error: string };
  try {
    // Reads the person's membership from Clerk, and makes the clinic's row if
    // this is the very first request from a new clinic.
    const clinic = await getCurrentClinic();
    if (!clinic) return { error: "You are not signed in to a clinic. Sign in and try again." };

    if (clinic.kind) {
      outcome = "done"; // already answered: nothing to change
    } else {
      const result = await changeKind({ clinicId: clinic.id, targetUserId: userId, kind, actor: { type: "self" } });
      outcome = result.ok || result.reason === "already-answered" ? "done" : { error: result.message };
    }
  } catch (error) {
    console.error("Onboarding: the answer could not be saved", error instanceof Error ? error.name : "unknown error");
    return { error: "Could not save your answer. Please try again." };
  }

  if (outcome !== "done") return outcome;
  // Outside the try on purpose: redirect() works by throwing.
  redirect("/library");
}
