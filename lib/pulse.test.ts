import { auth, clerkClient } from "@clerk/nextjs/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPulseStaffUser, isPulseStaff, pulseStaffFromMetadata, requirePulseStaff } from "./pulse";

/**
 * The one gate for /pulse, with Clerk replaced by a stand-in so the test
 * can play a signed-out visitor, an ordinary clinic user and a staff member
 * in turn. No database.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

/** Pretend Clerk says this user is signed in and has this public metadata. */
function signInAs(userId: string | null, publicMetadata: Record<string, unknown>, names: { firstName?: string; lastName?: string } = {}) {
  vi.mocked(auth).mockResolvedValue({ userId } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: async () => ({
        publicMetadata,
        firstName: names.firstName ?? null,
        lastName: names.lastName ?? null,
        emailAddresses: [{ emailAddress: "someone@example.com" }],
      }),
    },
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("pulseStaffFromMetadata", () => {
  it("is true only for the exact boolean true", () => {
    expect(pulseStaffFromMetadata({ pulseStaff: true })).toBe(true);
    expect(pulseStaffFromMetadata({ pulseStaff: "true" })).toBe(false);
    expect(pulseStaffFromMetadata({ pulseStaff: 1 })).toBe(false);
    expect(pulseStaffFromMetadata({})).toBe(false);
    expect(pulseStaffFromMetadata(null)).toBe(false);
    expect(pulseStaffFromMetadata(undefined)).toBe(false);
  });
});

describe("isPulseStaff", () => {
  it("is false when nobody is signed in, without asking Clerk for a user", async () => {
    signInAs(null, { pulseStaff: true });
    expect(await isPulseStaff()).toBe(false);
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("is false for an ordinary clinic user", async () => {
    signInAs("user_clinic", { kind: "surgeon" });
    expect(await isPulseStaff()).toBe(false);
  });

  it("is true for a user whose public metadata has pulseStaff: true", async () => {
    signInAs("user_staff", { pulseStaff: true }, { firstName: "Evan", lastName: "Miller" });
    expect(await isPulseStaff()).toBe(true);
    expect(await getPulseStaffUser()).toEqual({ userId: "user_staff", name: "Evan Miller" });
  });

  it("falls back to the email, then the user id, for the staff name", async () => {
    signInAs("user_staff", { pulseStaff: true });
    expect((await getPulseStaffUser())?.name).toBe("someone@example.com");
  });
});

describe("requirePulseStaff", () => {
  it("ends the request with not-found for a non-staff user", async () => {
    signInAs("user_clinic", {});
    // notFound() throws an error Next.js recognises by its digest.
    await expect(requirePulseStaff()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("returns the staff user otherwise", async () => {
    signInAs("user_staff", { pulseStaff: true }, { firstName: "Van" });
    expect(await requirePulseStaff()).toEqual({ userId: "user_staff", name: "Van" });
  });
});
