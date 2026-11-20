import { describe, expect, it } from "vitest";
import { INVITED_CLINIC_MAX, invitationAcceptUrl, invitationHeading, readInvitedClinicName } from "./invitation-name";

describe("the clinic's name in an invitation's accept address", () => {
  it("adds the name to the server's own sign-up address, encoded", () => {
    expect(invitationAcceptUrl("https://example.test/sign-up", "Wasatch Orthopedics & Spine")).toBe("https://example.test/sign-up?clinic=Wasatch+Orthopedics+%26+Spine");
  });

  it("leaves the address alone when there is no usable name", () => {
    expect(invitationAcceptUrl("https://example.test/sign-up", null)).toBe("https://example.test/sign-up");
    expect(invitationAcceptUrl("https://example.test/sign-up", "   ")).toBe("https://example.test/sign-up");
    expect(invitationAcceptUrl("https://example.test/sign-up", "x".repeat(INVITED_CLINIC_MAX + 1))).toBe("https://example.test/sign-up");
  });
});

describe("reading the name back on the sign-up page", () => {
  it("tidies spaces and takes out control characters", () => {
    expect(readInvitedClinicName("  Wasatch \n  Orthopedics\u0000 ")).toBe("Wasatch Orthopedics");
  });

  it("refuses anything that is not a short piece of text", () => {
    expect(readInvitedClinicName(undefined)).toBeNull();
    expect(readInvitedClinicName(["a", "b"])).toBeNull();
    expect(readInvitedClinicName("")).toBeNull();
    expect(readInvitedClinicName("x".repeat(INVITED_CLINIC_MAX + 1))).toBeNull();
    expect(readInvitedClinicName("x".repeat(INVITED_CLINIC_MAX))).toHaveLength(INVITED_CLINIC_MAX);
  });

  it("makes the heading, with or without a name", () => {
    expect(invitationHeading("Wasatch Orthopedics")).toBe("Accept your invitation to join Wasatch Orthopedics.");
    expect(invitationHeading(null)).toBe("Accept your invitation.");
  });
});
