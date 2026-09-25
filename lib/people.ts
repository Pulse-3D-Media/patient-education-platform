import { auth, clerkClient } from "@clerk/nextjs/server";
import { ADMIN_ROLE, clerkRole, type Role } from "./role-names";
import { SEAT_HOLD_KEY, holdIdFromMetadata } from "./seats";

/**
 * The people in a clinic, read from and written to Clerk. Membership, role
 * and invitations all live in Clerk, not in our database (rule 2 also keeps
 * our database free of anything about people but an id), so this file talks
 * to Clerk's backend API and nothing here goes through lib/db.
 *
 * Takes a Clerk organization id, which only lib/clinic.ts and
 * lib/seat-changes.ts should be holding. Never confuse it with a clinic id.
 *
 * THE WRITES (a role, a removal, an invitation sent or revoked) MAY ONLY BE
 * CALLED FROM lib/seat-changes.ts. Each one is tied to the clinic's seats or
 * to the account owner, and the checks for those live there: a seat held
 * under the clinic's lock before an invitation goes out, the owner never
 * removed or made a plain member. lib/seat-changes.test.ts reads the source
 * tree and fails if anything else imports them.
 */

/** One person in the clinic, as the People section shows them. */
export type Person = {
  userId: string;
  /** "Jane Smith", or the email when no name is set. */
  name: string;
  email: string;
  imageUrl: string;
  role: Role;
  /** When they joined the clinic, in milliseconds. Decides who is given a free seat first (lib/seats.ts). */
  joinedAt: number;
  /** The seat hold their membership carries, when they accepted an invitation sent from our People page. See lib/seats.ts. */
  seatHoldId: string | null;
};

/** One Clerk membership, as the app reads it. */
type Membership = {
  role: string;
  createdAt: number;
  publicMetadata?: Record<string, unknown> | null;
  publicUserData?: { userId: string; firstName?: string | null; lastName?: string | null; identifier: string; imageUrl: string } | null;
};

function toPerson(membership: Membership): Person | null {
  const user = membership.publicUserData;
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return {
    userId: user.userId,
    name: fullName || user.identifier,
    email: user.identifier,
    imageUrl: user.imageUrl,
    role: membership.role === ADMIN_ROLE ? "admin" : "member",
    joinedAt: membership.createdAt,
    seatHoldId: holdIdFromMetadata(membership.publicMetadata),
  };
}

/**
 * Everyone in the organization, admins first, then by name. Clerk pages the
 * list; a clinic is at most 20 people on Clerk's free plan, so one page of
 * 100 is every page there is, but the loop is here in case that changes.
 */
export async function listPeople(clerkOrgId: string): Promise<Person[]> {
  const client = await clerkClient();
  const people: Person[] = [];

  for (let offset = 0; ; offset += 100) {
    const page = await client.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
      limit: 100,
      offset,
    });

    for (const membership of page.data) {
      const person = toPerson(membership);
      if (person) people.push(person);
    }

    if (offset + page.data.length >= page.totalCount || page.data.length === 0) break;
  }

  return people.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * One person in the organization, or null when that user is not a member of
 * it. This is the check that a user id sent by the browser really belongs to
 * the admin's own clinic, made before anything is written for them.
 */
export async function getMember(clerkOrgId: string, userId: string): Promise<Person | null> {
  const client = await clerkClient();
  const page = await client.organizations.getOrganizationMembershipList({
    organizationId: clerkOrgId,
    userId: [userId],
    limit: 1,
  });
  const membership = page.data[0];
  // Clerk filters by the user id we gave it; checked again here, so a lookup
  // that came back with someone else can never be mistaken for a match.
  const person = membership ? toPerson(membership) : null;
  return person && person.userId === userId ? person : null;
}

/**
 * The signed-in person's name, for the clinic log: "Jane Smith", or their
 * email when no name is set, or null when nobody is signed in. Read from
 * Clerk on the server; never taken from anything the browser sent. It goes
 * into the log Pulse staff read, which is about staff, never patients.
 */
export async function getSignedInName(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.emailAddresses[0]?.emailAddress || userId;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/** One open invitation, as the People page shows it. */
export type OpenInvitation = {
  id: string;
  email: string;
  role: Role;
  /** The seat hold it carries, or null for an invitation made outside our People page (it holds no seat). */
  seatHoldId: string | null;
  /** When it was sent, in milliseconds. */
  createdAt: number;
};

/** The organization's open invitations, newest first. Bounded like the member list. */
export async function listOpenInvitations(clerkOrgId: string): Promise<OpenInvitation[]> {
  const client = await clerkClient();
  const page = await client.organizations.getOrganizationInvitationList({ organizationId: clerkOrgId, status: ["pending"], limit: 100 });
  return page.data
    .map((invitation) => ({
      id: invitation.id,
      email: invitation.emailAddress,
      role: (invitation.role === ADMIN_ROLE ? "admin" : "member") as Role,
      seatHoldId: holdIdFromMetadata(invitation.publicMetadata as Record<string, unknown> | null),
      createdAt: invitation.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Whether one invitation of this organization is still open. False when Clerk
 * says it was accepted, revoked or expired, or does not know it (in this
 * organization). Throws when Clerk cannot be asked, so a hold is never let
 * go on a failed call.
 */
export async function invitationIsOpen(clerkOrgId: string, invitationId: string): Promise<boolean> {
  const client = await clerkClient();
  try {
    const invitation = await client.organizations.getOrganizationInvitation({ organizationId: clerkOrgId, invitationId });
    return invitation.organizationId === clerkOrgId && invitation.status === "pending";
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404) return false;
    throw error;
  }
}

/** A plain check that an email address looks like one. Clerk checks it properly; this only turns a typo into a sentence. */
export function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// ---------------------------------------------------------------------------
// The writes. ONLY lib/seat-changes.ts may call these (see the top of this file).
// ---------------------------------------------------------------------------

/** Ask Clerk to send an invitation carrying one of our seat holds. Returns Clerk's invitation id. */
export async function sendInvitationFromClerk(clerkOrgId: string, args: { email: string; role: Role; inviterUserId: string; seatHoldId: string }) {
  const client = await clerkClient();
  const invitation = await client.organizations.createOrganizationInvitation({
    organizationId: clerkOrgId,
    emailAddress: args.email,
    role: clerkRole(args.role),
    inviterUserId: args.inviterUserId,
    // Clerk copies this onto the membership when the invitation is accepted,
    // which is how the seat check knows whose seat the hold was.
    publicMetadata: { [SEAT_HOLD_KEY]: args.seatHoldId },
  });
  return invitation.id;
}

/** Revoke one invitation of this organization. */
export async function revokeInvitationInClerk(clerkOrgId: string, invitationId: string, requestingUserId: string) {
  const client = await clerkClient();
  await client.organizations.revokeOrganizationInvitation({ organizationId: clerkOrgId, invitationId, requestingUserId });
}

/** Switch one member's role between admin and member. */
export async function setRoleInClerk(clerkOrgId: string, userId: string, role: Role) {
  const client = await clerkClient();
  await client.organizations.updateOrganizationMembership({ organizationId: clerkOrgId, userId, role: clerkRole(role) });
}

/** Take one person out of the organization. */
export async function removeFromClerk(clerkOrgId: string, userId: string) {
  const client = await clerkClient();
  await client.organizations.deleteOrganizationMembership({ organizationId: clerkOrgId, userId });
}
