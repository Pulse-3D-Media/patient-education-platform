/**
 * A stand-in for Clerk, for the tests only. Nothing in the app imports it.
 *
 * It keeps organizations, their members and their invitations in memory and
 * answers the handful of Clerk calls the app makes about people: who is
 * signed in, who is in an organization, their role, and invitations. A test
 * file swaps it in with:
 *
 *   vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
 *
 * and then drives it through the `fakeClerk` object below: add people, sign
 * someone in, make the next write fail, accept or revoke an invitation behind
 * the app's back, and so on. Every id, name and address in it is made up.
 *
 * It behaves like Clerk where the difference would matter (as Clerk's
 * documentation describes it; the walkthrough with a real Clerk test
 * organization is the check that it really does):
 *   - a membership list filtered by a user id only ever returns that user;
 *   - writing to someone who is not a member of the organization fails;
 *   - an invitation's public metadata is copied onto the membership when it
 *     is accepted;
 *   - a second open invitation to the same address is refused;
 *   - an invitation looked up in the wrong organization is not found (404);
 *   - lists are paged with limit and offset.
 */

export type FakeMember = {
  userId: string;
  firstName?: string;
  lastName?: string;
  /** Their email, which Clerk calls the identifier. */
  identifier?: string;
  role?: "org:admin" | "org:member";
  /** What is on the membership's public metadata. Anything may be put here, as anything may be in Clerk. */
  metadata?: Record<string, unknown>;
  /** When they joined, in milliseconds. */
  joinedAt?: number;
};

type StoredMember = Required<FakeMember>;

type StoredInvitation = {
  id: string;
  organizationId: string;
  emailAddress: string;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  publicMetadata: Record<string, unknown>;
  createdAt: number;
  /** Where the email's link lands after Clerk has checked it, as the app asked. */
  redirectUrl?: string;
};

