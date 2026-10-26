import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInUnavailableError, isSignInUnavailable } from "./clerk-timeout";
import { getMember, getSignedInName, invitationIsOpen, isClerkTimeout, listOpenInvitations, listPeople } from "./people";
import { fakeClerk } from "./testing/fake-clerk";

/**
 * Every question lib/people.ts asks Clerk has the five-second limit
 * (askClerk). With the stand-in made to stop answering, each one gives up
 * with the one error the pages and actions already answer in plain words,
 * instead of waiting for ever. No database is needed.
 */

vi.mock("@clerk/nextjs/server", async () => (await import("@/lib/testing/fake-clerk")).clerkServerModule());
// Several five-second waits in one test.
vi.setConfig({ testTimeout: 60_000 });

const ORG = "org_test_peopletimeout";
const ADMIN = "user_vitestpeopletimeoutadmin";

beforeEach(() => {
  fakeClerk.reset();
  fakeClerk.addOrg(ORG, "Vitest people timeout", [{ userId: ADMIN, role: "org:admin" }], ADMIN);
  fakeClerk.signIn(ADMIN, ORG);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a Clerk that answers", () => {
  it("is read as before", async () => {
    expect((await listPeople(ORG)).map((person) => person.userId)).toEqual([ADMIN]);
    expect((await getMember(ORG, ADMIN))?.role).toBe("admin");
    expect(await listOpenInvitations(ORG)).toEqual([]);
    expect(await getSignedInName()).toMatch(/^Test /);
  });

  it("still reads an invitation Clerk does not have as not open (a 404 is an answer, not a failure)", async () => {
    expect(await invitationIsOpen(ORG, "orginv_madeup")).toBe(false);
  });
});

describe("a Clerk that does not answer", () => {
  it("ends every read with SignInUnavailableError after the limit, marked as a timeout", async () => {
    fakeClerk.hangReads = true;
    const reads: [string, () => Promise<unknown>][] = [
      ["listPeople", () => listPeople(ORG)],
      ["getMember", () => getMember(ORG, ADMIN)],
      ["listOpenInvitations", () => listOpenInvitations(ORG)],
      ["invitationIsOpen", () => invitationIsOpen(ORG, "orginv_madeup")],
      ["getSignedInName", () => getSignedInName()],
    ];
    const outcomes = await Promise.all(
      reads.map(async ([name, read]) => {
        const started = Date.now();
        const error = await read().then(
          () => null,
          (thrown: unknown) => thrown,
        );
        return { name, error, waited: Date.now() - started };
      }),
    );
    for (const { name, error, waited } of outcomes) {
      expect(error, name).toBeInstanceOf(SignInUnavailableError);
      expect(isSignInUnavailable(error), name).toBe(true);
      expect(isClerkTimeout(error), name).toBe(true);
      expect(waited, name).toBeGreaterThanOrEqual(4_900);
    }
  });

  it("tells a refusal from a timeout: a Clerk that answers with a failure is not a timeout", async () => {
    fakeClerk.failReads = true;
    const error = await listPeople(ORG).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(SignInUnavailableError);
    expect(isClerkTimeout(error)).toBe(false);
  });
});
