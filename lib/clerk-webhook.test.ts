import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_AUTHOR, FINDING_NOTES } from "./clerk-events";
import { handleClerkEvent } from "./clerk-webhook";
import { prisma } from "./db/client";
import { listNotesForClinic } from "./db/notes";
import { listSeatRows, reserveSeat } from "./db/seats";
import type { sendEmail } from "./email";
import { fakeClerk } from "./testing/fake-clerk";

/**
 * The Clerk webhook's work, end to end: the real database (the testing
 * database) and the in-memory stand-in for Clerk, with things done "in
 * Clerk directly" by the stand-in's own methods, then the notification
 * Clerk would send handed to handleClerkEvent().
 *
 * What these prove: an owner removed or stripped of admin in Clerk is
 * written up under "Clerk" and emailed to Pulse once, whatever the number
 * of deliveries; nothing is written for anyone but the owner; the
 * notification's word is never taken over what Clerk says now; and a
 * failure writes nothing. The signature check is the route's test.
 *
 * A stand-in is not Clerk: one real notification from a Clerk development
 * instance, after the endpoint is set up, is the other check.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 30_000 });

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;
const ENV = { RESEND_API_KEY: "re_madeup", EMAIL_FROM: "app@example.test", ERROR_ALERT_EMAIL: "pulse@example.test" };

let send: ReturnType<typeof vi.fn<typeof sendEmail>>;

async function makeClinic(others: Parameters<typeof fakeClerk.addOrg>[2] = []) {
  const orgId = `org_test${id()}`;
  const owner = user();
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest clerk webhook ${id()}`, status: "ACTIVE", clerkOrgId: orgId, surgeonSeats: 2, ownerClerkUserId: owner },
    select: { id: true, name: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, clinic.name, [{ userId: owner, firstName: "Olive", lastName: "Owner", role: "org:admin", joinedAt: 1 }, ...(others ?? [])], owner);
  return { clinicId: clinic.id, name: clinic.name, orgId, owner };
}

const clerkEntries = async (clinicId: string) => (await listNotesForClinic(clinicId)).filter((note) => note.authorName === CLERK_AUTHOR).map((note) => note.body);
const ownerOf = async (clinicId: string) => (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }))?.ownerClerkUserId;
const membership = (orgId: string, userId: string) => ({ kind: "membership" as const, orgId, userId });

beforeEach(() => {
  fakeClerk.reset();
  send = vi.fn<typeof sendEmail>(async () => ({ sent: true }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("the owner removed in Clerk directly", () => {
  it("clears the owner, writes one entry under Clerk, and emails Pulse once keyed by the delivery", async () => {
    const { clinicId, name, orgId, owner } = await makeClinic([{ userId: user(), firstName: "Ada", lastName: "Admin", role: "org:admin" }]);
    fakeClerk.removeMember(orgId, owner);

    expect(await handleClerkEvent(membership(orgId, owner), "msg_abc123", { env: ENV, send })).toBe("owner-left");
    expect(await ownerOf(clinicId)).toBeNull();
    expect(await clerkEntries(clinicId)).toEqual([FINDING_NOTES["owner-left"]]);
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = send.mock.calls[0];
    expect(message).toMatchObject({ to: ["pulse@example.test"], idempotencyKey: "clerk-webhook-msg_abc123" });
    expect(message.subject).toContain(name);
    expect(message.text).toContain(`/pulse/clinics/${clinicId}`);
    expect(message.text).not.toContain(owner);

    // The same delivery again, and a late one: nothing new.
    expect(await handleClerkEvent(membership(orgId, owner), "msg_abc123", { env: ENV, send })).toBe("nothing-to-report");
    expect(await clerkEntries(clinicId)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("believes Clerk over the notification: an owner removed and added back before it arrives is nothing to report", async () => {
    const { clinicId, orgId, owner } = await makeClinic();
    fakeClerk.removeMember(orgId, owner);
    fakeClerk.addMember(orgId, { userId: owner, firstName: "Olive", lastName: "Owner", role: "org:admin" });

    expect(await handleClerkEvent(membership(orgId, owner), "msg_back1", { env: ENV, send })).toBe("nothing-to-report");
    expect(await ownerOf(clinicId)).toBe(owner);
    expect(await clerkEntries(clinicId)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("an owner who was the clinic's only member", () => {
  it("Clerk's empty member list counts as 'could not say', as on the People page: the owner is kept and nothing is written", async () => {
    const { clinicId, orgId, owner } = await makeClinic();
    fakeClerk.removeMember(orgId, owner);
    expect(await handleClerkEvent(membership(orgId, owner), "msg_alone", { env: ENV, send })).toBe("nothing-to-report");
    expect(await ownerOf(clinicId)).toBe(owner);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the owner's admin switched off in Clerk directly", () => {
  it("writes one entry, emails once, and a repeated delivery adds nothing", async () => {
    const { clinicId, orgId, owner } = await makeClinic();
    fakeClerk.setRoleOutsideTheApp(orgId, owner, "org:member");

    expect(await handleClerkEvent(membership(orgId, owner), "msg_role1", { env: ENV, send })).toBe("owner-not-admin");
    expect(await ownerOf(clinicId)).toBe(owner); // still the owner: only admin was switched off
    expect(await handleClerkEvent(membership(orgId, owner), "msg_role1", { env: ENV, send })).toBe("owner-not-admin");
    expect(await clerkEntries(clinicId)).toEqual([FINDING_NOTES["owner-not-admin"]]);
    expect(send.mock.calls.map(([message]) => message.idempotencyKey)).toEqual(["clerk-webhook-msg_role1", "clerk-webhook-msg_role1"]); // Resend drops the repeat
  });

  it("a notification about the owner whose admin is still on is nothing to report", async () => {
    const { clinicId, orgId, owner } = await makeClinic();
    expect(await handleClerkEvent(membership(orgId, owner), "msg_role2", { env: ENV, send })).toBe("nothing-to-report");
    expect(await clerkEntries(clinicId)).toEqual([]);
  });
});

describe("people other than the owner", () => {
  it("someone else removed: the seat check lets their seat go, and nothing is written under Clerk or emailed", async () => {
    const other = user();
    const { clinicId, orgId } = await makeClinic([{ userId: other, firstName: "Dee", lastName: "Doctor" }]);
    await reserveSeat(clinicId, other);
    fakeClerk.removeMember(orgId, other);

    expect(await handleClerkEvent(membership(orgId, other), "msg_other", { env: ENV, send })).toBe("nothing-to-report");
    expect((await listSeatRows(clinicId)).map((row) => row.clerkUserId)).toEqual([]);
    expect(await clerkEntries(clinicId)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("a notification naming someone else, while the owner's admin happens to be off, says nothing about the owner", async () => {
    const other = user();
    const { clinicId, orgId, owner } = await makeClinic([{ userId: other }]);
    fakeClerk.setRoleOutsideTheApp(orgId, owner, "org:member");
    expect(await handleClerkEvent(membership(orgId, other), "msg_other2", { env: ENV, send })).toBe("nothing-to-report");
    expect(await clerkEntries(clinicId)).toEqual([]);
  });
});

describe("the organization deleted in Clerk", () => {
  it("writes one entry saying the card keeps charging, and a repeated delivery adds no second entry", async () => {
    const { clinicId, orgId } = await makeClinic();
    expect(await handleClerkEvent({ kind: "organization-deleted", orgId }, "msg_gone", { env: ENV, send })).toBe("organization-deleted");
    expect(await handleClerkEvent({ kind: "organization-deleted", orgId }, "msg_gone", { env: ENV, send })).toBe("organization-deleted");
    expect(await clerkEntries(clinicId)).toEqual([FINDING_NOTES["organization-deleted"]]);
    expect(FINDING_NOTES["organization-deleted"]).toContain("keeps charging until it is cancelled in Stripe");
  });
});

describe("what it never does", () => {
  it("an organization no clinic is linked to: nothing", async () => {
    expect(await handleClerkEvent(membership(`org_test${id()}`, user()), "msg_none", { env: ENV, send })).toBe("no-clinic");
    expect(send).not.toHaveBeenCalled();
  });

  it("Clerk unreachable: throws (so Clerk sends it again) and writes nothing", async () => {
    const { clinicId, orgId, owner } = await makeClinic();
    fakeClerk.removeMember(orgId, owner);
    fakeClerk.failReads = true;
    await expect(handleClerkEvent(membership(orgId, owner), "msg_down", { env: ENV, send })).rejects.toThrow();
    expect(await ownerOf(clinicId)).toBe(owner);
    expect(await clerkEntries(clinicId)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("one clinic's notification never touches another clinic", async () => {
    const first = await makeClinic();
    const second = await makeClinic();
    fakeClerk.removeMember(first.orgId, first.owner);
    fakeClerk.removeMember(second.orgId, second.owner);
    await handleClerkEvent(membership(first.orgId, first.owner), "msg_one", { env: ENV, send });
    expect(await ownerOf(second.clinicId)).toBe(second.owner);
    expect(await clerkEntries(second.clinicId)).toEqual([]);
  });

  it("no ERROR_ALERT_EMAIL: the entry is still written, and nothing is sent", async () => {
    const { clinicId, orgId, owner } = await makeClinic([{ userId: user(), role: "org:admin" }]);
    fakeClerk.removeMember(orgId, owner);
    expect(await handleClerkEvent(membership(orgId, owner), "msg_quiet", { env: { RESEND_API_KEY: "re_madeup", EMAIL_FROM: "app@example.test" }, send })).toBe("owner-left");
    expect(await clerkEntries(clinicId)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});
