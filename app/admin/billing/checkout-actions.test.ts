import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPayment, startCheckout } from "@/lib/checkout";
import { prisma } from "@/lib/db/client";
import { checkPaymentAction, startCheckoutAction } from "./actions";

/**
 * The two checkout Server Actions at the permission boundary, with Clerk
 * replaced by a stand-in, the database real, and the checkout flow itself
 * (lib/checkout.ts, which has its own tests) replaced by a recorder so that
 * what the action HANDS it can be read.
 *
 * What these prove:
 *   - signed out and a member are refused before anything is read or made;
 *   - the clinic is always the signed-in admin's own: a clinic id forged into
 *     the form is never read, so one clinic's admin cannot start a checkout
 *     for another;
 *   - an admin of a clinic that is NOT open may start one (paying is how a
 *     closed clinic opens);
 *   - amounts, discounts and founding flags added to the form never reach
 *     the flow;
 *   - Stripe's return address is built from a trusted origin, never from a
 *     forged Host header;
 *   - a failure is answered with a plain sentence and no technical detail.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/checkout", () => ({ startCheckout: vi.fn(), checkPayment: vi.fn() }));

let currentHost = "localhost:3000";
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", currentHost]]) }));

function signInAs(orgId: string | null, role: "admin" | "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: orgId ? "user_vitest" : null,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ firstName: "Jane", lastName: "Smith", emailAddresses: [] }) },
  } as never);
}

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

const GOOD = { categories: ["KNEE", "HIP"], seats: "3", interval: "MONTH", seenVersionId: "cmversion0000000000000001", seenTotalCents: "26700" };

const createdClinicIds: string[] = [];

async function makeClinic(status: "PENDING" | "ACTIVE" | "CANCELED" = "PENDING") {
  const orgId = `org_test_${randomBytes(8).toString("hex")}`;
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest checkout action ${randomBytes(3).toString("hex")}`, clerkOrgId: orgId, status, practiceType: "CLINIC" },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return { clinicId: clinic.id, orgId };
}

beforeEach(() => {
  vi.resetAllMocks();
  currentHost = "localhost:3000";
  vi.mocked(startCheckout).mockResolvedValue({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/cs_test_made_up" });
  vi.mocked(checkPayment).mockResolvedValue({ status: "ACTIVE", message: "Payment confirmed." });
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

describe("startCheckoutAction", () => {
  it("refuses someone signed out, and a member, without starting anything", async () => {
    const { orgId } = await makeClinic();

    signInAs(null, "member");
    expect(await startCheckoutAction(null, form(GOOD))).toMatchObject({ error: expect.stringContaining("office admins") });
    signInAs(orgId, "member");
    expect(await startCheckoutAction(null, form(GOOD))).toMatchObject({ error: expect.stringContaining("office admins") });

    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("lets an admin of a clinic that is NOT open start a checkout, for their own clinic, under their own name", async () => {
    for (const status of ["PENDING", "CANCELED"] as const) {
      const { clinicId, orgId } = await makeClinic(status);
      signInAs(orgId, "admin");

      expect(await startCheckoutAction(null, form(GOOD))).toEqual({ redirectTo: "https://checkout.stripe.com/c/pay/cs_test_made_up" });

      expect(vi.mocked(startCheckout).mock.lastCall?.[0]).toMatchObject({ clinicId, actor: { id: "user_vitest", name: "Jane Smith" } });
    }
  });

  it("never reads a clinic id from the form: an admin of one clinic cannot start a checkout for another", async () => {
    const target = await makeClinic();
    const own = await makeClinic();
    signInAs(own.orgId, "admin");

    await startCheckoutAction(null, form({ ...GOOD, clinicId: target.clinicId, clinic: target.clinicId }));

    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startCheckout).mock.lastCall?.[0].clinicId).toBe(own.clinicId);
  });

  it("hands the flow what was picked and what was on screen, and nothing else: no amount, no discount, no founding flag, no practice type", async () => {
    const { clinicId, orgId } = await makeClinic();
    signInAs(orgId, "admin");

    // A practiceType field in the form is never read: there is no question on the page any more, and only Pulse staff set it.
    await startCheckoutAction(null, form({ ...GOOD, amount: "1", perSeatCents: "1", unit_amount: "1", founding: "on", foundingDiscountBp: "10000", coupon: "FREE", practiceType: "HOSPITAL" }));

    expect(vi.mocked(startCheckout).mock.lastCall?.[0].selection).toEqual({
      categories: ["KNEE", "HIP"],
      seats: 3,
      interval: "MONTH",
      seenVersionId: GOOD.seenVersionId,
      seenTotalCents: 26700,
    });
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { practiceType: true } })).practiceType).toBe("CLINIC");
  });

  it("refuses a malformed form before starting anything", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");

    for (const bad of [{ ...GOOD, categories: ["ELBOW"] }, { ...GOOD, categories: ["KNEE", "KNEE"] }, { ...GOOD, seats: "2.5" }, { ...GOOD, interval: "WEEK" }, { ...GOOD, seenTotalCents: "" }]) {
      expect(await startCheckoutAction(null, form(bad))).toMatchObject({ error: expect.any(String) });
    }
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("builds Stripe's return address from a trusted origin: a forged Host header is refused on a developer's computer", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");

    await startCheckoutAction(null, form(GOOD));
    expect(vi.mocked(startCheckout).mock.lastCall?.[0].origin).toBe("http://localhost:3000");

    currentHost = "evil.example";
    vi.mocked(startCheckout).mockClear();
    expect(await startCheckoutAction(null, form(GOOD))).toMatchObject({ error: expect.stringContaining("cannot be started from this address") });
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("passes on a refusal and a changed total as they are, and sends an already-paid attempt to the return page", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");

    vi.mocked(startCheckout).mockResolvedValueOnce({ kind: "refused", message: "Hospitals and health systems are set up by Pulse 3D." });
    expect(await startCheckoutAction(null, form(GOOD))).toEqual({ error: "Hospitals and health systems are set up by Pulse 3D." });

    vi.mocked(startCheckout).mockResolvedValueOnce({ kind: "changed", message: "The total on this page was out of date." });
    expect(await startCheckoutAction(null, form(GOOD))).toEqual({ changed: "The total on this page was out of date." });

    vi.mocked(startCheckout).mockResolvedValueOnce({ kind: "confirming" });
    expect(await startCheckoutAction(null, form(GOOD))).toEqual({ redirectTo: "/admin/billing/return" });
  });

  it("answers a failure with a plain sentence, and neither shows nor logs the technical message", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(startCheckout).mockRejectedValueOnce(new Error("connect ECONNREFUSED cus_secret_looking_id at api.stripe.com"));

    const result = await startCheckoutAction(null, form(GOOD));

    expect(result).toEqual({ error: "Checkout could not be started just now. Nothing was charged. Try again in a moment." });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("cus_secret_looking_id");
    logged.mockRestore();
  });
});

describe("checkPaymentAction", () => {
  it("refuses someone signed out, and a member", async () => {
    const { orgId } = await makeClinic();
    signInAs(null, "member");
    expect(await checkPaymentAction()).toMatchObject({ error: expect.any(String) });
    signInAs(orgId, "member");
    expect(await checkPaymentAction()).toMatchObject({ error: expect.any(String) });
    expect(checkPayment).not.toHaveBeenCalled();
  });

  it("checks the signed-in admin's own clinic, open or not", async () => {
    const { clinicId, orgId } = await makeClinic("PENDING");
    signInAs(orgId, "admin");

    expect(await checkPaymentAction()).toEqual({ message: "Payment confirmed." });
    expect(vi.mocked(checkPayment).mock.lastCall?.[0].clinicId).toBe(clinicId);
  });

  it("answers a failure to reach Stripe with a plain sentence", async () => {
    const { orgId } = await makeClinic();
    signInAs(orgId, "admin");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(checkPayment).mockRejectedValueOnce(new Error("socket hang up"));

    expect(await checkPaymentAction()).toEqual({ error: "We could not reach Stripe just now. Nothing has changed. Try again in a moment." });
    logged.mockRestore();
  });
});
