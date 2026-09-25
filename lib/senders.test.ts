import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import { listSenders, resolveSender } from "./senders";
import { fakeClerk } from "./testing/fake-clerk";

/**
 * Who a link can be from: the doctor dropdown on /admin/links (listSenders)
 * and the server's check of a choice (resolveSender), with the real database
 * (the Neon testing branch) and the in-memory stand-in for Clerk.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
vi.setConfig({ testTimeout: 20_000 });

const createdClinicIds: string[] = [];
const tag = () => randomBytes(6).toString("hex");
const user = (name: string) => `user_${name}${tag()}`;

/** An open clinic with these people in its organization, and seats for `seated` (with a typed name where given). */
async function makeClinic(people: Parameters<typeof fakeClerk.addOrg>[2], seated: { userId: string; displayName?: string }[], owner: string | null = null) {
  const orgId = `org_test_${tag()}`;
  fakeClerk.addOrg(orgId, "Vitest senders clinic", people, owner);
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest senders clinic ${tag()}`,
      clerkOrgId: orgId,
      status: "ACTIVE",
      surgeonSeats: 5,
      ownerClerkUserId: owner,
      seatAllocations: { create: seated.map((seat) => ({ clerkUserId: seat.userId, syncState: "SYNCED" as const, displayName: seat.displayName ?? null })) },
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return { clinicId: clinic.id, orgId };
}

beforeEach(() => {
  fakeClerk.reset();
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  fakeClerk.reset();
  await prisma.$disconnect();
});

describe("listSenders: the doctor dropdown", () => {
  it("lists only the people holding a seat, with what patients will see, and never the owner who took no seat", async () => {
    const [owner, jane, pat, waiting, nameless] = [user("owner"), user("jane"), user("pat"), user("waiting"), user("nameless")];
    const { clinicId } = await makeClinic(
      [
        { userId: owner, firstName: "Olive", lastName: "Owner", role: "org:admin" },
        { userId: jane, firstName: "Jane", lastName: "Smith" },
        { userId: pat, firstName: "Pat", lastName: "Lee" },
        { userId: waiting, firstName: "Wai", lastName: "Ting" },
        { userId: nameless, firstName: "", lastName: "", identifier: "nameless@example.test" },
      ],
      [{ userId: jane }, { userId: pat, displayName: "Pat Lee, PA-C" }, { userId: nameless }],
      owner,
    );

    const senders = await listSenders(clinicId);
    expect(senders.map((sender) => sender.userId).sort()).toEqual([jane, pat, nameless].sort());
    expect(senders.find((sender) => sender.userId === jane)).toEqual({ userId: jane, name: "Jane Smith", patientName: "Dr. Jane Smith" });
    expect(senders.find((sender) => sender.userId === pat)?.patientName).toBe("Pat Lee, PA-C");
    // No name in Clerk: the office sees their email to tell who it is, but patients would see no name, never the email.
    expect(senders.find((sender) => sender.userId === nameless)).toEqual({ userId: nameless, name: "nameless@example.test", patientName: null });
  });

  it("leaves out someone whose seat outlived their membership, and never lists another clinic's people", async () => {
    const [kept, left] = [user("kept"), user("left")];
    const { clinicId, orgId } = await makeClinic(
      [
        { userId: kept, firstName: "Kept", lastName: "Here" },
        { userId: left, firstName: "Left", lastName: "Already" },
      ],
      [{ userId: kept }, { userId: left }],
    );
    fakeClerk.removeMember(orgId, left);
    const other = user("other");
    await makeClinic([{ userId: other, firstName: "Other", lastName: "Clinic" }], [{ userId: other }]);

    expect((await listSenders(clinicId)).map((sender) => sender.userId)).toEqual([kept]);
  });

  it("throws when Clerk cannot be read, so the page can say so instead of offering nobody", async () => {
    const jane = user("jane");
    const { clinicId } = await makeClinic([{ userId: jane, firstName: "Jane", lastName: "Smith" }], [{ userId: jane }]);
    fakeClerk.failReads = true;
    await expect(listSenders(clinicId)).rejects.toThrow();
  });
});

describe("resolveSender: the server's check of a choice", () => {
  it("accepts someone in this clinic, with the name from Clerk as the fallback", async () => {
    const jane = user("jane");
    const { clinicId } = await makeClinic([{ userId: jane, firstName: "Jane", lastName: "Smith" }], [{ userId: jane }]);
    expect(await resolveSender(clinicId, jane)).toEqual({ ok: true, sender: { clerkUserId: jane, fallbackName: "Dr. Jane Smith" } });
  });

  it("refuses nobody, junk, and someone from another clinic", async () => {
    const jane = user("jane");
    const { clinicId } = await makeClinic([{ userId: jane, firstName: "Jane", lastName: "Smith" }], [{ userId: jane }]);
    const other = user("other");
    await makeClinic([{ userId: other, firstName: "Other", lastName: "Clinic" }], [{ userId: other }]);

    expect(await resolveSender(clinicId, "")).toEqual({ ok: false, message: "Choose who the link is from." });
    expect(await resolveSender(clinicId, 42)).toEqual({ ok: false, message: "Choose who the link is from." });
    expect(await resolveSender(clinicId, "not a user")).toMatchObject({ ok: false, message: expect.stringContaining("does not hold a seat") });
    expect(await resolveSender(clinicId, other)).toMatchObject({ ok: false, message: expect.stringContaining("does not hold a seat") });
  });
});
