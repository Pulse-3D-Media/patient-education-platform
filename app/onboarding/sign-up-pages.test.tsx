import { auth, clerkClient } from "@clerk/nextjs/server";
import type { BillingStatus, ClinicStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startSignUpCheckoutAction } from "@/app/admin/billing/actions";
import LibraryPage from "@/app/library/page";
import { CHECKOUT_CLOSED_MESSAGE } from "@/lib/checkout";
import { prisma } from "@/lib/db/client";
import { getCategoryAvailability } from "@/lib/db/category-config";
import { createPricingVersion, getActivePricing } from "@/lib/db/pricing";
import { DEFAULT_PRICING_CONFIG, formatCents } from "@/lib/pricing";
import { checkoutIsOpen } from "@/lib/stripe";
import { quotePlan } from "@/components/sign-up/plan-quote";
import DonePage from "./done/page";
import PaymentPage from "./payment/page";
import PlanPage from "./plan/page";

/**
 * The sign-up steps after the email code (/onboarding/plan, /onboarding/payment,
 * /onboarding/done) and the welcome dialog on the library, rendered on the
 * server the way a request renders them, with Clerk replaced by a stand-in
 * and the database real.
 *
 * What these prove:
 *   - the plan and payment steps are drawn only where Billing's own plan
 *     picker would be; everywhere checkout is shut (the production
 *     deployment, no pricing version, a first payment under way, a member)
 *     the person goes where a new clinic went before, Billing;
 *   - with VERCEL_ENV=production, using the REAL checkoutIsOpen(), neither
 *     step is offered and the Pay action refuses before Stripe is touched;
 *   - the payment step's total is worked out on the server, and a payment
 *     that was not finished keeps the plan and offers Try again;
 *   - the return page sends the owner to the welcome dialog only once the
 *     billing record says the clinic is paid and open;
 *   - the welcome dialog shows for the owner only.
 *
 * Stripe's own page, Clerk's real session and a real browser are not here;
 * they are the preview walkthrough in the pull request.
 */

vi.mock("@clerk/nextjs/server", () => ({ auth: Object.assign(vi.fn(), { protect: vi.fn() }), clerkClient: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/onboarding/plan",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["host", "localhost:3000"]]) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe", async (original) => {
  const real = await original<typeof import("@/lib/stripe")>();
  return { ...real, checkoutIsOpen: vi.fn(real.checkoutIsOpen) };
});
vi.mock("@/lib/db/pricing", async (original) => ({ ...(await original<typeof import("@/lib/db/pricing")>()), getActivePricing: vi.fn() }));
vi.mock("@/lib/db/category-config", async (original) => ({ ...(await original<typeof import("@/lib/db/category-config")>()), getCategoryAvailability: vi.fn() }));

const tag = randomBytes(4).toString("hex");
const createdClinicIds: string[] = [];
let versionId = "";
let realCheckoutIsOpen: typeof checkoutIsOpen;

function signInAs(orgId: string | null, role: "admin" | "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: orgId ? "user_vitest" : null,
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(auth.protect).mockResolvedValue({ userId: "user_vitest", orgId } as never);
  const member = {
    organization: { name: `Vitest sign-up ${tag}`, hasImage: false, imageUrl: "" },
    publicMetadata: {},
    role: role === "admin" ? "org:admin" : "org:member",
    createdAt: 0,
    publicUserData: { userId: "user_vitest", firstName: "Jane", lastName: "Smith", identifier: "jane@example.test", imageUrl: "" },
  };
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: { getOrganizationMembershipList: async () => ({ data: [member], totalCount: 1 }) },
  } as never);
}

type Setup = {
  status?: ClinicStatus;
  staffAccess?: "OPEN" | "PAUSED" | "CANCELED";
  owner?: boolean;
  categories?: string[];
  billing?: { status: BillingStatus; plan: "pending" | "current" };
};

