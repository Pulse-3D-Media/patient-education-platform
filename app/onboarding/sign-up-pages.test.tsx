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
  /** Where setup stands (Clinic.setupStep and setupDone); left out, the clinic was made before setup. */
  setupStep?: string;
  setupDone?: string[];
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
      setupStep: setup.setupStep ?? null,
      setupDone: setup.setupDone ?? [],
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
  // No publishable key unless a test sets one: the payment step then uses Stripe's hosted page, as before.
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
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
    // A test publishable key set too: the card form, and Stripe's script with it, still never appear.
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_vitestMadeUpNotAKey");
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
    // Plan in the list on the left goes back to the plan step with the plan as picked, like Back (Evan, 2026-11-20).
    expect(html).toContain('aria-label="Plan, done. Change the plan"');
    expect(html).toMatch(/<a aria-label="Plan, done. Change the plan"[^>]*href="\/onboarding\/plan\?categories=KNEE%2CHIP&amp;seats=3&amp;interval=MONTH"/);
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

  it("after the last setup step, shows setup ticked (not a button), names what was skipped, and still offers the tour and the library (Evan, 2026-11-20)", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"], setupStep: "finished", setupDone: ["clinic", "team", "test"] }), "admin");
    const html = await drawLibrary({ welcome: "setup" });
    expect(html).toContain("You\u2019re ready for patients.");
    expect(html).toContain("Setup done");
    expect(html).toContain("Left for later: your logo.");
    expect(html).not.toContain("Finish setting up");
    expect(html).not.toContain('href="/onboarding/setup"');
    expect(html).toContain("Take a quick tour");
    expect(html).toContain("Go to the library");

    // Everything done: nothing left to name.
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"], setupStep: "finished", setupDone: ["clinic", "branding", "team", "test"] }), "admin");
    const all = await drawLibrary({ welcome: "setup" });
    expect(all).toContain("Setup done");
    expect(all).not.toContain("Left for later");
  });

  it("after setup, never shows while setup is still under way, or for a member", async () => {
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"], setupStep: "team", setupDone: ["clinic"] }), "admin");
    expect(await drawLibrary({ welcome: "setup" })).not.toContain("Setup done");
    signInAs(await makeClinic({ status: "ACTIVE", categories: ["KNEE"], setupStep: "finished", setupDone: ["clinic"] }), "member");
    expect(await drawLibrary({ welcome: "setup" })).not.toContain("Setup done");
  });
});

describe("yearly promoted as months free (Evan, 2026-11-19), only when the prices make it true", () => {
  it("the plan step marks Yearly with 2 months free under the default prices (yearly = 10 months)", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPlan(KNEE_HIP_3);
    expect(html).toContain("2 months free");
    // Monthly is chosen, so the summary card does not repeat it: the one mark is beside Yearly.
    expect(html.match(/data-free-months=""/g)).toHaveLength(1);
  });

  it("with yearly chosen, the summary card says it too", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPlan({ ...KNEE_HIP_3, interval: "YEAR" });
    expect(html.match(/data-free-months=""/g)).toHaveLength(2);
  });

  it("a pricing version where a year costs twelve months makes no claim at all", async () => {
    vi.mocked(getActivePricing).mockResolvedValue({
      source: { kind: "version", pinned: false, version: { id: versionId, version: 8, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
      config: { ...DEFAULT_PRICING_CONFIG, yearlyMonths: 12 },
    });
    signInAs(await makeClinic(), "admin");
    const html = await drawPlan({ ...KNEE_HIP_3, interval: "YEAR" });
    expect(html).not.toContain("free");
  });

  it("a version at eleven months says 1 month free, worked out from its own prices", async () => {
    vi.mocked(getActivePricing).mockResolvedValue({
      source: { kind: "version", pinned: false, version: { id: versionId, version: 9, note: "", createdAt: new Date(), createdBy: "", createdByName: "", active: true } },
      config: { ...DEFAULT_PRICING_CONFIG, yearlyMonths: 11 },
    });
    signInAs(await makeClinic(), "admin");
    expect(await drawPlan(KNEE_HIP_3)).toContain("1 month free");
  });

  it("the payment step's summary says it for a yearly plan, and not for a monthly one", async () => {
    signInAs(await makeClinic(), "admin");
    expect(await drawPayment({ ...KNEE_HIP_3, interval: "YEAR" })).toContain("2 months free");
    expect(await drawPayment(KNEE_HIP_3)).not.toContain("months free");
  });
});

describe("Stripe's card form on the payment step (Evan, 2026-11-20), test mode only", () => {
  it("with a TEST publishable key: the card form is on the page, in place of the hosted page's box and our Pay button; the plan and Back stay", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_vitestMadeUpNotAKey");
    signInAs(await makeClinic(), "admin");
    const html = await drawPayment(KNEE_HIP_3);
    expect(html).toContain("Payment method");
    expect(html).toContain("data-card-form");
    expect(html).toContain("Loading the secure card form...");
    expect(html).toContain("Test mode: no card is charged");
    expect(html).toContain("3 seats · monthly");
    expect(html).toContain(">Back<");
    expect(html).not.toContain("secure page");
    expect(html).not.toMatch(/Pay \$[\d,.]+ and start/);
    // The page itself never writes Stripe's script tag or the key into the HTML; the form loads the script once it is on screen.
    expect(html).not.toContain("js.stripe.com");
    expect(html).not.toContain("pk_test_vitestMadeUpNotAKey");
  });

  it("with a LIVE publishable key: never the card form, the hosted page as before", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_vitestMadeUpNotAKey");
    signInAs(await makeClinic(), "admin");
    const html = await drawPayment(KNEE_HIP_3);
    expect(html).not.toContain("data-card-form");
    expect(html).toContain("secure page.");
    expect(html).toMatch(/Pay \$[\d,.]+ and start/);
  });

  it("with no publishable key (the demo site until it is added): the hosted page as before, nothing broken", async () => {
    signInAs(await makeClinic(), "admin");
    const html = await drawPayment(KNEE_HIP_3);
    expect(html).not.toContain("data-card-form");
    expect(html).toMatch(/Pay \$[\d,.]+ and start/);
  });

  it("Stripe's script is named in exactly one browser file, the card form, and only the payment step draws that form", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path.relative(root, full).split(path.sep).join("/"));
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));

    const usesScript = files.filter((file) => readFileSync(path.join(root, file), "utf8").includes("STRIPE_JS_URL"));
    expect(usesScript.sort()).toEqual(["components/sign-up/CardForm.tsx", "lib/stripe-pages.ts"]);
    const drawsForm = files.filter((file) => /from "@\/components\/sign-up\/CardForm"/.test(readFileSync(path.join(root, file), "utf8")));
    expect(drawsForm).toEqual(["app/onboarding/payment/page.tsx"]);
  });
});
