import { auth, clerkClient } from "@clerk/nextjs/server";
import type { BillingStatus, Category, ClinicStatus, PracticeType } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { getCategoryAvailability } from "@/lib/db/category-config";
import { createPricingVersion, getActivePricing } from "@/lib/db/pricing";
import { DEFAULT_PRICING_CONFIG } from "@/lib/pricing";
import { checkoutIsOpen } from "@/lib/stripe";
import BillingPage from "./page";
import ReturnPage from "./return/page";

/**
 * /admin/billing and /admin/billing/return rendered on the server, the way
 * a request renders them, with Clerk replaced by a stand-in and the
 * database real. What each kind of person, and each kind of clinic, is
 * shown. Clicking through to Stripe needs a browser and is checked
 * separately.
 *
 * Whether checkout is switched on, which pricing version is active and
 * which categories are for sale are handed in by stand-ins, so the pages
 * can be drawn in every state without touching the one shared "active
 * version" in the test database.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: Object.assign(vi.fn(), { protect: vi.fn() }), clerkClient: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span data-testid="user-button" />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OrganizationProfile: () => <span />,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/billing",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", async (original) => ({ ...(await original<typeof import("@/lib/stripe")>()), checkoutIsOpen: vi.fn() }));
vi.mock("@/lib/db/pricing", async (original) => ({ ...(await original<typeof import("@/lib/db/pricing")>()), getActivePricing: vi.fn() }));
vi.mock("@/lib/db/category-config", async (original) => ({ ...(await original<typeof import("@/lib/db/category-config")>()), getCategoryAvailability: vi.fn() }));

const tag = randomBytes(4).toString("hex");
const createdClinicIds: string[] = [];
let versionId = "";

function signInAs(orgId: string, role: "admin" | "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: `Vitest checkout page ${tag}`, hasImage: false, imageUrl: "" }, publicMetadata: { kind: "staff" }, role: role === "admin" ? "org:admin" : "org:member" }],
      }),
    },
  } as never);
}

type ClinicSetup = {
  status?: ClinicStatus;
  practiceType?: PracticeType;
  managedByPulse?: boolean;
  staffAccess?: "OPEN" | "PAUSED" | "CANCELED";
  categories?: Category[];
  surgeonSeats?: number;
  /** A billing record, with an accepted plan that is either waiting or in force. */
  billing?: { status: BillingStatus; plan: "pending" | "current" };
};

async function makeClinic(setup: ClinicSetup = {}) {
  const orgId = `org_test_${randomBytes(8).toString("hex")}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest checkout page ${tag}`,
      clerkOrgId: orgId,
      status: setup.status ?? "PENDING",
      practiceType: setup.practiceType ?? "CLINIC",
      managedByPulse: setup.managedByPulse ?? false,
      staffAccess: setup.staffAccess ?? null,
      categories: setup.categories ?? [],
      surgeonSeats: setup.surgeonSeats ?? 0,
    },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);

  if (setup.billing) {
    const plan = await prisma.billingPlan.create({
      data: {
        clinicId: clinic.id,
        pricingVersionId: versionId,
        categories: ["KNEE", "HIP"],
        entitledCategories: ["KNEE", "HIP"],
        surgeonSeats: 3,
        interval: "MONTH",
        perSeatCents: 8900,
        totalCents: 26700,
        acceptedById: "user_vitest",
        acceptedByName: "Jane Smith",
      },
      select: { id: true },
    });
    await prisma.clinicBilling.create({
      data: {
        clinicId: clinic.id,
        stripeCustomerId: `cus_vitestpage${tag}${createdClinicIds.length}`,
        status: setup.billing.status,
        currentPeriodEnd: new Date("2026-11-01T18:00:00.000Z"),
        ...(setup.billing.plan === "pending" ? { pendingPlanId: plan.id } : { currentPlanId: plan.id, stripeSubscriptionId: `sub_vitestpage${tag}${createdClinicIds.length}` }),
      },
    });
  }
  return orgId;
}

const renderBilling = async (searchParams?: Record<string, string>) =>
  renderToStaticMarkup(await BillingPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : undefined));
const renderReturn = async () => renderToStaticMarkup(await ReturnPage());

function showsAnAmount(html: string) {
  return /\$\d/.test(html);
}