/** What Clerk throws for something it does not have. */
function notFound(): Error {
  return Object.assign(new Error("fake Clerk: not found"), { status: 404 });
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_fake${(counter += 1).toString().padStart(6, "0")}`;

class FakeClerk {
  private orgs = new Map<string, { name: string; createdBy: string | null; members: StoredMember[]; invitations: StoredInvitation[] }>();
  private session: { userId: string | null; orgId: string | null } = { userId: null, orgId: null };
  /** Pulse 3D staff: users whose Clerk public metadata says pulseStaff: true. In no organization. */
  private staff = new Map<string, { firstName: string; lastName: string }>();

  /** How many of the next writes (role, removal, invitation sent or revoked) fail, the way a Clerk outage would. */
  failNextWrites = 0;
  /** When set, member and invitation lists fail, the way a Clerk outage would. */
  failReads = false;
  /** Every write that reached "Clerk", in order, failed ones included. */
  writes: { op: string; orgId: string; target: string; failed: boolean }[] = [];
  /** Called just before each write lands. A test uses it to do something in that gap. */
  beforeWrite: ((write: { op: string; orgId: string; target: string }) => Promise<void> | void) | null = null;

  /** Forget everything. Call between tests. */
  reset() {
    this.orgs.clear();
    this.session = { userId: null, orgId: null };
    this.staff.clear();
    this.failNextWrites = 0;
    this.failReads = false;
    this.writes = [];
    this.beforeWrite = null;
  }

  /** An organization, with its creator (Clerk's createdBy) and its first people. */
  addOrg(orgId: string, name: string, members: FakeMember[] = [], createdBy: string | null = null) {
    this.orgs.set(orgId, { name, createdBy, members: [], invitations: [] });
    for (const member of members) this.addMember(orgId, member);
  }

  private org(orgId: string) {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error("fake Clerk: no such organization");
    return org;
  }

  /** A person joins the organization. `metadata` lets a membership arrive carrying something, as an accepted invitation's would. */
  addMember(orgId: string, member: FakeMember) {
    this.org(orgId).members.push({
      userId: member.userId,
      firstName: member.firstName ?? "Test",
      lastName: member.lastName ?? member.userId.slice(-4),
      identifier: member.identifier ?? `${member.userId}@example.test`,
      role: member.role ?? "org:member",
      joinedAt: member.joinedAt ?? Date.now(),
      metadata: { ...(member.metadata ?? {}) },
    });
  }

  /** Someone is removed in Clerk's own panel, or leaves, behind the app's back. */
  removeMember(orgId: string, userId: string) {
    const org = this.orgs.get(orgId);
    if (org) org.members = org.members.filter((member) => member.userId !== userId);
  }

  /** A role changed in Clerk's own panel, behind the app's back. */
  setRoleOutsideTheApp(orgId: string, userId: string, role: "org:admin" | "org:member") {
    const member = this.org(orgId).members.find((candidate) => candidate.userId === userId);
    if (!member) throw new Error("fake Clerk: no such member");
    member.role = role;
  }

  roleOf(orgId: string, userId: string): string | undefined {
    return this.orgs.get(orgId)?.members.find((member) => member.userId === userId)?.role;
  }

  isMember(orgId: string, userId: string): boolean {
    return Boolean(this.orgs.get(orgId)?.members.some((member) => member.userId === userId));
  }

  invitations(orgId: string): StoredInvitation[] {
    return this.orgs.get(orgId)?.invitations ?? [];
  }

  /** An invitation sent from Clerk's own panel or dashboard: it carries no seat hold. */
  inviteOutsideTheApp(orgId: string, emailAddress: string, role: "org:admin" | "org:member" = "org:member") {
    const invitation: StoredInvitation = { id: nextId("orginv"), organizationId: orgId, emailAddress, role, status: "pending", publicMetadata: {}, createdAt: Date.now() };
    this.org(orgId).invitations.push(invitation);
    return invitation.id;
  }

  /** The invited person accepts: they join with the invitation's role, and its public metadata copied onto their membership, as Clerk does. */
  acceptInvitation(orgId: string, invitationId: string, userId: string, joinedAt?: number) {
    const invitation = this.org(orgId).invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation || invitation.status !== "pending") throw new Error("fake Clerk: no open invitation with that id");
    invitation.status = "accepted";
    this.addMember(orgId, {
      userId,
      identifier: invitation.emailAddress,
      role: invitation.role as "org:admin" | "org:member",
      metadata: invitation.publicMetadata,
      joinedAt,
    });
  }

  /** An invitation revoked in Clerk's own panel, or run out, behind the app's back. */
  closeInvitationOutsideTheApp(orgId: string, invitationId: string, status: "revoked" | "expired") {
    const invitation = this.org(orgId).invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation) throw new Error("fake Clerk: no such invitation");
    invitation.status = status;
  }

  /** A Pulse 3D staff member (pulseStaff: true on their Clerk user). Sign them in with signIn(userId, null). */
  addStaff(userId: string, firstName = "Evan", lastName = "Miller") {
    this.staff.set(userId, { firstName, lastName });
  }

  signIn(userId: string | null, orgId: string | null) {
    this.session = { userId, orgId };
  }

  /** Run one write the way Clerk would: the hook, then maybe a failure, then the change. */
  private async write<T>(op: string, orgId: string, target: string, change: () => T): Promise<T> {
    if (this.beforeWrite) await this.beforeWrite({ op, orgId, target });
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1;
      this.writes.push({ op, orgId, target, failed: true });
      throw new Error("fake Clerk: the write failed");
    }
    try {
      const result = change();
      this.writes.push({ op, orgId, target, failed: false });
      return result;
    } catch (error) {
      this.writes.push({ op, orgId, target, failed: true });
      throw error;
    }
  }

  private member(orgId: string, userId: string) {
    const member = this.orgs.get(orgId)?.members.find((candidate) => candidate.userId === userId);
    if (!member) throw notFound();
    return member;
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
          organization: { name: org?.name ?? "", hasImage: false, imageUrl: "", createdBy: org?.createdBy ?? undefined, membersCount: org?.members.length ?? 0 },
        }));
        return { data, totalCount: all.length };
      },
      updateOrganizationMembership: async (params: { organizationId: string; userId: string; role: string }) =>
        this.write("role", params.organizationId, params.userId, () => {
          this.member(params.organizationId, params.userId).role = params.role as "org:admin" | "org:member";
          return {};
        }),
      deleteOrganizationMembership: async (params: { organizationId: string; userId: string }) =>
        this.write("remove", params.organizationId, params.userId, () => {
          this.member(params.organizationId, params.userId);
          this.removeMember(params.organizationId, params.userId);
          return {};
        }),
      getOrganizationInvitationList: async (params: { organizationId: string; status?: string[]; limit?: number }) => {
        if (this.failReads) throw new Error("fake Clerk: reads are failing");
        const all = this.invitations(params.organizationId).filter((invitation) => !params.status || params.status.includes(invitation.status));
        return { data: all.slice(0, params.limit ?? 10).map((invitation) => ({ ...invitation, publicMetadata: { ...invitation.publicMetadata } })), totalCount: all.length };
      },
      getOrganizationInvitation: async (params: { organizationId: string; invitationId: string }) => {
        if (this.failReads) throw new Error("fake Clerk: reads are failing");
        const invitation = this.invitations(params.organizationId).find((candidate) => candidate.id === params.invitationId);
        if (!invitation) throw notFound();
        return { ...invitation };
      },
      createOrganizationInvitation: async (params: { organizationId: string; emailAddress: string; role: string; publicMetadata?: Record<string, unknown>; redirectUrl?: string }) =>
        this.write("invite", params.organizationId, params.emailAddress, () => {
          const org = this.org(params.organizationId);
          if (org.invitations.some((invitation) => invitation.status === "pending" && invitation.emailAddress === params.emailAddress)) {
            throw Object.assign(new Error("fake Clerk: duplicate invitation"), { status: 400 });
          }
          const invitation: StoredInvitation = {
            id: nextId("orginv"),
            organizationId: params.organizationId,
            emailAddress: params.emailAddress,
            role: params.role,
            status: "pending",
            publicMetadata: { ...(params.publicMetadata ?? {}) },
            createdAt: Date.now(),
            redirectUrl: params.redirectUrl,
          };
          org.invitations.push(invitation);
          return { ...invitation };
        }),
      revokeOrganizationInvitation: async (params: { organizationId: string; invitationId: string }) =>
        this.write("revoke", params.organizationId, params.invitationId, () => {
          const invitation = this.invitations(params.organizationId).find((candidate) => candidate.id === params.invitationId);
          if (!invitation || invitation.status !== "pending") throw notFound();
          invitation.status = "revoked";
          return { ...invitation };
        }),
    },
    users: {
      getUser: async (userId: string) => {
        const staff = this.staff.get(userId);
        if (staff) return { ...staff, emailAddresses: [{ emailAddress: `${userId}@example.test` }], publicMetadata: { pulseStaff: true } };
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
