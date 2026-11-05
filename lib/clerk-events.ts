/**
 * The Clerk webhook, the parts that need no database and no Clerk: which
 * notifications we act on, the few facts we take from one, and the words
 * the clinic log and the email to Pulse use. Pure.
 *
 * Why the webhook exists. The account owner is protected on our screens
 * (never removed, never stripped of admin: lib/seat-changes.ts), but Clerk
 * will not take membership management away from its admin role, so an
 * office admin acting in Clerk directly can still remove the owner or
 * switch their admin off. Without this, the app only noticed the next time
 * someone opened People or the clinic's /pulse page. With it, Clerk tells
 * us within seconds, the clinic log says the change was made in Clerk and
 * not on our screens, and Pulse staff get an email.
 *
 * What it cannot do: stop the change (it has already happened), or say WHO
 * made it. Clerk's notification carries the request's address and browser,
 * which we never read, and no user id for the person who acted.
 *
 * What is taken from a notification: its kind, the organization's id and,
 * for a membership, the member's user id. Nothing else. Whether the owner is
 * really gone, or really not an admin, is then asked of Clerk itself by the
 * seat check, so a late, repeated or out-of-order notification ends in the
 * same place as the right one.
 */

/** What one notification is about, or null for anything we do not act on. */
export type ClerkEvent =
  | { kind: "membership"; orgId: string; userId: string | null }
  | { kind: "organization-deleted"; orgId: string };

/** The membership kinds that can change who is in a clinic or what they may do. Created is included: a seat may come free or be filled. */
const MEMBERSHIP_TYPES = new Set(["organizationMembership.created", "organizationMembership.updated", "organizationMembership.deleted"]);

/** A Clerk id: a short prefix, an underscore, then letters and digits. Anything else is not trusted as one. */
function readId(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  return new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value) ? value : null;
}

/**
 * The facts we act on, read from a notification whose signature has already
 * been checked. Unknown kinds, and bodies without a usable organization id,
 * are null: answered and dropped.
 */
export function readClerkEvent(event: unknown): ClerkEvent | null {
  if (typeof event !== "object" || event === null) return null;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || typeof data !== "object" || data === null) return null;
  const facts = data as { id?: unknown; organization?: { id?: unknown } | null; public_user_data?: { user_id?: unknown } | null };

  if (type === "organization.deleted") {
    const orgId = readId(facts.id, "org");
    return orgId ? { kind: "organization-deleted", orgId } : null;
  }
  if (MEMBERSHIP_TYPES.has(type)) {
    const orgId = readId(facts.organization?.id, "org");
    if (!orgId) return null;
    return { kind: "membership", orgId, userId: readId(facts.public_user_data?.user_id, "user") };
  }
  return null;
}

/**
 * Clerk's delivery id (the svix-id header), used as the email's idempotency
 * key, so a repeated delivery never sends a second email. Null when it does
 * not look like one.
 */
export function readDeliveryId(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim();
  return /^msg_[A-Za-z0-9]{1,64}$/.test(value) ? value : null;
}

/** The name the clinic log shows for entries the webhook writes. */
export const CLERK_AUTHOR = "Clerk";

/** What happened, as the webhook found it once Clerk had been asked. */
export type OwnerFinding = "owner-left" | "owner-not-admin" | "organization-deleted";

/** The clinic log entry for each finding. Each says it was done in Clerk and that Clerk does not say who. */
export const FINDING_NOTES: Record<OwnerFinding, string> = {
  "owner-left":
    "Changed in Clerk, not on our screens: the account owner is no longer a member of the clinic. Either an admin removed them in Clerk directly or they left from their own account menu; Clerk does not say which, or who. Set a new account owner on the People tab.",
  "owner-not-admin":
    "Changed in Clerk, not on our screens: the account owner's admin was switched off. Clerk does not say who did it. The owner is refused by the office-admin actions until an admin switches admin back on from People.",
  "organization-deleted":
    "Changed in Clerk, not on our screens: the clinic's Clerk organization was deleted. Clerk does not say who did it. Nobody can sign in to this clinic any more. A card subscription, if the clinic has one, keeps charging until it is cancelled in Stripe.",
};

/** The email to Pulse staff. The clinic's name and its /pulse address (a path, no host), and nothing about any person. */
export function findingEmail(finding: OwnerFinding, clinic: { id: string; name: string }, to: string[], deliveryId: string | null) {
  const lines = [
    `Clinic: ${clinic.name}`,
    "",
    FINDING_NOTES[finding],
    "",
    `Open it on the Pulse dashboard: /pulse/clinics/${clinic.id}`,
    "",
    "This was reported by Clerk's webhook. The same words are in the clinic's log.",
  ];
  const subjects: Record<OwnerFinding, string> = {
    "owner-left": "the account owner left or was removed in Clerk",
    "owner-not-admin": "the account owner's admin was switched off in Clerk",
    "organization-deleted": "the clinic's organization was deleted in Clerk",
  };
  return {
    to,
    subject: `Pulse 3D: ${subjects[finding]} (${clinic.name})`,
    text: lines.join("\n"),
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p>`,
    idempotencyKey: deliveryId ? `clerk-webhook-${deliveryId}` : undefined,
  };
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
