import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPayment } from "@/lib/checkout";
import { prisma } from "@/lib/db/client";
import { cancelWaitingChange, confirmPlanChange, findInvoiceToPay, openBillingPortal, reviewPlanChange } from "@/lib/plan-changes";
import {
  cancelWaitingChangeAction,
  checkWithStripeAction,
  confirmPlanChangeAction,
  openBillingPortalAction,
  payInvoiceAction,
  reviewPlanChangeAction,
} from "./actions";

/**
 * The Server Actions for a clinic that is already paying (changing the
 * plan, cancelling a change, Stripe's billing page, paying an invoice), at
 * the permission boundary. Clerk is a stand-in, the database is real, and
 * the flow itself (lib/plan-changes.ts, which has its own tests) is replaced
 * by a recorder so that what each action HANDS it can be read.
 *
 * What these prove:
 *   - billing changes belong to the clinic's OFFICE ADMINS, the account
 *     owner included (decided on 2026-10-05): signed out and a member are
 *     refused before anything is read or asked of Stripe, and an admin who
 *     is not the owner is let through like the owner;
 *   - the clinic is always the signed-in admin's own. A clinic id, a Stripe
 *     customer id, an amount or a price put into the form never reaches the
 *     flow, so one clinic's admin cannot act on another clinic;
 *   - an admin of a clinic that is NOT open (past due, ended) can still open
 *     Stripe's billing page and pay: that is how it recovers;
 *   - Stripe's return address comes from a trusted origin, never a forged
 *     Host header;
 *   - a failure is answered in plain words with no technical detail, and
 *     the log line holds only the kind of failure.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/checkout", () => ({ startCheckout: vi.fn(), checkPayment: vi.fn() }));
vi.mock("@/lib/plan-changes", () => ({
  reviewPlanChange: vi.fn(),
  confirmPlanChange: vi.fn(),
  cancelWaitingChange: vi.fn(),
  openBillingPortal: vi.fn(),
  findInvoiceToPay: vi.fn(),
}));

let currentHost = "localhost:3000";
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", currentHost]]) }));

const OWNER = "user_vitestowner";
const OTHER_ADMIN = "user_vitestadmin";

function signInAs(orgId: string | null, role: "admin" | "member", userId: string = OWNER) {
  vi.mocked(auth).mockResolvedValue({
    userId: orgId ? userId : null,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ firstName: "Jane", lastName: "Smith", emailAddresses: [] }) },
  } as never);
}

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
}

const PICKS = { categories: ["KNEE", "HIP"], seats: "3", interval: "MONTH", seenVersionId: "cmversion0000000000000001", seenTotalCents: "26700", moveToCurrentPricing: "no" };
const CONFIRM_NOW = { ...PICKS, seenTiming: "now", seenAt: "1791720000", seenDueNowCents: "7866" };

const createdClinicIds: string[] = [];

/** A clinic whose account owner is OWNER. `ownerless` leaves it with no owner at all. */
async function makeClinic(status: "ACTIVE" | "PAST_DUE" | "CANCELED" = "ACTIVE", ownerless = false) {
  const orgId = `org_test_${randomBytes(8).toString("hex")}`;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest manage action ${randomBytes(3).toString("hex")}`, clerkOrgId: orgId, status, practiceType: "CLINIC", ownerClerkUserId: ownerless ? null : OWNER },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return { clinicId: clinic.id, orgId };
}

const everyOwnerAction = () => [
  () => reviewPlanChangeAction(form(PICKS)),
  () => confirmPlanChangeAction(form(CONFIRM_NOW)),
  () => cancelWaitingChangeAction("scheduled"),
  () => cancelWaitingChangeAction("payment"),
  () => openBillingPortalAction(),
  () => payInvoiceAction(),
];

function nothingWasAsked() {
  for (const flow of [reviewPlanChange, confirmPlanChange, cancelWaitingChange, openBillingPortal, findInvoiceToPay]) expect(flow).not.toHaveBeenCalled();
}

const SUMMARY = { included: ["KNEE", "HIP"], seats: 3, interval: "MONTH", perSeatCents: 8900, totalCents: 26700, fullLibrary: false, versionId: "cmversion0000000000000001", version: 4 } as const;

beforeEach(() => {
  vi.resetAllMocks();
  currentHost = "localhost:3000";
  vi.mocked(reviewPlanChange).mockResolvedValue({ kind: "review", summary: { ...SUMMARY, included: [...SUMMARY.included] }, now: { dueNowCents: 7866, at: new Date(1_791_720_000_000), renewsAt: new Date("2026-10-31T12:00:00.000Z") }, renewal: null });
  vi.mocked(confirmPlanChange).mockResolvedValue({ kind: "changed", message: "Your plan has changed. It now comes to $267.00 per month." });
  vi.mocked(cancelWaitingChange).mockResolvedValue({ ok: true, message: "The scheduled change was cancelled. Your plan stays as it is." });
  vi.mocked(openBillingPortal).mockResolvedValue({ ok: true, url: "https://billing.stripe.com/p/session/made_up" });
  vi.mocked(findInvoiceToPay).mockResolvedValue({ ok: true, url: "https://invoice.stripe.com/i/made_up" });
  vi.mocked(checkPayment).mockResolvedValue({ status: "ACTIVE", message: "Payment confirmed." });
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("billing changes belong to the clinic's office admins", () => {
  it("refuses someone signed out and a member, before anything is asked", async () => {
    const { orgId } = await makeClinic();

    for (const signIn of [() => signInAs(null, "member"), () => signInAs(orgId, "member", OTHER_ADMIN), () => signInAs(orgId, "member", OWNER)]) {
      signIn();
      for (const run of everyOwnerAction()) {
        const result = await run();
        expect(result).toMatchObject({ error: expect.stringContaining("office admins") });
        expect(result).not.toHaveProperty("redirectTo");
        expect(result).not.toHaveProperty("review");
      }
    }
    nothingWasAsked();
  });

  it("an office admin who is not the account owner can do everything the owner can, for their own clinic", async () => {
    const { clinicId, orgId } = await makeClinic();
    signInAs(orgId, "admin", OTHER_ADMIN);

    for (const run of everyOwnerAction()) expect(await run()).not.toHaveProperty("error");

    for (const flow of [reviewPlanChange, confirmPlanChange, cancelWaitingChange, openBillingPortal, findInvoiceToPay]) {
      expect(flow).toHaveBeenCalled();
      expect(vi.mocked(flow).mock.calls[0][0]).toMatchObject({ clinicId });
    }
    // The log names the admin who confirmed, by their own id.
    expect(vi.mocked(confirmPlanChange).mock.calls[0][0].actor).toEqual({ id: OTHER_ADMIN, name: "Jane Smith" });
  });

  it("a clinic with no account owner can still have its billing changed by an office admin", async () => {
    const { clinicId, orgId } = await makeClinic("ACTIVE", true);
    signInAs(orgId, "admin", OTHER_ADMIN);
    expect(await openBillingPortalAction()).toEqual({ redirectTo: "https://billing.stripe.com/p/session/made_up" });
    expect(vi.mocked(openBillingPortal).mock.calls[0][0]).toMatchObject({ clinicId });
  });

  it("the account owner who has had admin switched off in Clerk is refused: the admin role is what counts", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "member", OWNER);
    expect(await openBillingPortalAction()).toMatchObject({ error: expect.stringContaining("office admins") });
    nothingWasAsked();
  });

  it("any office admin may ask Stripe where things stand; a member may not", async () => {
    const { clinicId, orgId } = await makeClinic();

    signInAs(orgId, "admin", OTHER_ADMIN);
    expect(await checkWithStripeAction()).toEqual({ message: expect.stringContaining("Checked with Stripe") });
    expect(vi.mocked(checkPayment).mock.calls[0][0]).toMatchObject({ clinicId });

    signInAs(orgId, "member", OTHER_ADMIN);
    expect(await checkWithStripeAction()).toMatchObject({ error: expect.stringContaining("office admins") });
    expect(checkPayment).toHaveBeenCalledTimes(1);
  });
});

describe("the actions act on the signed-in admin's own clinic, with only what the form may say", () => {
  it("review: the flow gets the picks and nothing else; what comes back is plain values for the browser", async () => {
    const mine = await makeClinic();
    const theirs = await makeClinic();
    signInAs(mine.orgId, "admin");

    const state = await reviewPlanChangeAction(form({ ...PICKS, clinicId: theirs.clinicId, customerId: "cus_someone_else", perSeatCents: "1", totalCents: "1", founding: "true", practiceType: "CLINIC" }));

    expect(reviewPlanChange).toHaveBeenCalledTimes(1);
    const args = vi.mocked(reviewPlanChange).mock.calls[0][0];
    expect(args.clinicId).toBe(mine.clinicId);
    expect(args.request).toEqual({ selection: { categories: ["KNEE", "HIP"], seats: 3, interval: "MONTH", seenVersionId: PICKS.seenVersionId, seenTotalCents: 26700 }, moveToCurrentPricing: false });
    expect(JSON.stringify(args.request)).not.toContain(theirs.clinicId);
    expect(JSON.stringify(args.request)).not.toContain("cus_someone_else");
    expect(state).toEqual({ review: { summary: { ...SUMMARY, included: ["KNEE", "HIP"] }, now: { dueNowCents: 7866, atSeconds: 1_791_720_000, renewsAt: new Date("2026-10-31T12:00:00.000Z") }, renewal: null } });
  });

  it("confirm: the flow gets the admin's own clinic, the picks, what was reviewed, and who is confirming", async () => {
    const mine = await makeClinic();
    const theirs = await makeClinic();
    signInAs(mine.orgId, "admin");

    const state = await confirmPlanChangeAction(form({ ...CONFIRM_NOW, clinicId: theirs.clinicId, dueNowCents: "0", priceId: "price_cheap" }));

    const args = vi.mocked(confirmPlanChange).mock.calls[0][0];
    expect(args.clinicId).toBe(mine.clinicId);
    expect(args.seen).toEqual({ timing: "now", at: new Date(1_791_720_000_000), dueNowCents: 7866 });
    expect(args.actor).toEqual({ id: OWNER, name: "Jane Smith" });
    expect(state).toEqual({ done: "Your plan has changed. It now comes to $267.00 per month." });
  });

  it("confirm: an unpaid upgrade, an out-of-date review and a refusal each come back as what they are", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");

    vi.mocked(confirmPlanChange).mockResolvedValueOnce({ kind: "payment-needed", message: "The payment did not go through.", payUrl: "https://invoice.stripe.com/i/made_up" });
    expect(await confirmPlanChangeAction(form(CONFIRM_NOW))).toEqual({ unpaid: "The payment did not go through.", payUrl: "https://invoice.stripe.com/i/made_up" });

    vi.mocked(confirmPlanChange).mockResolvedValueOnce({ kind: "stale", message: "Review it again." });
    expect(await confirmPlanChangeAction(form(CONFIRM_NOW))).toEqual({ stale: "Review it again." });

    vi.mocked(confirmPlanChange).mockResolvedValueOnce({ kind: "refused", message: "3 seats are taken." });
    expect(await confirmPlanChangeAction(form(CONFIRM_NOW))).toEqual({ error: "3 seats are taken." });

    // A confirm form with nothing from the review step never reaches the flow.
    vi.mocked(confirmPlanChange).mockClear();
    expect(await confirmPlanChangeAction(form(PICKS))).toMatchObject({ stale: expect.stringContaining("Review the change again") });
    expect(confirmPlanChange).not.toHaveBeenCalled();
  });

  it("bad picks are refused before the flow is asked", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    expect(await reviewPlanChangeAction(form({ ...PICKS, seats: "0" }))).toMatchObject({ error: expect.any(String) });
    expect(await reviewPlanChangeAction(form({ ...PICKS, categories: ["KNEE", "KNEE"] }))).toMatchObject({ error: expect.any(String) });
    expect(reviewPlanChange).not.toHaveBeenCalled();
  });

  it("cancel: only the two kinds of waiting change exist; anything else is refused", async () => {
    const { clinicId, orgId } = await makeClinic();
    signInAs(orgId, "admin");

    expect(await cancelWaitingChangeAction("scheduled")).toEqual({ message: "The scheduled change was cancelled. Your plan stays as it is." });
    expect(vi.mocked(cancelWaitingChange).mock.calls[0][0]).toMatchObject({ clinicId, which: "scheduled" });
    expect(await cancelWaitingChangeAction("everything" as never)).toMatchObject({ error: expect.any(String) });
    expect(cancelWaitingChange).toHaveBeenCalledTimes(1);
  });
});

describe("Stripe's billing page and paying an invoice", () => {
  it("an admin of a clinic that is NOT open can still get to both: that is how it recovers", async () => {
    for (const status of ["PAST_DUE", "CANCELED"] as const) {
      const { clinicId, orgId } = await makeClinic(status);
      signInAs(orgId, "admin");

      expect(await openBillingPortalAction()).toEqual({ redirectTo: "https://billing.stripe.com/p/session/made_up" });
      expect(vi.mocked(openBillingPortal).mock.calls.at(-1)?.[0]).toMatchObject({ clinicId, origin: "http://localhost:3000" });
      expect(await payInvoiceAction()).toEqual({ redirectTo: "https://invoice.stripe.com/i/made_up" });
      expect(vi.mocked(findInvoiceToPay).mock.calls.at(-1)?.[0]).toMatchObject({ clinicId });
    }
  });

  it("one clinic's admin can only ever open their own clinic's billing page: there is nothing in the request to point it elsewhere", async () => {
    const mine = await makeClinic();
    await makeClinic();
    signInAs(mine.orgId, "admin");

    await openBillingPortalAction();

    const args = vi.mocked(openBillingPortal).mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(["clinicId", "deps", "origin"]);
    expect(args.clinicId).toBe(mine.clinicId);
  });

  it("a forged Host header cannot become Stripe's return address", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    currentHost = "evil.example";

    expect(await openBillingPortalAction()).toMatchObject({ error: expect.stringContaining("cannot be opened from this address") });
    expect(openBillingPortal).not.toHaveBeenCalled();
  });

  it("a refusal from the flow is passed on in its own words, with no address", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    vi.mocked(openBillingPortal).mockResolvedValueOnce({ ok: false, message: "Your plan is managed by Pulse 3D." });
    expect(await openBillingPortalAction()).toEqual({ error: "Your plan is managed by Pulse 3D." });
    vi.mocked(findInvoiceToPay).mockResolvedValueOnce({ ok: false, message: "Nothing is waiting to be paid." });
    expect(await payInvoiceAction()).toEqual({ error: "Nothing is waiting to be paid." });
  });
});

describe("when something fails", () => {
  it("every action answers in plain words, and the log line holds only the kind of failure", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    const secret = "postgresql://user:hunter2@db.example/neondb sub_1ABCsecret cus_9XYZsecret";
    const boom = Object.assign(new Error(secret), { name: "StripeConnectionError" });
    for (const flow of [reviewPlanChange, confirmPlanChange, cancelWaitingChange, openBillingPortal, findInvoiceToPay]) vi.mocked(flow).mockRejectedValue(boom);
    vi.mocked(checkPayment).mockRejectedValue(boom);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const results = [];
      for (const run of [...everyOwnerAction(), () => checkWithStripeAction()]) results.push(await run());

      for (const result of results) {
        expect(result).toMatchObject({ error: expect.any(String) });
        const text = JSON.stringify(result);
        for (const leak of ["hunter2", "postgresql", "sub_1ABC", "cus_9XYZ", "StripeConnectionError", "Error:"]) expect(text).not.toContain(leak);
      }
      // A failed confirm does not claim nothing was charged: Stripe may have been reached.
      expect(JSON.stringify(results[1])).not.toContain("Nothing was charged");
      expect(JSON.stringify(results[1])).toContain("Check with Stripe");

      expect(logged).toHaveBeenCalledTimes(results.length);
      for (const [line] of logged.mock.calls) {
        expect(String(line)).toContain("StripeConnectionError");
        for (const leak of ["hunter2", "postgresql", "sub_1ABC", "cus_9XYZ"]) expect(String(line)).not.toContain(leak);
      }
    } finally {
      logged.mockRestore();
    }
  });
});
