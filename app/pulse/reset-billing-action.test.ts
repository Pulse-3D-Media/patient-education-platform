import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAcceptedPlan, setStripeCustomer } from "@/lib/db/billing";
import { prisma } from "@/lib/db/client";
import { createPricingVersion } from "@/lib/db/pricing";
import { DEFAULT_PRICING_CONFIG } from "@/lib/pricing";
import { checkStripeIds } from "@/lib/stripe";
import { resetBillingAction } from "./actions";

/**
 * "Reset billing" on a clinic's /pulse page (audit finding E3): who may press
 * it, and what it does with what Stripe says. Clerk and the Stripe check are
 * stand-ins; the reset itself runs against the database
 * (lib/db/billing.gone.test.ts covers it in full).
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/stripe")>()), checkStripeIds: vi.fn() }));

const tag = randomBytes(5).toString("hex");
const createdClinicIds: string[] = [];
let pricingVersionId = "";

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest reset action fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});
beforeEach(() => vi.mocked(checkStripeIds).mockReset());
afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

/** Sign someone in. Pulse staff carry the staff flag; a clinic's admin or member is an organization role, which /pulse ignores. */
function signInAs(userId: string | null, publicMetadata: Record<string, unknown> = {}, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: orgRole ? "org_vitest_other" : null, orgRole } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: { getUser: async () => ({ publicMetadata, firstName: "Vitest", lastName: "Staff", emailAddresses: [] }) },
  } as never);
}

async function makeClinic() {
  const clinic = await prisma.clinic.create({ data: { name: `Vitest reset action ${tag}`, practiceType: "CLINIC" }, select: { id: true } });
  createdClinicIds.push(clinic.id);
  await setStripeCustomer(clinic.id, `cus_vitest${tag}${createdClinicIds.length}`);
  await recordAcceptedPlan(clinic.id, {
    pricingVersionId,
    categories: ["KNEE"],
    entitledCategories: ["KNEE"],
    surgeonSeats: 1,
    interval: "MONTH",
    perSeatCents: 5900,
    totalCents: 5900,
    acceptedById: "user_vitest_admin",
    acceptedByName: "Vitest Admin",
  });
  // A checkout attempt from hours ago: its payment page has closed, so it does not refuse the reset.
  await prisma.billingPlan.updateMany({ where: { clinicId: clinic.id }, data: { createdAt: new Date(Date.now() - 3 * 60 * 60_000) } });
  return clinic.id;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}
const customerOf = async (clinicId: string) => (await prisma.clinicBilling.findUniqueOrThrow({ where: { clinicId } })).stripeCustomerId;

describe("resetBillingAction", () => {
  it("is not-found for someone signed out, a clinic's member, its admin and another clinic's admin, with Stripe never asked and nothing written", async () => {
    const clinicId = await makeClinic();
    const before = await customerOf(clinicId);
    const people = [
      () => signInAs(null),
      () => signInAs("user_member", {}, "org:member"),
      () => signInAs("user_admin", {}, "org:admin"),
      () => signInAs("user_other_admin", { kind: "staff" }, "org:admin"),
    ];
    for (const signIn of people) {
      signIn();
      await expect(resetBillingAction(null, form({ clinicId, checkedStripe: "yes" }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(checkStripeIds).not.toHaveBeenCalled();
    expect(await customerOf(clinicId)).toBe(before);
  });

  it("Pulse staff: refused without the tick, refused while Stripe has a live subscription, a failure answered in words, done when it is gone, an unknown clinic refused", async () => {
    signInAs("user_staff", { pulseStaff: true });
    const clinicId = await makeClinic();

    expect(await resetBillingAction(null, form({ clinicId }))).toMatchObject({ error: expect.any(String) });
    expect(checkStripeIds).not.toHaveBeenCalled();

    vi.mocked(checkStripeIds).mockResolvedValueOnce("live");
    expect(await resetBillingAction(null, form({ clinicId, checkedStripe: "yes" }))).toMatchObject({ error: expect.stringContaining("live subscription") });
    expect(await customerOf(clinicId)).not.toBeNull();

    vi.mocked(checkStripeIds).mockResolvedValueOnce("checkout-open");
    expect(await resetBillingAction(null, form({ clinicId, checkedStripe: "yes" }))).toMatchObject({ error: expect.stringContaining("payment page") });
    expect(await customerOf(clinicId)).not.toBeNull();

    vi.mocked(checkStripeIds).mockRejectedValueOnce(new Error("Stripe unreachable cus_secret"));
    const failed = await resetBillingAction(null, form({ clinicId, checkedStripe: "yes" }));
    expect(failed).toMatchObject({ error: expect.any(String) });
    expect(JSON.stringify(failed)).not.toContain("cus_secret");
    expect(await customerOf(clinicId)).not.toBeNull();

    vi.mocked(checkStripeIds).mockResolvedValueOnce("gone");
    expect(await resetBillingAction(null, form({ clinicId, checkedStripe: "yes" }))).toMatchObject({ ok: expect.any(String) });
    expect(await customerOf(clinicId)).toBeNull();
    const note = await prisma.clinicNote.findFirst({ where: { clinicId }, orderBy: { createdAt: "desc" }, select: { authorName: true } });
    expect(note?.authorName).toBe("Vitest Staff");

    expect(await resetBillingAction(null, form({ clinicId: "no_such_clinic", checkedStripe: "yes" }))).toMatchObject({ error: expect.any(String) });
  });
});
