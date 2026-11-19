import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db/client";
import type { Person } from "./people";
import { runSetupReminders, type ReminderRunOptions } from "./setup-reminder-run";
import { daysAfter } from "./setup-reminders";

/**
 * A whole run of the daily job against the real test database, with a
 * stand-in for Clerk (who the owner is) and for Resend (what was sent).
 * Nothing leaves this computer. Made-up addresses only. "Now" is in 2032, so
 * no other test file's clinics are in any window.
 */

vi.mock("./people", () => ({ getMember: vi.fn(async () => null) }));

const BASE = new Date("2032-05-04T15:10:00.000Z");
const ENV = {
  RESEND_API_KEY: "re_madeup_for_tests",
  EMAIL_FROM: "Pulse 3D <no-reply@example.test>",
  EMAIL_REPLY_TO: "Pulse 3D <hello@example.test>",
  APP_ORIGINS: "https://app.example.test",
};
const OWNER_EMAIL = "owner.vitest@example.test";
const CLINIC_NAME = "Vitest Reminder Orthopaedics";
const clinicIds: string[] = [];
let now = BASE;

/** Each test gets its own day far apart from the others, so their clinics never meet in one list. */
let day = 0;
beforeEach(() => {
  day += 100;
  now = daysAfter(BASE, day);
});

async function clinic(daysAgo: number, data: Partial<Prisma.ClinicUncheckedCreateInput> = {}) {
  const row = await prisma.clinic.create({
    data: {
      name: CLINIC_NAME,
      clerkOrgId: `org_vitestrun${randomBytes(8).toString("hex")}`,
      ownerClerkUserId: "user_vitestrunowner",
      status: "ACTIVE",
      setupStep: "team",
      setupDone: ["clinic", "branding"],
      createdAt: daysAfter(now, -daysAgo),
      ...data,
    },
    select: { id: true },
  });
  clinicIds.push(row.id);
  return row.id;
}

const owner: Person = { userId: "user_vitestrunowner", name: "Jane Vitest", email: OWNER_EMAIL, imageUrl: "", role: "admin", joinedAt: 0, seatHoldId: null };

/** A stand-in for Resend that accepts everything and keeps what it was sent. */
function resend() {
  const sent: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
  const fetchStandIn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), key: headers["Idempotency-Key"] ?? null });
    return new Response("{}", { status: 200 });
  });
  return { sent, fetch: fetchStandIn as unknown as typeof fetch };
}

function options(extra: Partial<ReminderRunOptions> = {}): ReminderRunOptions {
  return { now, env: ENV, member: async () => owner, ...extra };
}

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
  await prisma.$disconnect();
});

