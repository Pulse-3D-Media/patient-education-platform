import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenewalRequestFacts } from "./db/shares";
import type { Person } from "./people";
import { notifyClinicOfRenewalRequest, reactivateLink, renewalRequestEmail } from "./renewal-email";

/**
 * The email a clinic gets when a patient asks for a paused link back, with
 * plain values: Clerk's people list and the email service are stand-ins.
 * What these prove: the words say which procedure, which surgeon, when the
 * link was made and how many renewals are left, and nothing about a patient
 * (there is nothing to say); the one button opens the app's page and the
 * email says opening it turns nothing on; names cannot become markup; every
 * admin and no member is written to, once, under an idempotency key; and
 * without settings, an origin, an organization or any admins, nothing is
 * sent and a reason is answered.
 */

const env = { RESEND_API_KEY: "re_made_up_key_for_tests_only", EMAIL_FROM: "Pulse 3D <links@example.test>" };

const facts: RenewalRequestFacts = {
  code: "k7m2xq",
  videoTitle: "Total Knee <Replacement>",
  senderName: "Dr. Jane Smith",
  createdAt: new Date("2026-09-15T16:00:00.000Z"),
  renewalsLeft: 3,
  daysPerRenewal: 10,
  requestedAt: new Date("2026-09-25T16:00:00.000Z"),
  clinic: { id: "clinic_test", name: "Summit & Sons Orthopedics", clerkOrgId: "org_test_summit" },
};

function person(userId: string, role: "admin" | "member", email: string): Person {
  return { userId, name: `Person ${userId}`, email, imageUrl: "", role, joinedAt: 1, seatHoldId: null };
}
const people = [person("user_a", "admin", "office@example.test"), person("user_b", "admin", "manager@example.test"), person("user_c", "member", "surgeon@example.test")];

/** A stand-in for fetch that remembers each message it was handed. */
function service(status = 200) {
  const sent: { to: string[]; subject: string; text: string; html: string; key: string | undefined }[] = [];
  const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ to: body.to, subject: body.subject, text: body.text, html: body.html, key: (init?.headers as Record<string, string>)["Idempotency-Key"] });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { send, sent };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renewalRequestEmail", () => {
  const url = reactivateLink("https://example.test", facts.code);
  const email = renewalRequestEmail(facts, url);

  it("names the procedure, the surgeon, when the link was made and how many renewals are left, in the subject and both bodies", () => {
    expect(email.subject).toBe("A patient is asking for a paused link to be turned back on: Total Knee <Replacement>");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("Summit");
      expect(body).toContain("Dr. Jane Smith");
      expect(body).toContain("Sep 15, 2026");
      expect(body).toContain("3 more times");
      expect(body).toContain("10 days each");
    }
    expect(email.text).toContain("Procedure: Total Knee <Replacement>");
  });

  it("says nothing about the patient exists, because nothing does", () => {
    expect(email.text).toContain("Nothing about the patient is stored or sent");
    expect(email.html).toContain("Nothing about the patient is stored or sent");
  });

  it("has one button that opens the reactivate page in the app, and says opening it turns nothing on", () => {
    expect(url).toBe("https://example.test/admin/reactivate/k7m2xq");
    expect(email.text).toContain(url);
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html.match(/<a /g)).toHaveLength(1);
    expect(email.html).toContain("Reactivate this link");
    expect(email.text).toContain("turns nothing on by itself: only Confirm does");
    expect(email.html).toContain("turns nothing on by itself");
  });

  it("makes names harmless in the HTML, so a clinic or procedure name cannot become markup", () => {
    expect(email.html).toContain("Total Knee &lt;Replacement&gt;");
    expect(email.html).toContain("Summit &amp; Sons Orthopedics");
    expect(email.html).not.toContain("<Replacement>");
  });

  it("says the surgeon is not recorded on a link made before surgeons were", () => {
    const older = renewalRequestEmail({ ...facts, senderName: null, renewalsLeft: 1, daysPerRenewal: 1 }, url);
    expect(older.text).toContain("Link from: not recorded on this link");
    expect(older.text).toContain("1 more time, 1 day each");
  });
});

describe("notifyClinicOfRenewalRequest", () => {
  const listPeople = async () => people;

  it("emails every admin and no member, in one message, under a key made from the link and the request time", async () => {
    const { send, sent } = service();
    expect(await notifyClinicOfRenewalRequest(facts, "https://example.test", { env, fetch: send, people: listPeople })).toEqual({ told: true, recipients: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["office@example.test", "manager@example.test"]);
    expect(sent[0].to).not.toContain("surgeon@example.test");
    expect(sent[0].text).toContain("https://example.test/admin/reactivate/k7m2xq");
    expect(sent[0].key).toBe(`renewal-request-k7m2xq-${facts.requestedAt.getTime()}`);
  });

  it("sends nothing when email is not set up, and does not even read the clinic's people", async () => {
    const { send, sent } = service();
    const read = vi.fn(listPeople);
    expect(await notifyClinicOfRenewalRequest(facts, "https://example.test", { env: {}, fetch: send, people: read })).toEqual({ told: false, reason: "not-configured" });
    expect(read).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("sends nothing without a trusted origin to build the button from", async () => {
    const { send, sent } = service();
    expect(await notifyClinicOfRenewalRequest(facts, null, { env, fetch: send, people: listPeople })).toEqual({ told: false, reason: "no-origin" });
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a clinic with no organization, or with no admins in it", async () => {
    const { send, sent } = service();
    const noOrg = { ...facts, clinic: { ...facts.clinic, clerkOrgId: null } };
    expect(await notifyClinicOfRenewalRequest(noOrg, "https://example.test", { env, fetch: send, people: listPeople })).toEqual({ told: false, reason: "no-organization" });
    const membersOnly = async () => people.filter((one) => one.role === "member");
    expect(await notifyClinicOfRenewalRequest(facts, "https://example.test", { env, fetch: send, people: membersOnly })).toEqual({ told: false, reason: "no-admins" });
    expect(sent).toHaveLength(0);
  });

  it("answers a reason, and never throws, when the people cannot be read or the service refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = service(401);
    const unreadable = async () => {
      throw new Error("Clerk is down");
    };
    expect(await notifyClinicOfRenewalRequest(facts, "https://example.test", { env, fetch: send, people: unreadable })).toEqual({ told: false, reason: "people-unreadable" });
    expect(await notifyClinicOfRenewalRequest(facts, "https://example.test", { env, fetch: send, people: listPeople })).toEqual({ told: false, reason: "refused" });
  });
});
