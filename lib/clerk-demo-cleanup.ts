import "server-only";
import { pulseStaffFromMetadata } from "./pulse-staff";

/**
 * The demo clean-up's questions and deletions in Clerk. ONLY
 * prisma/clear-demo-clinics.ts (through lib/demo-cleanup.ts) uses this, and
 * only on Clerk's TEST instance: the script refuses to start unless
 * CLERK_SECRET_KEY is a test-instance key (isTestClerkSecretKey below), and
 * every call here checks that again before it sends anything.
 *
 * Why this is not in lib/people.ts, where the app's other Clerk calls live:
 * lib/people.ts goes through @clerk/nextjs/server, which loads parts of
 * Next.js that only run inside the app, so a command-line script cannot load
 * it at all. This file talks to Clerk's Backend API directly, over plain
 * HTTPS with the fetch built into Node (the way lib/email.ts talks to
 * Resend), so there is no package to add. The addresses are the ones Clerk
 * documents for its Backend API, version 1.
 *
 * Each deletion treats "not found" as done, so running the clean-up twice is
 * harmless. Every call has a time limit. A failure becomes an error whose
 * message names only the step and the status code: never the key, never an
 * id, never what Clerk sent back.
 */

const CLERK_API = "https://api.clerk.com/v1";
/** How long one call to Clerk may take. */
const CLERK_TIMEOUT_MS = 10_000;

/** Is this a Clerk secret key for a development (test) instance? Live keys start with sk_live_. */
export function isTestClerkSecretKey(key: string | undefined): key is string {
  return typeof key === "string" && key.startsWith("sk_test_");
}

/** Thrown when Clerk answers with a failure. The message is the step and the status only. */
export class ClerkCleanupError extends Error {
  constructor(what: string, status: number | null) {
    super(status === null ? `Clerk could not be reached: ${what}` : `Clerk answered ${status}: ${what}`);
    this.name = "ClerkCleanupError";
  }
}

/** One person the clean-up might remove, as Clerk sees them now. Ids only, never an email. */
export type CleanupUserState = { exists: false } | { exists: true; pulseStaff: boolean; organizations: number };

/** What the clean-up asks of Clerk. A plain object so the tests hand in a stand-in. */
export type DemoCleanupClerk = {
  /** The user ids of everyone in the organization, or null when Clerk no longer has it. */
  organizationMembers(clerkOrgId: string): Promise<string[] | null>;
  /** Delete the organization. Already gone counts as done. */
  deleteOrganization(clerkOrgId: string): Promise<void>;
  /** Whether a user exists, is Pulse staff, and how many organizations they still belong to. */
  userState(userId: string): Promise<CleanupUserState>;
  /** Delete a user. Already gone counts as done. */
  deleteUser(userId: string): Promise<void>;
};

/**
 * One call to Clerk's Backend API. Returns the parsed answer, or null when
 * Clerk said "not found". The path pieces are escaped, so an odd id can only
 * ever name one record.
 */
async function askClerk(method: "GET" | "DELETE", path: string, what: string): Promise<unknown | null> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!isTestClerkSecretKey(key)) throw new ClerkCleanupError(`${what} (CLERK_SECRET_KEY is not a test-instance key)`, null);

  let response: Response;
  try {
    response = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CLERK_TIMEOUT_MS),
    });
  } catch {
    throw new ClerkCleanupError(what, null);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new ClerkCleanupError(what, response.status);
  return response.json();
}

const part = (id: string) => encodeURIComponent(id);

type MembershipPage = { data?: { public_user_data?: { user_id?: string } | null }[]; total_count?: number };

export const demoCleanupClerk: DemoCleanupClerk = {
  async organizationMembers(clerkOrgId) {
    const ids: string[] = [];
    // A demo clinic is a handful of people; the loop stops at 1,000 whatever Clerk says.
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = (await askClerk("GET", `/organizations/${part(clerkOrgId)}/memberships?limit=100&offset=${offset}`, "listing a demo organization's people")) as MembershipPage | null;
      if (page === null) return offset === 0 ? null : ids;
      const data = page.data ?? [];
      for (const membership of data) {
        const userId = membership.public_user_data?.user_id;
        if (typeof userId === "string") ids.push(userId);
      }
      if (data.length === 0 || offset + data.length >= (page.total_count ?? 0)) break;
    }
    return ids;
  },

  async deleteOrganization(clerkOrgId) {
    await askClerk("DELETE", `/organizations/${part(clerkOrgId)}`, "deleting a demo organization");
  },

  async userState(userId) {
    const user = (await askClerk("GET", `/users/${part(userId)}`, "reading a demo user")) as { public_metadata?: Record<string, unknown> } | null;
    if (user === null) return { exists: false };
    const memberships = (await askClerk("GET", `/users/${part(userId)}/organization_memberships?limit=1`, "reading a demo user's organizations")) as MembershipPage | null;
    if (memberships === null) return { exists: false };
    // Fail closed: an answer without a proper count and list is never read as "no organizations",
    // which would delete the person. It stops this clinic instead, and the person stays.
    if (typeof memberships.total_count !== "number" || !Number.isInteger(memberships.total_count) || memberships.total_count < 0 || !Array.isArray(memberships.data)) {
      throw new ClerkCleanupError("reading a demo user's organizations (the answer was not in the expected shape)", null);
    }
    return { exists: true, pulseStaff: pulseStaffFromMetadata(user.public_metadata), organizations: memberships.total_count };
  },

  async deleteUser(userId) {
    await askClerk("DELETE", `/users/${part(userId)}`, "deleting a demo user");
  },
};