async function makeClinic(setup: Setup = {}) {
  const orgId = `org_test_${randomBytes(8).toString("hex")}`;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Vitest sign-up ${tag}`,
      clerkOrgId: orgId,
      status: setup.status ?? "PENDING",
      practiceType: "UNKNOWN",
      staffAccess: setup.staffAccess ?? null,
      categories: setup.categories ?? [],
      ownerClerkUserId: setup.owner === false ? null : "user_vitest",
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
        stripeCustomerId: `cus_vitestsignup${tag}${createdClinicIds.length}`,
        status: setup.billing.status,
        ...(setup.billing.plan === "pending" ? { pendingPlanId: plan.id } : { currentPlanId: plan.id, stripeSubscriptionId: `sub_vitestsignup${tag}${createdClinicIds.length}` }),
      },
    });
  }
  return orgId;
}

type Params = Record<string, string>;
const props = (searchParams?: Params) => ({ searchParams: Promise.resolve(searchParams ?? {}) });

/** The page's HTML, or "redirect:/somewhere" when it sends the person on. */
async function draw(page: (p: ReturnType<typeof props>) => Promise<React.ReactElement>, searchParams?: Params): Promise<string> {
  try {
    return renderToStaticMarkup(await page(props(searchParams)));
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("redirect:")) return message;
    throw error;
  }
}
const drawPlan = (params?: Params) => draw(PlanPage as never, params);
const drawPayment = (params?: Params) => draw(PaymentPage as never, params);
const drawDone = () => draw(DonePage as never);

const KNEE_HIP_3 = { categories: "KNEE,HIP", seats: "3", interval: "MONTH" };

beforeAll(async () => {
  realCheckoutIsOpen = (await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe")).checkoutIsOpen;
  versionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest sign-up fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

beforeEach(() => {
  vi.mocked(checkoutIsOpen).mockReturnValue(true);
  vi.mocked(getActivePricing).mockResolvedValue({
    source: { kind: "version", pinned: false, version: { id: versionId, version: 7, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
    config: DEFAULT_PRICING_CONFIG,
  });
  vi.mocked(getCategoryAvailability).mockResolvedValue({ SPINE: "sellable", COMPLEX_SPINE: "coming-soon", KNEE: "sellable", SHOULDER: "sellable", HIP: "sellable", FOOT_ANKLE: "not-for-sale" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  if (versionId) await prisma.pricingVersion.deleteMany({ where: { id: versionId } });
  await prisma.$disconnect();
});

describe("the plan step, where checkout is open", () => {
  it("draws Choose your plan with the three sign-up steps on the left and no app menu", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPlan();
    expect(html).toContain("Choose your plan");
    expect(html).toContain("Signing up");
    expect(html).toContain("Step 2 of 3");
    for (const word of ["Email", "Plan", "Payment", "Finish later", "Continue to payment", "One for each person who sends videos.", "Monthly", "Yearly"]) expect(html).toContain(word);
    // No admin rail, no library menu.
    for (const word of ["Overview", "Shared links", "Clinic branding", "My Procedure Library"]) expect(html).not.toContain(word);
  });

  it("keeps the picks when the person comes Back from payment", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPlan({ categories: "SHOULDER", seats: "4", interval: "YEAR" });
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="SHOULDER"|<input[^>]*value="SHOULDER"[^>]*checked=""/);
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="KNEE"|<input[^>]*value="KNEE"[^>]*checked=""/);
    expect(html).toContain('value="4"');
  });

  it("a member is sent to the library, and a clinic that is already open goes to the library too", async () => {
    signInAs(await makeClinic(), "member");
    expect(await drawPlan()).toBe("redirect:/library");
    signInAs(await makeClinic({ status: "ACTIVE", billing: { status: "ACTIVE", plan: "current" } }), "admin");
    expect(await drawPlan()).toBe("redirect:/library");
  });

  it("someone signed out is sent to sign in by Clerk's own check", async () => {
    vi.mocked(auth.protect).mockRejectedValue(new Error("redirect:/sign-in"));
    await expect(PlanPage(props())).rejects.toThrow("redirect:/sign-in");
  });
});

describe("where checkout is NOT open, a new owner still gets somewhere: Billing, as before", () => {
  it("checkout switched off on this deployment: both steps send the owner to Billing (whose card says plans are not open yet)", async () => {
    vi.mocked(checkoutIsOpen).mockReturnValue(false);
    signInAs(await makeClinic(), "admin");
    expect(await drawPlan()).toBe("redirect:/admin/billing");
    expect(await drawPayment(KNEE_HIP_3)).toBe("redirect:/admin/billing");
  });

  it("VERCEL_ENV=production, with the REAL gate and every other setting saying test: no plan step, no payment step, and Pay refuses before Stripe", async () => {
    vi.mocked(checkoutIsOpen).mockImplementation(realCheckoutIsOpen);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BILLING_CHECKOUT", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_vitest_made_up_not_a_key");
    expect(realCheckoutIsOpen()).toBe(false);

    const orgId = await makeClinic();
    signInAs(orgId, "admin");
    expect(await drawPlan()).toBe("redirect:/admin/billing");
    expect(await drawPayment(KNEE_HIP_3)).toBe("redirect:/admin/billing");

    const form = new FormData();
    for (const category of ["KNEE", "HIP"]) form.append("categories", category);
    form.append("seats", "3");
    form.append("interval", "MONTH");
    form.append("seenVersionId", versionId);
    form.append("seenTotalCents", "26700");
    expect(await startSignUpCheckoutAction(null, form)).toEqual({ error: CHECKOUT_CLOSED_MESSAGE });
    // Nothing was written: no customer, no attempt.
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { clerkOrgId: orgId }, select: { id: true } });
    expect(await prisma.billingPlan.count({ where: { clinicId: clinic.id } })).toBe(0);
    expect(await prisma.clinicBilling.count({ where: { clinicId: clinic.id } })).toBe(0);
  });

  it("no pricing version saved and active: Billing", async () => {
    vi.mocked(getActivePricing).mockResolvedValue({ source: { kind: "default" }, config: DEFAULT_PRICING_CONFIG } as never);
    signInAs(await makeClinic(), "admin");
    expect(await drawPlan()).toBe("redirect:/admin/billing");
  });

  it("a first payment already under way: Billing, which says so and has Check with Stripe", async () => {
    signInAs(await makeClinic({ billing: { status: "INCOMPLETE", plan: "pending" } }), "admin");
    expect(await drawPlan()).toBe("redirect:/admin/billing");
    expect(await drawPayment(KNEE_HIP_3)).toBe("redirect:/admin/billing");
  });
});

describe("the payment step", () => {
  it("is titled Payment method, shows the plan with a total worked out on the server, the test-mode line, and Pay $X and start", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPayment(KNEE_HIP_3);
    const expected = quotePlan(
      DEFAULT_PRICING_CONFIG,
      [
        { value: "SPINE", label: "Orthopedic Spine", availability: "sellable" },
        { value: "KNEE", label: "Knee", availability: "sellable" },
        { value: "HIP", label: "Hip", availability: "sellable" },
      ],
      { categories: ["KNEE", "HIP"], seats: 3, interval: "MONTH" },
    );
    const total = formatCents(expected?.amounts?.totalCents ?? -1);
    expect(html).toContain("Payment method");
    expect(html).toContain("Step 3 of 3");
    expect(html).toContain("Test mode: no card is charged");
    expect(html).toContain(`Pay ${total} and start`);
    expect(html).toContain("3 seats · monthly");
    expect(html).toContain(`name="seenTotalCents" value="${expected?.amounts?.totalCents}"`);
    expect(html).toContain(`name="seenVersionId" value="${versionId}"`);
    expect(html).not.toContain("The payment was not finished.");
  });

  it("coming back from Stripe without paying keeps the plan on record and offers Try again, with a plain sentence", async () => {
    signInAs(await makeClinic({ billing: { status: "NONE", plan: "pending" } }), "admin");
    const html = await drawPayment({ stopped: "1" });
    expect(html).toContain("The payment was not finished.");
    expect(html).toContain("Nothing was charged.");
    expect(html).toContain("Try again");
    expect(html).toContain("3 seats · monthly");
    expect(html).toMatch(/name="categories" value="KNEE"/);
  });

  it("no plan in the address and none on record: back to the plan step", async () => {
    signInAs(await makeClinic(), "admin");
    expect(await drawPayment()).toBe("redirect:/onboarding/plan");
  });

  it("a forged address is never priced: an unknown category goes back to the plan step, and a category not for sale goes back with the picks", async () => {
    signInAs(await makeClinic(), "admin");
    expect(await drawPayment({ categories: "KNEE,ELBOW_MADE_UP", seats: "3", interval: "MONTH" })).toBe("redirect:/onboarding/plan");
    expect(await drawPayment({ categories: "FOOT_ANKLE", seats: "3", interval: "MONTH" })).toMatch(/^redirect:\/onboarding\/plan\?categories=FOOT_ANKLE/);
  });
});

describe("the return page after Stripe", () => {
  it("paid and open: the owner goes to the library with the welcome dialog", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", billing: { status: "ACTIVE", plan: "current" } }), "admin");
    expect(await drawDone()).toBe("redirect:/library?welcome=1");
  });

  it("paid and open: an admin who is not the owner goes to the library with no dialog", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", owner: false, billing: { status: "ACTIVE", plan: "current" } }), "admin");
    expect(await drawDone()).toBe("redirect:/library");
  });

  it("not confirmed yet: Confirming your payment, inside the sign-up frame, never the welcome", async () => {
    signInAs(await makeClinic({ billing: { status: "NONE", plan: "pending" } }), "admin");
    const html = await drawDone();
    expect(html).toContain("Confirming your payment");
    expect(html).toContain("Signing up");
    expect(html).not.toContain("Thanks for signing up.");
  });

  it("paid, but the clinic is paused by Pulse staff: says so and points at Billing, no welcome", async () => {
    signInAs(await makeClinic({ status: "PAUSED", staffAccess: "PAUSED", billing: { status: "ACTIVE", plan: "current" } }), "admin");
    const html = await drawDone();
    expect(html).toContain("Payment confirmed");
    expect(html).toContain("Go to billing");
  });

  it("nothing to confirm: Billing", async () => {
    signInAs(await makeClinic(), "admin");
    expect(await drawDone()).toBe("redirect:/admin/billing");
  });
});

describe("the welcome dialog on the library", () => {
  const drawLibrary = async (params?: Params) => renderToStaticMarkup(await LibraryPage(props(params)));

  it("shows for the account owner of an open clinic arriving with ?welcome=1, worded as drawn", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"] }), "admin");
    const html = await drawLibrary({ welcome: "1" });
    for (const words of ["Thanks for signing up.", "We want you to have a great experience.", "Finish setting up", "(recommended)", "Clinic name, branding, your team. About 5 minutes.", "Take a quick tour", "Three stops, under a minute.", "Go to the library", "Look around first."]) {
      expect(html).toContain(words);
    }
    // Finish setting up opens setup (pull request #5), which sends the admin to the step their clinic is on.
    expect(html).toContain('href="/onboarding/setup"');
  });

  it("never shows for anyone but the owner, or without the address", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"], owner: false }), "admin");
    expect(await drawLibrary({ welcome: "1" })).not.toContain("Thanks for signing up.");
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"] }), "admin");
    expect(await drawLibrary()).not.toContain("Thanks for signing up.");
  });

  it("never shows over a clinic that is not open", async () => {
    signInAs(await makeClinic({ categories: ["KNEE"] }), "admin");
    expect(await drawLibrary({ welcome: "1" })).not.toContain("Thanks for signing up.");
  });
});
