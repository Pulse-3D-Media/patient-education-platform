import { auth, clerkClient } from "@clerk/nextjs/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_TIMEOUT_MS, SignInUnavailableError } from "./clerk-timeout";
import { getClinicForShell, getCurrentClinic, requireClinicPage } from "./clinic";
import { getClinicByClerkOrgId, upsertClinicForClerkOrg } from "./db/clinics";

/**
 * The clinic lookup when Clerk is slow or down. Clerk, the clinic table
 * and Next's redirect are stand-ins, and the clock is the test's, so a
 * five-second wait takes no time. No database.
 *
 * What these prove: a Clerk that never answers, or answers with a failure,
 * ends in the one sign-in error after the time limit (never a hang), with
 * nothing written; the layouts' lookup answers null instead of failing;
 * the page lookup lets the error through to the error page rather than
 * redirecting; and a normal answer still builds the clinic as before.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: Object.assign(vi.fn(), { protect: vi.fn() }), clerkClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  // Rethrows only Next's own signals (a redirect, a not-found), none of which these tests raise.
  unstable_rethrow: () => {},
}));
vi.mock("./db/clinics", () => ({ getClinicByClerkOrgId: vi.fn(), upsertClinicForClerkOrg: vi.fn() }));

/** A promise that never settles: Clerk not answering. */
const never = () => new Promise<never>(() => {});

function signedIn(membershipList: () => Promise<unknown>) {
  vi.mocked(auth).mockResolvedValue({ userId: "user_vitest", orgId: "org_vitest", has: () => true } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({ organizations: { getOrganizationMembershipList: membershipList } } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("getCurrentClinic when Clerk does not answer", () => {
  it("gives up after the time limit with the sign-in error, and writes no clinic", async () => {
    signedIn(never);
    const asked = getCurrentClinic();
    const outcome = expect(asked).rejects.toBeInstanceOf(SignInUnavailableError);
    await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS);
    await outcome;
    expect(upsertClinicForClerkOrg).not.toHaveBeenCalled();
  });

  it("is still waiting just before the limit", async () => {
    signedIn(never);
    let settled = false;
    const asked = getCurrentClinic().catch(() => {}).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await asked;
    expect(settled).toBe(true);
  });

  it("answers a failure from Clerk with the same sign-in error at once", async () => {
    signedIn(() => Promise.reject(Object.assign(new Error("Clerk: 503"), { status: 503 })));
    await expect(getCurrentClinic()).rejects.toBeInstanceOf(SignInUnavailableError);
    expect(upsertClinicForClerkOrg).not.toHaveBeenCalled();
  });

  it("the layouts' lookup answers null instead, so the shell is still drawn", async () => {
    signedIn(never);
    const shell = getClinicForShell();
    await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS);
    await expect(shell).resolves.toBeNull();
  });

  it("the page lookup lets the sign-in error through to the error page, rather than redirecting to onboarding", async () => {
    signedIn(never);
    const page = requireClinicPage();
    const outcome = expect(page).rejects.toBeInstanceOf(SignInUnavailableError);
    await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS);
    await outcome;
    await expect(page).rejects.not.toThrow(/redirect:/);
  });
});

describe("getCurrentClinic when Clerk answers", () => {
  it("is null when nobody is signed in, without asking Clerk", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, orgId: null, has: () => false } as never);
    await expect(getCurrentClinic()).resolves.toBeNull();
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("builds the clinic from the membership as before", async () => {
    signedIn(async () => ({
      data: [{ organization: { name: "Vitest Clinic", hasImage: false, imageUrl: "", createdBy: "user_vitest", membersCount: 1 } }],
      totalCount: 1,
    }));
    vi.mocked(upsertClinicForClerkOrg).mockResolvedValue({
      id: "clinic_vitest",
      name: "Vitest Clinic",
      clerkOrgId: "org_vitest",
      status: "ACTIVE",
      graceEndsAt: null,
      practiceType: "UNKNOWN",
      logoUrl: null,
      noticeText: null,
      showPlaceholders: true,
      phone: null,
      brandColor: null,
      brandFont: null,
      brandTheme: null,
      ownerClerkUserId: "user_vitest",
    } as never);

    const clinic = await getCurrentClinic();
    expect(clinic).toMatchObject({ id: "clinic_vitest", name: "Vitest Clinic", status: "ACTIVE", isOwner: true, isAdmin: true });
    expect(upsertClinicForClerkOrg).toHaveBeenCalledWith("org_vitest", { name: "Vitest Clinic", logoUrl: null, creatorClerkUserId: "user_vitest" });
    expect(getClinicByClerkOrgId).not.toHaveBeenCalled();
    // The timer the limit set is cleared once Clerk has answered.
    expect(vi.getTimerCount()).toBe(0);
  });
});
