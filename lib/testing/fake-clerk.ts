/**
 * A stand-in for Clerk, for the tests only. Nothing in the app imports it.
 *
 * It keeps organizations and their members in memory and answers the handful
 * of Clerk calls the app makes about people: who is signed in, who is in an
 * organization, and writing a person's kind. A test file swaps it in with:
 *
 *   vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
 *
 * and then drives it through the `fakeClerk` object below: add people, sign
 * someone in, make the next write fail, remove a member behind the app's
 * back, and so on. Every id and name in it is made up.
 *
 * It behaves like Clerk where the difference would matter:
 *   - a membership list filtered by a user id only ever returns that user;
 *   - writing to someone who is not a member of the organization fails;
 *   - metadata is merged, not replaced;
 *   - lists are paged with limit and offset.
 */

export type FakeMember = {
  userId: string;
  firstName?: string;
  lastName?: string;
  /** Their email, which Clerk calls the identifier. */
  identifier?: string;
  role?: "org:admin" | "org:member";
  /** What is on the membership's public metadata as `kind`. Anything may be put here, as anything may be in Clerk. */
  kind?: unknown;
  /** When they joined, in milliseconds. */
  joinedAt?: number;
};

type StoredMember = Required<Omit<FakeMember, "kind">> & { metadata: Record<string, unknown> };

class FakeClerk {
  private orgs = new Map<string, { name: string; members: StoredMember[] }>();
  private session: { userId: string | null; orgId: string | null } = { userId: null, orgId: null };

  /** How many of the next kind writes fail, the way a Clerk outage would. */
  failNextWrites = 0;
  /** When set, membership lists fail, the way a Clerk outage would. */
  failReads = false;
  /** Every kind write that reached "Clerk", in order, failed ones included. */
  writes: { orgId: string; userId: string; kind: unknown; failed: boolean }[] = [];
  /** Called just before each kind write lands. A test uses it to do something in that gap. */
  beforeWrite: ((write: { orgId: string; userId: string; kind: unknown }) => Promise<void> | void) | null = null;

  /** Forget everything. Call between tests. */
  reset() {
    this.orgs.clear();
    this.session = { userId: null, orgId: null };
    this.failNextWrites = 0;
    this.failReads = false;
    this.writes = [];
    this.beforeWrite = null;
  }

  addOrg(orgId: string, name: string, members: FakeMember[] = []) {
    this.orgs.set(orgId, { name, members: [] });
    for (const member of members) this.addMember(orgId, member);
  }

  /** A person joins the organization. `kind` lets a membership arrive already labelled, as an invitation made with metadata would. */
  addMember(orgId: string, member: FakeMember) {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error("fake Clerk: no such organization");
    org.members.push({
      userId: member.userId,
      firstName: member.firstName ?? "Test",
      lastName: member.lastName ?? member.userId.slice(-4),
      identifier: member.identifier ?? `${member.userId}@example.test`,
      role: member.role ?? "org:member",
      joinedAt: member.joinedAt ?? Date.now(),
      metadata: member.kind === undefined ? {} : { kind: member.kind },
    });
  }

  /** Someone is removed in Clerk's own panel, behind the app's back. */
  removeMember(orgId: string, userId: string) {
    const org = this.orgs.get(orgId);
    if (org) org.members = org.members.filter((member) => member.userId !== userId);
  }

  /** A label changed in Clerk's dashboard, behind the app's back. */
  setKindOutsideTheApp(orgId: string, userId: string, kind: unknown) {
    const member = this.orgs.get(orgId)?.members.find((candidate) => candidate.userId === userId);
    if (!member) throw new Error("fake Clerk: no such member");
    member.metadata = kind === undefined ? {} : { ...member.metadata, kind };
  }

  kindOf(orgId: string, userId: string): unknown {
    return this.orgs.get(orgId)?.members.find((member) => member.userId === userId)?.metadata.kind;
  }

  signIn(userId: string | null, orgId: string | null) {
    this.session = { userId, orgId };
  }

  // -- what the app calls ---------------------------------------------------

  auth = Object.assign(
    async () => {
      const { userId, orgId } = this.session;
      const me = orgId ? this.orgs.get(orgId)?.members.find((member) => member.userId === userId) : undefined;
      return { userId, orgId: me ? orgId : null, has: ({ role }: { role: string }) => me?.role === role };
    },
    { protect: async () => undefined },
  );

  clerkClient = async () => ({
    organizations: {
      getOrganizationMembershipList: async (params: { organizationId: string; userId?: string[]; limit?: number; offset?: number }) => {
        if (this.failReads) throw new Error("fake Clerk: reads are failing");
        const org = this.orgs.get(params.organizationId);
        const all = (org?.members ?? []).filter((member) => !params.userId || params.userId.includes(member.userId));
        const offset = params.offset ?? 0;
        const data = all.slice(offset, offset + (params.limit ?? 10)).map((member) => ({
          role: member.role,
          createdAt: member.joinedAt,
          publicMetadata: { ...member.metadata },
          publicUserData: { userId: member.userId, firstName: member.firstName, lastName: member.lastName, identifier: member.identifier, imageUrl: "" },
          organization: { name: org?.name ?? "", hasImage: false, imageUrl: "" },
        }));
        return { data, totalCount: all.length };
      },
      updateOrganizationMembershipMetadata: async (params: { organizationId: string; userId: string; publicMetadata: Record<string, unknown> }) => {
        const write = { orgId: params.organizationId, userId: params.userId, kind: params.publicMetadata.kind };
        if (this.beforeWrite) await this.beforeWrite(write);
        if (this.failNextWrites > 0) {
          this.failNextWrites -= 1;
          this.writes.push({ ...write, failed: true });
          throw new Error("fake Clerk: the write failed");
        }
        const member = this.orgs.get(params.organizationId)?.members.find((candidate) => candidate.userId === params.userId);
        if (!member) {
          this.writes.push({ ...write, failed: true });
          throw new Error("fake Clerk: not a member of that organization");
        }
        member.metadata = { ...member.metadata, ...params.publicMetadata };
        this.writes.push({ ...write, failed: false });
        return {};
      },
    },
    users: {
      getUser: async (userId: string) => {
        for (const org of this.orgs.values()) {
          const member = org.members.find((candidate) => candidate.userId === userId);
          if (member) return { firstName: member.firstName, lastName: member.lastName, emailAddresses: [{ emailAddress: member.identifier }], publicMetadata: {} };
        }
        throw new Error("fake Clerk: no such user");
      },
    },
  });
}

export const fakeClerk = new FakeClerk();

/** What `@clerk/nextjs/server` is replaced with. */
export function clerkServerModule() {
  return { auth: fakeClerk.auth, clerkClient: fakeClerk.clerkClient };
}
