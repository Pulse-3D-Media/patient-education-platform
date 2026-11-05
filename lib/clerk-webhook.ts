import "server-only";
import { type ClerkEvent, CLERK_AUTHOR, FINDING_NOTES, type OwnerFinding, findingEmail } from "./clerk-events";
import { getClinicByClerkOrgId } from "./db/clinics";
import { addClinicNote, getNewestNoteBody } from "./db/notes";
import { type EmailEnv, sendEmail } from "./email";
import { alertRecipients } from "./error-report";
import { checkSeats } from "./seat-changes";

/**
 * What happens to a Clerk notification once its signature has been checked
 * (app/api/webhooks/clerk/route.ts). Read the top of lib/clerk-events.ts
 * first.
 *
 * The notification only says WHICH clinic to look at. For a membership, the
 * seat check (checkSeats in lib/seat-changes.ts, the same one the People
 * page runs) then asks Clerk who is in the clinic now and brings the seats
 * into line, clearing the owner if they have gone. We compare the owner
 * before and after, and the owner's role as Clerk gives it now, and only
 * then write anything. So a repeated or late notification finds nothing
 * new, and a notification about anyone but the owner changes only what the
 * seat check would have changed anyway.
 *
 * When something happened to the owner (or the organization was deleted),
 * one entry goes in the clinic log under "Clerk", and Pulse staff are
 * emailed at ERROR_ALERT_EMAIL, keyed by Clerk's delivery id so a repeated
 * delivery sends nothing new. An entry that would only repeat the newest
 * one is skipped. Two copies of one delivery arriving at the very same
 * moment could still both write one: harmless, and rarer than rare.
 *
 * Throws when Clerk or the database cannot be reached, so the route answers
 * 500 and Clerk sends the notification again. A failed email never throws.
 */

export type ClerkEventOutcome = "no-clinic" | "nothing-to-report" | OwnerFinding;

export async function handleClerkEvent(
  event: ClerkEvent,
  deliveryId: string | null,
  options: { env?: EmailEnv; send?: typeof sendEmail } = {},
): Promise<ClerkEventOutcome> {
  const clinic = await getClinicByClerkOrgId(event.orgId);
  if (!clinic) return "no-clinic";

  let finding: OwnerFinding | null = null;
  if (event.kind === "organization-deleted") {
    finding = "organization-deleted";
  } else {
    const ownerBefore = clinic.ownerClerkUserId;
    const board = await checkSeats(clinic.id);
    if (ownerBefore && board.ownerUserId === null) finding = "owner-left";
    else if (board.ownerNotAdmin && event.userId !== null && event.userId === board.ownerUserId) finding = "owner-not-admin";
  }
  if (!finding) return "nothing-to-report";

  const body = FINDING_NOTES[finding];
  // The owner leaving clears the owner, so it can only be found once. The
  // other two can be found again by a repeated delivery: skip a repeat.
  if (finding === "owner-left" || (await getNewestNoteBody(clinic.id)) !== body) {
    await addClinicNote(clinic.id, { kind: "STATUS", body, authorName: CLERK_AUTHOR });
  }

  const env = options.env ?? process.env;
  const to = alertRecipients(env);
  if (to.length > 0) {
    const outcome = await (options.send ?? sendEmail)(findingEmail(finding, clinic, to, deliveryId), { env });
    if (!outcome.sent) console.error("Clerk webhook: the email to Pulse staff was not sent.", outcome.reason);
  }
  return finding;
}
