import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import { formerOwnerEmail, newOwnerEmail, ownerEmailKey, sendOwnerEmails, sendOwnerEmailsLater, type OwnerChange, type OwnerEmailOptions } from "./owner-email";
import type { Person } from "./people";

/**
 * The owner emails: the words, and one send against the real test database
 * with a stand-in for Clerk (who the people are) and for Resend (what was
 * sent). Nothing leaves this computer. Made-up names and addresses only.
 */

const ENV = {
  RESEND_API_KEY: "re_madeup_for_tests",
  EMAIL_FROM: "Pulse 3D <no-reply@example.test>",
  APP_ORIGINS: "https://app.example.test",
};
const ORIGIN = "https://app.example.test";
const CLINIC_NAME = "Vitest Owner Orthopaedics";
const NEW_OWNER: Person = { userId: "user_vitestnewowner", name: "Nia Vitest", email: "nia.vitest@example.test", imageUrl: "", role: "admin", joinedAt: 0, seatHoldId: null };
const OLD_OWNER: Person = { userId: "user_vitestoldowner", name: "Olive Vitest", email: "olive.vitest@example.test", imageUrl: "", role: "admin", joinedAt: 0, seatHoldId: null };
const clinicIds: string[] = [];

async function clinic(owner: string | null = NEW_OWNER.userId) {
  const row = await prisma.clinic.create({
    data: { name: CLINIC_NAME, clerkOrgId: `org_vitestowner${randomBytes(8).toString("hex")}`, ownerClerkUserId: owner, status: "ACTIVE" },
    select: { id: true },
  });
  clinicIds.push(row.id);
  return row.id;
}

/** A stand-in for Resend that accepts everything (or refuses, or cannot be reached) and keeps what it was sent. */
function resend(answer: "ok" | "refuse" | "down" = "ok") {
  const sent: { body: Record<string, unknown>; key: string | null }[] = [];
  const fetchStandIn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (answer === "down") throw new TypeError("fetch failed: nia.vitest@example.test");
    const headers = init?.headers as Record<string, string>;
    sent.push({ body: JSON.parse(String(init?.body)), key: headers["Idempotency-Key"] ?? null });
    return new Response("{}", { status: answer === "ok" ? 200 : 403 });
  });
  return { sent, fetch: fetchStandIn as unknown as typeof fetch };
}

const people = (...known: Person[]) => async (_org: string, userId: string) => known.find((person) => person.userId === userId) ?? null;
const options = (extra: Partial<OwnerEmailOptions> = {}): OwnerEmailOptions => ({ env: ENV, member: people(NEW_OWNER, OLD_OWNER), ...extra });
const change = (clinicId: string, extra: Partial<OwnerChange> = {}): OwnerChange => ({
  clinicId,
  changeId: `note_${randomBytes(6).toString("hex")}`,
  newOwnerId: NEW_OWNER.userId,
  changedBy: { handedOverBy: OLD_OWNER.name },
  ...extra,
});

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const keep = (...args: unknown[]) => void logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "log").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
});

/** No log line may hold an address, a person's name or the clinic's name. */
function expectCleanLogs() {
  for (const line of logs) {
    for (const secret of [NEW_OWNER.email, OLD_OWNER.email, NEW_OWNER.name, OLD_OWNER.name, CLINIC_NAME, "@"]) expect(line).not.toContain(secret);
  }
}