beforeAll(async () => {
  versionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest checkout page fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

beforeEach(() => {
  vi.mocked(checkoutIsOpen).mockReturnValue(true);
  vi.mocked(getActivePricing).mockResolvedValue({
    source: { kind: "version", pinned: false, version: { id: versionId, version: 7, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
    config: { ...DEFAULT_PRICING_CONFIG, foundingDiscountBp: 2500 },
  });
  vi.mocked(getCategoryAvailability).mockResolvedValue({ SPINE: "sellable", COMPLEX_SPINE: "coming-soon", KNEE: "sellable", SHOULDER: "sellable", HIP: "sellable", FOOT_ANKLE: "not-for-sale" });
});

afterAll(async () => {
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (versionId) await prisma.pricingVersion.deleteMany({ where: { id: versionId } });
  await prisma.$disconnect();
});

describe("/admin/billing: who is offered the plan picker", () => {
  it("an admin of a PENDING clinic that said it is a clinic gets the picker, marked as test mode, and is told the clinic opens once Stripe confirms", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await renderBilling();

    expect(html).toContain("Choose a plan");
    expect(html).toContain("Continue to payment");
    expect(html).toContain("Test mode.");
    expect(html).toContain("Choose a plan below and they open as soon as Stripe confirms the payment.");
    expect(html).toContain('name="seats"');
    expect(html.match(/name="categories"/g)).toHaveLength(6);
  });

  it("a CANCELED clinic's admin reaches the page and can start again", async () => {
    signInAs(await makeClinic({ status: "CANCELED" }), "admin");
    const html = await renderBilling();
    expect(html).toContain("Ended");
    expect(html).toContain("Choose a plan below to start again.");
    expect(html).toContain("Continue to payment");
  });

  it("a category that cannot be bought is shown, labelled, and cannot be ticked", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await renderBilling();
    expect(html).toContain("Coming soon");
    expect(html).toContain("Not for sale");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="COMPLEX_SPINE"|<input[^>]*value="COMPLEX_SPINE"[^>]*disabled=""/);
    expect(html).not.toMatch(/<input[^>]*disabled=""[^>]*value="KNEE"|<input[^>]*value="KNEE"[^>]*disabled=""/);
  });

  it("the founding number on the active version never reaches the browser: no founding terms are approved", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await renderBilling();
    expect(html).not.toContain("2500");
    expect(html.toLowerCase()).not.toContain("founding");
  });

  it("opens with the plan on file, less anything that cannot be bought, and never more seats than a card plan covers", async () => {
    signInAs(await makeClinic({ categories: ["KNEE", "FOOT_ANKLE"], surgeonSeats: 40 }), "admin");
    const html = await renderBilling();
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="KNEE"|<input[^>]*value="KNEE"[^>]*checked=""/);
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="FOOT_ANKLE"|<input[^>]*value="FOOT_ANKLE"[^>]*checked=""/);
    expect(html).toMatch(/name="seats"[^>]*value="10"|value="10"[^>]*name="seats"/);
  });

  it("a clinic Pulse staff never marked (UNKNOWN) gets the picker like a clinic, and there is no practice question anywhere on the page", async () => {
    signInAs(await makeClinic({ practiceType: "UNKNOWN" }), "admin");
    const html = await renderBilling();
    expect(html).toContain("Choose a plan");
    expect(html).toContain("Continue to payment");
    expect(html).not.toContain("Which describes your practice?");
    expect(html).not.toContain("Your practice");
    expect(html).not.toContain("Answer the question");
    expect(html).not.toContain('name="practiceType"');
  });

  it("a hospital is pointed at Pulse 3D, with no picker, no amount and no way to say it is a clinic", async () => {
    signInAs(await makeClinic({ practiceType: "HOSPITAL" }), "admin");
    const html = await renderBilling();
    expect(html).toContain("Set up by Pulse 3D");
    expect(html).toContain("Schedule a call with Pulse 3D");
    expect(html).toContain("https://www.pulse3dmedia.com/schedulecall");
    expect(html).not.toContain("Continue to payment");
    expect(html).not.toContain('name="practiceType"');
    expect(showsAnAmount(html)).toBe(false);
  });

  it("a clinic managed by Pulse sees its managed message and nothing to pay with", async () => {
    signInAs(await makeClinic({ managedByPulse: true, status: "ACTIVE", staffAccess: "OPEN", categories: ["KNEE"], surgeonSeats: 2 }), "admin");
    const html = await renderBilling();
    expect(html).toContain("managed by Pulse 3D");
    expect(html).not.toContain("Continue to payment");
    expect(html).not.toContain("<form");
  });

  it("a clinic Pulse staff paused by hand is told to talk to Pulse first", async () => {
    signInAs(await makeClinic({ status: "PAUSED", staffAccess: "PAUSED" }), "admin");
    const html = await renderBilling();
    expect(html).toContain("Talk to Pulse 3D first");
    expect(html).not.toContain("Continue to payment");
  });

  it("with checkout not switched on for the deployment, or no published prices, there is no picker and the page says so", async () => {
    const orgId = await makeClinic();
    signInAs(orgId, "admin");

    vi.mocked(checkoutIsOpen).mockReturnValue(false);
    const shut = await renderBilling();
    expect(shut).toContain("not open yet");
    expect(shut).toContain("Get in touch with Pulse 3D and we will turn yours on.");
    expect(shut).not.toContain("Continue to payment");

    vi.mocked(checkoutIsOpen).mockReturnValue(true);
    vi.mocked(getActivePricing).mockResolvedValue({ source: { kind: "estimate" }, config: DEFAULT_PRICING_CONFIG });
    const noPrices = await renderBilling();
    expect(noPrices).toContain("not open yet");
    expect(noPrices).not.toContain("Continue to payment");
  });

  it("a member sees who handles billing, and none of it: no picker, no plan, no amount", async () => {
    signInAs(await makeClinic({ categories: ["KNEE"], surgeonSeats: 2 }), "member");
    const html = await renderBilling();
    expect(html).toContain("This page is for your clinic");
    expect(html).toContain("handled by its office admins");
    expect(html).not.toContain("browse the library");
    expect(html).not.toContain("Continue to payment");
    expect(html).not.toContain("Your plan");
    expect(showsAnAmount(html)).toBe(false);
  });
});

