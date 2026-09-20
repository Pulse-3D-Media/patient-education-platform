import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { listSeatRows } from "@/lib/db/seats";
import { fakeClerk } from "@/lib/testing/fake-clerk";
import { setMyKindAction } from "./actions";

/**
 * The surgeon question's Server Action. Clerk is a stand-in; the database is
 * real (the testing branch).
 *
 * On success the action redirects to the library, which Next.js does by
 * throwing; `sentToLibrary` catches that and says so.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());

const createdClinicIds: string[] = [];
const id = () => randomBytes(6).toString("hex");
const user = () => `user_vitest${id()}`;

async function makeClinic(surgeonSeats: number, members: Parameters<typeof fakeClerk.addOrg>[2]) {
  const orgId = `org_test_${id()}`;
  // PENDING, which is what a clinic is while its first people answer this question.
  const clinic = await prisma.clinic.create({
    data: { name: "Vitest onboarding clinic", status: "PENDING", clerkOrgId: orgId, surgeonSeats },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  fakeClerk.addOrg(orgId, "Vitest onboarding clinic", members);
  return { clinicId: clinic.id, orgId };
}

/** Run the action. True when it redirected to the library; otherwise whatever it returned. */
async function answer(value: unknown) {
  try {
    return await setMyKindAction(value);
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT") && digest.includes("/library")) return "sentToLibrary" as const;
    throw error;
  }
}

beforeEach(() => {
  fakeClerk.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("setMyKindAction", () => {
  it("'No' records staff, takes no seat, and sends them to the library", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(2, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);

    expect(await answer("staff")).toBe("sentToLibrary");
    expect(fakeClerk.kindOf(orgId, me)).toBe("staff");
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("'Yes' with a seat free takes it", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(2, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);

    expect(await answer("surgeon")).toBe("sentToLibrary");
    expect(await listSeatRows(clinicId)).toMatchObject([{ clerkUserId: me, syncState: "SYNCED" }]);
  });

  it("'Yes' at a clinic that has not paid yet is kept as a request: let in, no seat taken", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(0, [{ userId: me, role: "org:admin" }]);
    fakeClerk.signIn(me, orgId);

    expect(await answer("surgeon")).toBe("sentToLibrary");
    expect(fakeClerk.kindOf(orgId, me)).toBe("surgeon");
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("an answered question cannot be sent again: 'No' cannot be turned into a seat later", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(5, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);
    await answer("staff");
    const writes = fakeClerk.writes.length;

    // The same action, sent again by hand with the other answer.
    expect(await answer("surgeon")).toBe("sentToLibrary"); // sent on, exactly as the page would
    expect(fakeClerk.kindOf(orgId, me)).toBe("staff"); // and nothing was changed
    expect(fakeClerk.writes).toHaveLength(writes);
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("nor can a kind an admin set be overturned from here", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(5, [{ userId: me, kind: "staff" }]); // marked staff on the People page
    fakeClerk.signIn(me, orgId);

    expect(await answer("surgeon")).toBe("sentToLibrary");
    expect(fakeClerk.kindOf(orgId, me)).toBe("staff");
    expect(await listSeatRows(clinicId)).toEqual([]);
  });

  it("the same first answer sent twice at once ends with one seat", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(3, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);

    expect(await Promise.all([answer("surgeon"), answer("surgeon")])).toEqual(["sentToLibrary", "sentToLibrary"]);
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });

  it("only ever changes the signed-in person, in their own clinic", async () => {
    const [me, colleague, stranger] = [user(), user(), user()];
    const mine = await makeClinic(3, [{ userId: me }, { userId: colleague }]);
    const other = await makeClinic(3, [{ userId: stranger }]);
    fakeClerk.signIn(me, mine.orgId);

    await answer("surgeon");

    // The action takes no user id and no clinic id at all, so there is nothing to forge.
    expect(fakeClerk.writes).toEqual([{ orgId: mine.orgId, userId: me, kind: "surgeon", failed: false }]);
    expect(fakeClerk.kindOf(mine.orgId, colleague)).toBeUndefined();
    expect(await listSeatRows(other.clinicId)).toEqual([]);
  });

  it("refuses an answer that is neither, and someone who is signed out", async () => {
    const me = user();
    const { orgId } = await makeClinic(1, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);
    expect(await answer("admin")).toEqual({ error: "Choose Yes or No." });
    expect(await answer(undefined)).toEqual({ error: "Choose Yes or No." });

    fakeClerk.signIn(null, null);
    expect(await answer("surgeon")).toEqual({ error: "You are not signed in to a clinic. Sign in and try again." });
    expect(fakeClerk.writes).toEqual([]);
  });

  it("when Clerk fails, they see a plain sentence, no seat is left held, and they can answer again", async () => {
    const me = user();
    const { clinicId, orgId } = await makeClinic(1, [{ userId: me }]);
    fakeClerk.signIn(me, orgId);
    fakeClerk.failNextWrites = 1;

    expect(await answer("surgeon")).toEqual({ error: "That could not be saved just now. Nothing was changed. Try again in a moment." });
    expect(await listSeatRows(clinicId)).toEqual([]);
    expect(fakeClerk.kindOf(orgId, me)).toBeUndefined(); // still unanswered, so they are asked again

    expect(await answer("surgeon")).toBe("sentToLibrary");
    expect(await listSeatRows(clinicId)).toHaveLength(1);
  });
});