describe("the words", () => {
  it("tells the new owner which clinic, who handed it over, what it means, and links to People on the app's own address", () => {
    const email = newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: { handedOverBy: "Olive Vitest" }, origin: ORIGIN, canReply: false });
    expect(email.subject).toBe(`You are now the account owner for ${CLINIC_NAME}`);
    expect(email.text).toBe(
      [
        `You are now the account owner for ${CLINIC_NAME}.`,
        "",
        "Olive Vitest handed the account over to you.",
        "",
        "As the account owner you are always an admin, and nobody can remove you or switch your admin off on the People page. You also decide for yourself whether you take a seat.",
        "",
        "If someone else should run the account later, you can hand it over to them on the People page.",
        "",
        `Open People: ${ORIGIN}/admin/people`,
        "",
        "You're getting this because you were made the account owner of a clinic on Pulse 3D.",
      ].join("\n"),
    );
    expect(email.html).toContain(`href="${ORIGIN}/admin/people"`);
    expect(email.html).toContain(`src="${ORIGIN}/pulse-3d-logo.png"`);
  });

  it("says Pulse 3D made the change when staff did, never the staff member's name, and leaves the line out when nobody is known", () => {
    expect(newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: { pulse: true }, origin: ORIGIN, canReply: false }).text).toContain("\n\nPulse 3D made this change.\n\n");
    const unnamed = newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: null, origin: ORIGIN, canReply: false }).text;
    expect(unnamed).not.toContain("made this change");
    expect(unnamed).not.toContain("handed the account over");
  });

  it("only offers a reply when replies reach a person", () => {
    expect(newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: null, origin: ORIGIN, canReply: false }).text).not.toContain("Reply");
    const replying = newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: null, origin: ORIGIN, canReply: true });
    expect(replying.text).toContain("Questions? Reply to this email and a person will answer.");
    expect(replying.html).toContain("Questions? Reply to this email and a person will answer.");
  });

  it("says nothing about billing, consent or patients, and has no em dash", () => {
    for (const email of [
      newOwnerEmail({ clinicName: CLINIC_NAME, changedBy: { pulse: true }, origin: ORIGIN, canReply: true }),
      formerOwnerEmail({ clinicName: CLINIC_NAME, newOwnerName: "Nia Vitest", stillAdmin: true, origin: ORIGIN, canReply: true }),
    ]) {
      for (const part of [email.subject, email.text, email.html]) {
        expect(part).not.toMatch(/—|–|billing|payment|consent|patient/i);
      }
    }
  });

  it("makes a clinic name harmless in the HTML", () => {
    const email = newOwnerEmail({ clinicName: `<b>"Bone" & Joint</b>`, changedBy: { handedOverBy: "<i>x</i>" }, origin: ORIGIN, canReply: false });
    expect(email.html).not.toContain("<b>");
    expect(email.html).not.toContain("<i>");
    expect(email.html).toContain("&lt;b&gt;&quot;Bone&quot; &amp; Joint&lt;/b&gt;");
  });

  it("tells a former owner who the owner is now, and sends a non-admin to the library", () => {
    const admin = formerOwnerEmail({ clinicName: CLINIC_NAME, newOwnerName: "Nia Vitest", stillAdmin: true, origin: ORIGIN, canReply: false });
    expect(admin.subject).toBe(`You are no longer the account owner for ${CLINIC_NAME}`);
    expect(admin.text).toBe(
      [
        `You are no longer the account owner for ${CLINIC_NAME}.`,
        "",
        "Pulse 3D made Nia Vitest the account owner.",
        "",
        "You are still in the clinic, and still an admin.",
        "",
        `Open People: ${ORIGIN}/admin/people`,
        "",
        "You're getting this because you were the account owner of a clinic on Pulse 3D.",
      ].join("\n"),
    );
    const member = formerOwnerEmail({ clinicName: CLINIC_NAME, newOwnerName: "Nia Vitest", stillAdmin: false, origin: ORIGIN, canReply: false });
    expect(member.text).toContain("You are still in the clinic.\n");
    expect(member.text).toContain(`Open the library: ${ORIGIN}/library`);
  });

  it("keys a send by the email, the clinic, the person and the change, and keeps the ids out of the key", () => {
    const key = ownerEmailKey("new-owner", "clinic_1", "user_1", "note_1");
    expect(key).toBe(ownerEmailKey("new-owner", "clinic_1", "user_1", "note_1"));
    expect(key).toMatch(/^owner-change-[0-9a-f]{64}$/);
    expect(key).not.toContain("clinic_1");
    expect(new Set([key, ownerEmailKey("former-owner", "clinic_1", "user_1", "note_1"), ownerEmailKey("new-owner", "clinic_1", "user_1", "note_2"), ownerEmailKey("new-owner", "clinic_1", "user_2", "note_1")]).size).toBe(4);
  });
});