describe("a run of the daily setup reminder job", () => {
  it("emails the owner the reminder that is due, once, and a rerun sends nothing", async () => {
    const id = await clinic(1.2);
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toEqual({ configured: true, checked: 1, sent: 1, skipped: 0, failed: 0, more: false });
    expect(service.sent).toHaveLength(1);
    const email = service.sent[0];
    expect(email.url).toBe("https://api.resend.com/emails");
    expect(email.body.to).toEqual([OWNER_EMAIL]);
    expect(email.body.reply_to).toBe(ENV.EMAIL_REPLY_TO);
    expect(email.body.subject).toBe("A few minutes to finish setting up your clinic");
    expect(String(email.body.text)).toContain("https://app.example.test/onboarding/setup");
    expect(String(email.body.text)).toContain("[x] Clinic name\n[x] Branding\n[ ] Your team");
    expect(email.key).toMatch(/^setup-reminder-[0-9a-f]{64}$/);
    // The clinic's name is not in the email at all.
    expect(JSON.stringify(email.body)).not.toContain(CLINIC_NAME);
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id }, select: { setupReminder: true } })).toEqual({ setupReminder: 1 });

    const again = resend();
    expect(await runSetupReminders(options({ fetch: again.fetch }))).toMatchObject({ checked: 0, sent: 0 });
    expect(again.sent).toHaveLength(0);
  });

  it("three runs at a day, a week and two weeks send three emails, and a fourth sends nothing", async () => {
    await clinic(1);
    const signedUp = daysAfter(now, -1);
    const service = resend();
    for (const at of [1, 7, 14, 14.5, 15, 20]) await runSetupReminders(options({ now: daysAfter(signedUp, at), fetch: service.fetch }));
    expect(service.sent).toHaveLength(3);
    expect(new Set(service.sent.map((email) => email.key)).size).toBe(3);
  });

  it("two runs at the same moment send one email", async () => {
    await clinic(2);
    const service = resend();
    const [a, b] = await Promise.all([runSetupReminders(options({ fetch: service.fetch })), runSetupReminders(options({ fetch: service.fetch }))]);
    expect(service.sent).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("a missed day sends the one reminder now due, never two", async () => {
    await clinic(10);
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toMatchObject({ sent: 1 });
    expect(service.sent).toHaveLength(1);
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toMatchObject({ sent: 0 });
  });

  it("finished, pre-setup and closed clinics get nothing", async () => {
    await clinic(2, { setupStep: "finished" });
    await clinic(2, { setupStep: null, setupDone: [] });
    await clinic(2, { status: "PENDING" });
    await clinic(2, { status: "CANCELED" });
    await clinic(2, { status: "PAST_DUE", graceEndsAt: daysAfter(now, 2) });
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toMatchObject({ checked: 0, sent: 0 });
    expect(service.sent).toHaveLength(0);
  });

  it("an owner who left or is no longer an admin is skipped, nothing recorded, and Clerk failing is counted and retried later", async () => {
    const id = await clinic(2);
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch, member: async () => null }))).toMatchObject({ skipped: 1, sent: 0 });
    expect(await runSetupReminders(options({ fetch: service.fetch, member: async () => ({ ...owner, role: "member" }) }))).toMatchObject({ skipped: 1, sent: 0 });
    const clerkDown = async () => {
      throw Object.assign(new Error(`could not reach ${OWNER_EMAIL}`), { name: "SignInUnavailableError" });
    };
    expect(await runSetupReminders(options({ fetch: service.fetch, member: clerkDown }))).toMatchObject({ failed: 1, sent: 0 });
    expect(service.sent).toHaveLength(0);
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id }, select: { setupReminder: true } })).toEqual({ setupReminder: 0 });
    // Clerk is back the next run: the reminder goes.
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toMatchObject({ sent: 1 });
  });

  it("a send that fails after the record is counted as failed and not sent again (missed, never doubled)", async () => {
    await clinic(2);
    const refusing = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await runSetupReminders(options({ fetch: refusing }))).toMatchObject({ failed: 1, sent: 0 });
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch }))).toMatchObject({ checked: 0, sent: 0 });
    expect(service.sent).toHaveLength(0);
  });

  it("with email or the app's address not set up, nothing is read, recorded or sent", async () => {
    const id = await clinic(2);
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch, env: { ...ENV, RESEND_API_KEY: "" } }))).toEqual({
      configured: false, checked: 0, sent: 0, skipped: 0, failed: 0, more: false,
    });
    expect(await runSetupReminders(options({ fetch: service.fetch, env: { ...ENV, APP_ORIGINS: "", VERCEL: "1" } }))).toMatchObject({ configured: false });
    expect(service.sent).toHaveLength(0);
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id }, select: { setupReminder: true } })).toEqual({ setupReminder: 0 });
  });

  it("leaves out the reply line when no reply address is set", async () => {
    await clinic(2);
    const service = resend();
    await runSetupReminders(options({ fetch: service.fetch, env: { ...ENV, EMAIL_REPLY_TO: "" } }));
    expect(service.sent[0].body.reply_to).toBeUndefined();
    expect(String(service.sent[0].body.text)).not.toContain("Reply to this email");
  });

  it("looks at no more than the limit, and says more are waiting", async () => {
    for (let i = 0; i < 3; i++) await clinic(2);
    const service = resend();
    expect(await runSetupReminders(options({ fetch: service.fetch, limit: 2 }))).toMatchObject({ checked: 2, sent: 2, more: true });
    expect(await runSetupReminders(options({ fetch: service.fetch, limit: 2 }))).toMatchObject({ checked: 1, sent: 1, more: false });
  });

  it("stops starting clinics when its time is up", async () => {
    for (let i = 0; i < 2; i++) await clinic(2);
    const service = resend();
    let t = 0;
    const clock = () => (t += 150_000);
    expect(await runSetupReminders(options({ fetch: service.fetch, clock }))).toMatchObject({ checked: 1, more: true });
  });

  it("never logs an address, the clinic's name, its id or an error message", async () => {
    const id = await clinic(2);
    const throwing = vi.fn(async () => {
      throw new Error(`network down for ${OWNER_EMAIL}`);
    }) as unknown as typeof fetch;
    await runSetupReminders(options({ fetch: throwing }));
    await clinic(3);
    await runSetupReminders(options({ fetch: resend().fetch, member: async () => { throw new Error(`Clerk said ${OWNER_EMAIL}`); } }));
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join("\n");
    for (const secret of [OWNER_EMAIL, CLINIC_NAME, id, "network down", "Clerk said", "re_madeup"]) expect(all).not.toContain(secret);
  });
});
