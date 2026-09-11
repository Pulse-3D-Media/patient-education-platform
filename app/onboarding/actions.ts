"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { setPersonKind } from "@/lib/people";
import { parseKind } from "@/lib/roles";

/**
 * Records the signed-in person's own answer to the surgeon-or-staff
 * question, then sends them to the library.
 *
 * Only the person's own membership can be changed here, and only in their
 * active organization: both ids come from the session on the server, never
 * from the browser. Changing someone else's kind is the admin's job, in the
 * People section.
 */
export async function setMyKindAction(value: unknown): Promise<{ error: string } | undefined> {
  const kind = parseKind(value);
  if (!kind) return { error: "Choose Yes or No." };

  const { userId, orgId } = await auth();
  if (!userId || !orgId) return { error: "You are not signed in to a clinic. Sign in and try again." };

  try {
    await setPersonKind(orgId, userId, kind);
  } catch {
    return { error: "Could not save your answer. Please try again." };
  }

  redirect("/library");
}