describe("sending", () => {
  it("sends one email to the new owner's address from Clerk, with the change's key, and logs nothing", async () => {
    const clinicId = await clinic();
    const service = resend();
    const done = change(clinicId);
    const result = await sendOwnerEmails(done, options({ fetch: service.fetch }));

    expect(result).toEqual({ newOwner: { sent: true }, formerOwner: null });
    expect(service.sent).toHaveLength(1);
    expect(service.sent[0].body).toMatchObject({ to: [NEW_OWNER.email], subject: `You are now the account owner for ${CLINIC_NAME}`, from: ENV.EMAIL_FROM });
    expect(service.sent[0].body).not.toHaveProperty("reply_to");
    expect(service.sent[0].key).toBe(ownerEmailKey("new-owner", clinicId, NEW_OWNER.userId, done.changeId));
    expect(logs).toEqual([]);
  });

  it("the same change sent twice carries the same key both times, so Resend drops the repeat", async () => {
    const clinicId = await clinic();
    const service = resend();
    const done = change(clinicId);
    await sendOwnerEmails(done, options({ fetch: service.fetch }));
    await sendOwnerEmails(done, options({ fetch: service.fetch }));
    expect(service.sent.map((sent) => sent.key)).toEqual([service.sent[0].key, service.sent[0].key]);
  });

  it("replies go to EMAIL_REPLY_TO when it is set, and the email then says a person will answer", async () => {
    const clinicId = await clinic();
    const service = resend();
    await sendOwnerEmails(change(clinicId), options({ fetch: service.fetch, env: { ...ENV, EMAIL_REPLY_TO: "Pulse 3D <hello@example.test>" } }));
    expect(service.sent[0].body).toMatchObject({ reply_to: "Pulse 3D <hello@example.test>" });
    expect(String(service.sent[0].body.text)).toContain("a person will answer");
  });

  it("also tells the former owner when asked, with a key of its own", async () => {
    const clinicId = await clinic();
    const service = resend();
    const done = change(clinicId, { changedBy: { pulse: true }, tellFormerOwner: OLD_OWNER.userId });
    const result = await sendOwnerEmails(done, options({ fetch: service.fetch }));

    expect(result).toEqual({ newOwner: { sent: true }, formerOwner: { sent: true } });
    expect(service.sent.map((sent) => (sent.body.to as string[])[0])).toEqual([NEW_OWNER.email, OLD_OWNER.email]);
    expect(String(service.sent[1].body.text)).toContain("Pulse 3D made Nia Vitest the account owner.");
    expect(service.sent[1].key).toBe(ownerEmailKey("former-owner", clinicId, OLD_OWNER.userId, done.changeId));
  });

  it("sends nothing when the person is no longer the owner by the time it is sent", async () => {
    const clinicId = await clinic(OLD_OWNER.userId);
    const service = resend();
    const result = await sendOwnerEmails(change(clinicId, { tellFormerOwner: OLD_OWNER.userId }), options({ fetch: service.fetch }));
    expect(result).toEqual({ newOwner: { sent: false, reason: "no-longer-owner" }, formerOwner: { sent: false, reason: "no-longer-owner" } });
    expect(service.sent).toHaveLength(0);
  });

  it("sends nothing to someone Clerk no longer has in the clinic, and nothing to a former owner who left", async () => {
    const clinicId = await clinic();
    const service = resend();
    const result = await sendOwnerEmails(change(clinicId, { tellFormerOwner: OLD_OWNER.userId }), options({ fetch: service.fetch, member: people() }));
    expect(result).toEqual({ newOwner: { sent: false, reason: "not-in-clinic" }, formerOwner: { sent: false, reason: "not-in-clinic" } });
    expect(service.sent).toHaveLength(0);
  });

  it("does nothing at all when email is not set up here, or no address for the app is known", async () => {
    const clinicId = await clinic();
    const service = resend();
    expect(await sendOwnerEmails(change(clinicId), options({ fetch: service.fetch, env: { APP_ORIGINS: ORIGIN } }))).toEqual({
      newOwner: { sent: false, reason: "not-configured" },
      formerOwner: null,
    });
    expect(await sendOwnerEmails(change(clinicId), options({ fetch: service.fetch, env: { RESEND_API_KEY: "re_madeup", EMAIL_FROM: "x <a@example.test>", VERCEL: "1" } }))).toEqual({
      newOwner: { sent: false, reason: "no-origin" },
      formerOwner: null,
    });
    expect(service.sent).toHaveLength(0);
    expectCleanLogs();
  });

  it("never throws when Resend refuses, cannot be reached, or Clerk fails, and logs only words and a reason", async () => {
    const clinicId = await clinic();
    expect((await sendOwnerEmails(change(clinicId), options({ fetch: resend("refuse").fetch }))).newOwner).toEqual({ sent: false, reason: "refused" });
    expect((await sendOwnerEmails(change(clinicId), options({ fetch: resend("down").fetch }))).newOwner).toEqual({ sent: false, reason: "unreachable" });
    const clerkDown = async () => {
      throw new Error(`Clerk failed for ${NEW_OWNER.email} at ${CLINIC_NAME}`);
    };
    expect((await sendOwnerEmails(change(clinicId), options({ fetch: resend().fetch, member: clerkDown }))).newOwner).toEqual({ sent: false, reason: "lookup-failed" });
    expect(logs.length).toBeGreaterThan(0);
    expectCleanLogs();
  });
});

describe("sending later", () => {
  it("never throws, even when the sending itself throws or rejects, and logs only the kind", async () => {
    const boom = () => {
      throw new Error(`boom ${NEW_OWNER.email}`);
    };
    const rejects = async () => {
      throw new Error(`rejected ${CLINIC_NAME}`);
    };
    await expect(sendOwnerEmailsLater(change("clinic_x"), boom)).resolves.toBeUndefined();
    await expect(sendOwnerEmailsLater(change("clinic_x"), rejects)).resolves.toBeUndefined();
    expect(logs).toEqual(["Owner email: the email was not sent Error", "Owner email: the email was not sent Error"]);
  });
});
