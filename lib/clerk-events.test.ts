import { describe, expect, it } from "vitest";
import { FINDING_NOTES, findingEmail, readClerkEvent, readDeliveryId } from "./clerk-events";

describe("readClerkEvent", () => {
  it("takes the organization id and the member's user id from a membership notification, and nothing else", () => {
    for (const type of ["organizationMembership.created", "organizationMembership.updated", "organizationMembership.deleted"]) {
      expect(readClerkEvent({ type, data: { organization: { id: "org_abc" }, public_user_data: { user_id: "user_xyz", identifier: "a@example.test" }, role: "org:member" } })).toEqual({
        kind: "membership",
        orgId: "org_abc",
        userId: "user_xyz",
      });
    }
  });

  it("a membership with no usable user id still names the clinic", () => {
    expect(readClerkEvent({ type: "organizationMembership.updated", data: { organization: { id: "org_abc" }, public_user_data: { user_id: "x'; drop" } } })).toEqual({ kind: "membership", orgId: "org_abc", userId: null });
  });

  it("reads a deleted organization", () => {
    expect(readClerkEvent({ type: "organization.deleted", data: { id: "org_abc", deleted: true } })).toEqual({ kind: "organization-deleted", orgId: "org_abc" });
  });

  it("drops other kinds, junk, and ids that are not Clerk ids", () => {
    expect(readClerkEvent({ type: "user.updated", data: { id: "user_xyz" } })).toBeNull();
    expect(readClerkEvent({ type: "organization.updated", data: { id: "org_abc" } })).toBeNull();
    expect(readClerkEvent({ type: "organization.deleted", data: { id: "user_abc" } })).toBeNull();
    expect(readClerkEvent({ type: "organizationMembership.deleted", data: { organization: { id: "org_" } } })).toBeNull();
    expect(readClerkEvent({ type: "organizationMembership.deleted", data: { organization: null } })).toBeNull();
    expect(readClerkEvent(null)).toBeNull();
    expect(readClerkEvent("organization.deleted")).toBeNull();
    expect(readClerkEvent({ type: 3, data: {} })).toBeNull();
  });
});

describe("readDeliveryId", () => {
  it("accepts Clerk's delivery ids and nothing else", () => {
    expect(readDeliveryId(" msg_2abcDEF ")).toBe("msg_2abcDEF");
    expect(readDeliveryId(null)).toBeNull();
    expect(readDeliveryId("msg_")).toBeNull();
    expect(readDeliveryId("msg_a b")).toBeNull();
    expect(readDeliveryId(`msg_${"a".repeat(65)}`)).toBeNull();
  });
});

describe("the words", () => {
  it("every entry says it was done in Clerk, not on our screens, and never calls the change ours", () => {
    for (const note of Object.values(FINDING_NOTES)) {
      expect(note.startsWith("Changed in Clerk, not on our screens:")).toBe(true);
      expect(note).toContain("Clerk does not say");
      expect(note).not.toContain("—");
    }
  });

  it("the email names the clinic and its /pulse path, keyed by the delivery, and carries the log's words", () => {
    const message = findingEmail("owner-left", { id: "clinic123", name: "Made-up <Clinic>" }, ["pulse@example.test"], "msg_abc");
    expect(message.idempotencyKey).toBe("clerk-webhook-msg_abc");
    expect(message.subject).toContain("Made-up <Clinic>");
    expect(message.text).toContain("/pulse/clinics/clinic123");
    expect(message.text).toContain(FINDING_NOTES["owner-left"]);
    expect(message.html).toContain("Made-up &lt;Clinic&gt;");
    expect(message.html).not.toContain("<Clinic>");
    expect(findingEmail("owner-left", { id: "c", name: "n" }, [], null).idempotencyKey).toBeUndefined();
  });
});
