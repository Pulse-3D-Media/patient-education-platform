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
  OrganizationList: () => <span data-testid="organization-list" />,
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

function signedIn(orgId: string | null) {
  vi.mocked(auth.protect).mockResolvedValue({ userId: "user_vitest", orgId } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getOrganizationMembershipList: async () => ({ data: [], totalCount: 0 }),
      getOrganizationInvitationList: async () => ({ data: [], totalCount: 0 }),
    },
  } as never);
}

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
  it("the owner of a clinic that is not paid for yet goes to Billing", async () => {
    signedIn("org_vitest");
    vi.mocked(getCurrentClinic).mockResolvedValue(clinic("PENDING", { isOwner: true, isAdmin: true }));
    expect(await where()).toBe("redirect:/admin/billing");
  });

  it("the owner of an open clinic goes to the library", async () => {
    signedIn("org_vitest");
    vi.mocked(getCurrentClinic).mockResolvedValue(clinic("ACTIVE", { isOwner: true, isAdmin: true }));
    expect(await where()).toBe("redirect:/library");
  });

  it("a member, or an admin who is not the owner, goes to the library, open clinic or not", async () => {
    signedIn("org_vitest");
    for (const who of [
      { isOwner: false, isAdmin: false },
      { isOwner: false, isAdmin: true },
    ]) {
      vi.mocked(getCurrentClinic).mockResolvedValue(clinic("PENDING", who));
      expect(await where()).toBe("redirect:/library");
    }
  });

  it("someone with no clinic yet is shown the form to set one up", async () => {
    signedIn(null);
    const html = renderToStaticMarkup(await OnboardingPage());
    expect(html).toContain("Set up your clinic");
    expect(html).toContain('data-testid="create-organization"');
  });
});
