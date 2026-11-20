import { auth, clerkClient } from "@clerk/nextjs/server";
import type { ClinicStatus } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentClinic, type CurrentClinic } from "@/lib/clinic";
import OnboardingPage from "./page";

/**
 * Where /onboarding sends a signed-in person. The root address and Clerk's
 * after-sign-up fallback both come here, so this is what decides whether a
 * new clinic's owner lands on Billing.
 *
 * Clerk and the clinic lookup are stand-ins: this checks the routing rule,
 * not Clerk's own redirect after sign-up, which needs a real sign-up on the
 * preview.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: Object.assign(vi.fn(), { protect: vi.fn() }), clerkClient: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  CreateOrganization: () => <span data-testid="create-organization" />,
  // The props that matter are written out, so a test can see the create button is hidden and where people go.
  OrganizationList: (props: { appearance?: unknown; afterCreateOrganizationUrl?: string }) => (
    <span data-testid="organization-list" data-appearance={JSON.stringify(props.appearance ?? null)} data-after-create={props.afterCreateOrganizationUrl} />
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/clinic", () => ({ getCurrentClinic: vi.fn() }));

function clinic(status: ClinicStatus, who: { isOwner: boolean; isAdmin: boolean }): CurrentClinic {
  return { id: "clinic_vitest", name: "Vitest clinic", status, graceEndsAt: null, ...who } as unknown as CurrentClinic;
}

function signedIn(orgId: string | null, has: { memberships?: number; invitations?: number } = {}) {
  vi.mocked(auth.protect).mockResolvedValue({ userId: "user_vitest", orgId } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getOrganizationMembershipList: async () => ({ data: [], totalCount: has.memberships ?? 0 }),
      getOrganizationInvitationList: async () => ({ data: [], totalCount: has.invitations ?? 0 }),
    },
  } as never);
}

/** The page as drawn, for someone with no active clinic, with what is in the address after "?". */
const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve(query) }));

const where = async () => {
  try {
    await OnboardingPage();
    return "stayed";
  } catch (error) {
    return (error as Error).message;
  }
};

beforeEach(() => vi.resetAllMocks());

describe("/onboarding sends each person on", () => {
  it("the owner of a clinic that is not paid for yet goes to the sign-up plan step (which sends them to Billing when checkout is not open)", async () => {
    signedIn("org_vitest");
    vi.mocked(getCurrentClinic).mockResolvedValue(clinic("PENDING", { isOwner: true, isAdmin: true }));
    expect(await where()).toBe("redirect:/onboarding/plan");
  });

  it("the owner of an open clinic goes to the library", async () => {
    signedIn("org_vitest");
    vi.mocked(getCurrentClinic).mockResolvedValue(clinic("ACTIVE", { isOwner: true, isAdmin: true }));
    expect(await where()).toBe("redirect:/library");
  });

  it("a member, or an admin who is not the owner, goes to the join screen (which sends them on to the library when there is nothing to enter), open clinic or not", async () => {
    signedIn("org_vitest");
    for (const who of [
      { isOwner: false, isAdmin: false },
      { isOwner: false, isAdmin: true },
    ]) {
      for (const status of ["PENDING", "ACTIVE"] as const) {
        vi.mocked(getCurrentClinic).mockResolvedValue(clinic(status, who));
        expect(await where()).toBe("redirect:/onboarding/join");
      }
    }
  });

  it("someone with no clinic yet is shown the form to set one up", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await OnboardingPage());
    expect(html).toContain("Set up your clinic");
    expect(html).toContain('data-testid="create-organization"');
    expect(html).not.toContain('data-testid="organization-list"');
  });
});

/**
 * An invited person used to see Clerk's list with "Create organization" beside
 * the invitation, and the words "You can create a new one here too", and could
 * make a second, empty clinic by accident (audit C4, 2026-11-16). Now someone
 * with an invitation or a clinic sees only that; creating is behind one quiet
 * link. Clerk's own list is a stand-in here, so what is proved is what this page
 * asks of it: the real list's look, and that its create button really is gone,
 * is a check on the preview with a real invitation.
 */
describe("/onboarding for someone with an invitation or a clinic", () => {
  const hidden = JSON.stringify({ elements: { organizationListCreateOrganizationActionButton: { display: "none" } } });

  for (const [who, has] of [
    ["an invited person", { invitations: 1 }],
    ["a member of a clinic with none active", { memberships: 1 }],
    ["someone with both", { memberships: 1, invitations: 2 }],
  ] as const) {
    it(`shows ${who} only the list, with Clerk's create button hidden, and creating behind a quiet link`, async () => {
      signedIn(null, has);
      const html = await page();
      expect(html).toContain("Join your clinic");
      expect(html).toContain('data-testid="organization-list"');
      expect(html).toContain(`data-appearance="${hidden.replace(/"/g, "&quot;")}"`);
      expect(html).not.toContain('data-testid="create-organization"');
      expect(html).not.toContain("You can create a new one here too");
      expect(html).toContain('href="/onboarding?create=1"');
      expect(html).toContain("Create a new one</a>");
    });
  }

  it("shows the create form, on its own, to someone who followed the quiet link on purpose", async () => {
    signedIn(null, { invitations: 1 });
    const html = await page({ create: "1" });
    expect(html).toContain("Set up your clinic");
    expect(html).toContain('data-testid="create-organization"');
    expect(html).not.toContain('data-testid="organization-list"');
  });

  it("reads only create=1 as asking: anything else still shows the list", async () => {
    signedIn(null, { invitations: 1 });
    for (const create of ["0", "yes", "", "1 "]) expect(await page({ create }), create).toContain('data-testid="organization-list"');
  });
});