describe("/admin/billing: a clinic that already has a subscription", () => {
  it("shows the plan it accepted with the real amounts, no estimate, and no second checkout", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE", "HIP"], surgeonSeats: 3, billing: { status: "ACTIVE", plan: "current" } }), "admin");
    const html = await renderBilling();

    expect(html).toContain("Your subscription");
    expect(html).toContain("$267.00");
    expect(html).toContain("$89.00 per surgeon seat per month, times 3 seats");
    expect(html).toContain("Knee, Hip");
    expect(html).toContain("Accepted by Jane Smith");
    expect(html).toContain("Renews on November 1, 2026");
    expect(html).not.toContain("Estimate");
    expect(html).not.toContain("Continue to payment");
    expect(html).toContain("Changing your plan");
  });

  it("past due: the same plan, and that the payment did not go through", async () => {
    signInAs(await makeClinic({ status: "PAST_DUE", categories: ["KNEE", "HIP"], surgeonSeats: 3, billing: { status: "PAST_DUE", plan: "current" } }), "admin");
    const html = await renderBilling();
    expect(html).toContain("Your subscription");
    expect(html).toContain("did not go through");
    expect(html).not.toContain("Continue to payment");
  });
});

describe("/admin/billing: coming back from Stripe without paying", () => {
  it("says nothing was charged and opens the picker with what was picked", async () => {
    signInAs(await makeClinic({ billing: { status: "NONE", plan: "pending" } }), "admin");
    const html = await renderBilling({ checkout: "cancelled" });

    expect(html).toContain("nothing was charged");
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="HIP"|<input[^>]*value="HIP"[^>]*checked=""/);
    expect(html).toMatch(/name="seats"[^>]*value="3"|value="3"[^>]*name="seats"/);
    // The address alone changes no state: the clinic is as closed as it was.
    expect(html).toContain("Pending");
  });

  it("without that, a checkout that was started and not confirmed offers a way to check on it", async () => {
    signInAs(await makeClinic({ billing: { status: "NONE", plan: "pending" } }), "admin");
    const html = await renderBilling();
    expect(html).toContain('href="/admin/billing/return"');
    expect(html).toContain("Check on your payment");
  });
});

describe("/admin/billing/return", () => {
  it("cannot grant anything: for a clinic with a checkout waiting it only says it is confirming, and the clinic stays closed", async () => {
    const orgId = await makeClinic({ billing: { status: "NONE", plan: "pending" } });
    signInAs(orgId, "admin");

    const html = await renderReturn();

    expect(html).toContain("Confirming your payment");
    expect(html).toContain("Waiting for Stripe to confirm the payment.");
    expect(html).not.toContain("Payment confirmed");
    const clinic = await prisma.clinic.findFirstOrThrow({ where: { clerkOrgId: orgId }, select: { status: true, categories: true } });
    expect(clinic).toEqual({ status: "PENDING", categories: [] });
  });

  it("says confirmed only when the billing record says paid, with the way into the library", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE", "HIP"], surgeonSeats: 3, billing: { status: "ACTIVE", plan: "current" } }), "admin");
    const html = await renderReturn();
    expect(html).toContain("Payment confirmed");
    expect(html).toContain('href="/library"');
    expect(html).not.toContain("Confirming your payment");
  });

  it("with no checkout at all, says there is nothing to confirm and that nothing was charged", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await renderReturn();
    expect(html).toContain("Nothing to confirm");
    expect(html).toContain("Nothing has been charged");
  });

  it("a failed payment is sent back to Billing", async () => {
    signInAs(await makeClinic({ status: "PAST_DUE", billing: { status: "PAST_DUE", plan: "current" } }), "admin");
    expect(await renderReturn()).toContain("did not go through");
  });

  it("is an admin page: a member sees none of it", async () => {
    signInAs(await makeClinic({ billing: { status: "NONE", plan: "pending" } }), "member");
    const html = await renderReturn();
    expect(html).toContain("This page is for your clinic");
    expect(html).not.toContain("Confirming your payment");
  });
});
