import { auth, clerkClient } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import BillingPage from "./billing/page";
import LinksPage from "./links/page";
import AdminOverviewPage from "./page";
import PeoplePage from "./people/page";

/**
 * The admin routes rendered on the server, the way a request would render
 * them, with Clerk and the request headers replaced by stand-ins and the
 * database real. What these prove, per route:
 *
 *   - a member gets the admins-only page and none of the admin content;
 *   - an admin of a PENDING clinic reaches Billing and sees their plan,
 *     while the overview and Shared links show the closed-clinic page with
 *     a way to Billing, and never the links workspace;
 *   - an admin of an ACTIVE clinic gets the overview, and the links
 *     workspace on /admin/links;
 *   - plan and price words appear only on /admin/billing.
 *
 * Clicking (creating a link, the navigation) needs a signed-in browser and
 * is checked on the preview.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: Object.assign(vi.fn(), { protect: vi.fn() }),
  clerkClient: vi.fn(),
}));

// The client pieces from Clerk, which need a browser and a real session.
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span data-testid="user-button" />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OrganizationProfile: () => <span />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let currentPath = "/admin";

/** Pretend Clerk says this person is in this organization, as an admin or a member, with the surgeon question answered. */
function signInAs(orgId: string, role: "admin" | "member", orgName: string) {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: orgName, hasImage: false, imageUrl: "" }, publicMetadata: { kind: "staff" }, role: role === "admin" ? "org:admin" : "org:member" }],
      }),
    },
  } as never);
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const orgActive = fakeOrgId();
const orgPending = fakeOrgId();
const orgManaged = fakeOrgId();
const orgHip = fakeOrgId();
/** A published Hip video made here, so the procedure picker has one thing whose category is known. */
const hipVideoTitle = `Vitest pages hip video ${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  const clinics: Prisma.ClinicCreateInput[] = [
    { name: "Vitest pages clinic (active)", clerkOrgId: orgActive, status: "ACTIVE", categories: ["KNEE"], surgeonSeats: 2 },
    { name: "Vitest pages clinic (pending)", clerkOrgId: orgPending, status: "PENDING", categories: ["KNEE", "SHOULDER"], surgeonSeats: 1 },
    { name: "Vitest pages clinic (managed)", clerkOrgId: orgManaged, status: "ACTIVE", categories: ["SPINE"], surgeonSeats: 4, managedByPulse: true },
    { name: "Vitest pages clinic (hip)", clerkOrgId: orgHip, status: "ACTIVE", categories: ["HIP"], surgeonSeats: 1 },
  ];
  for (const data of clinics) {
    const clinic = await prisma.clinic.create({ data, select: { id: true } });
    createdClinicIds.push(clinic.id);
  }

  const video = await prisma.video.create({
    data: { title: hipVideoTitle, category: "HIP", videoUrl: "https://example.com/vitest.mp4", isPublished: true, isPlaceholder: true },
    select: { id: true },
  });
  createdVideoIds.push(video.id);
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: createdClinicIds } }, { videoId: { in: createdVideoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** Render one route the way the server does, and return its HTML. */
async function render(page: () => Promise<React.ReactElement>, path: string) {
  currentPath = path;
  return renderToStaticMarkup(await page());
}

/** The words that only belong on /admin/billing (the headings of its plan and estimate cards). */
const PLAN_WORDS = ["Your plan", "Surgeon seats", "Estimate"];

/** True when the page shows a dollar amount. "$" alone is not enough: React's own form script contains "$$". */
function showsAnAmount(html: string) {
  return /\$\d/.test(html);
}

describe("a member", () => {
  it("gets the admins-only page on every admin route, with no admin content and no admin navigation", async () => {
    for (const [page, path] of [
      [AdminOverviewPage, "/admin"],
      [LinksPage, "/admin/links"],
      [BillingPage, "/admin/billing"],
    ] as const) {
      signInAs(orgActive, "member", "Vitest pages clinic (active)");
      const html = await render(page, path);
      expect(html).toContain("This page is for your clinic");
      expect(html).not.toContain('aria-label="Clinic admin"');
      expect(html).not.toContain("Create share link");
      for (const word of PLAN_WORDS) expect(html).not.toContain(word);
      expect(showsAnAmount(html)).toBe(false);
    }
  });
});

describe("an admin of a PENDING clinic", () => {
  it("reaches Billing and sees the plan there, with the status explained", async () => {
    signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).toContain("Vitest pages clinic (pending)");
    expect(html).toContain("Pending");
    expect(html).toContain("Your plan");
    expect(html).toContain("Knee");
    expect(html).toContain("Shoulder");
    expect(html).toContain("1 surgeon");
    expect(html).toContain("Estimate");
    expect(html).toContain("not an invoice");
    expect(html).toContain("nothing has been charged");
    // The navigation is there, and Billing is marked as the current page.
    expect(html).toContain('aria-label="Clinic admin"');
    // React writes attributes in prop order, and Link puts href last, so the mark comes before the address.
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/billing"/);
  });

  it("gets the closed-clinic page on the overview, Shared links and People, with a way to Billing, no links workspace, and one main landmark", async () => {
    for (const [page, path] of [
      [AdminOverviewPage, "/admin"],
      [LinksPage, "/admin/links"],
      [PeoplePage, "/admin/people"],
    ] as const) {
      signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
      const html = await render(page, path);
      expect(html).toContain("Choose a plan to start");
      expect(html).toContain('href="/admin/billing"');
      expect(html).toContain("Go to billing");
      expect(html).not.toContain("Create share link");
      expect(html).not.toContain("Surgeon seats");
      // The frame is the page's main landmark; the closed-clinic message inside it must not add a second one.
      expect(html.match(/<main\b/g)).toHaveLength(1);
    }
  });
});

describe("an admin of an ACTIVE clinic", () => {
  it("gets the overview on /admin: counts, the sections, no links workspace and no plan words", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(AdminOverviewPage, "/admin");
    expect(html).toContain("Overview");
    expect(html).toContain("Needs a look");
    expect(html).toContain("Working right now");
    expect(html).toContain("Play starts, current links");
    expect(html).toContain("not counting links you have cancelled");
    expect(html).not.toContain("all links");
    for (const href of ["/admin/links", "/admin/people", "/admin/billing"]) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin"/);
    expect(html).not.toContain("Create share link");
    for (const word of PLAN_WORDS) expect(html).not.toContain(word);
    expect(showsAnAmount(html)).toBe(false);
  });

  it("gets the links workspace on /admin/links, with no plan words", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(LinksPage, "/admin/links");
    expect(html).toContain("Shared links");
    expect(html).toContain("Procedures");
    expect(html).toContain("Existing links");
    expect(html).toContain("Search procedures");
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/links"/);
    for (const word of PLAN_WORDS) expect(html).not.toContain(word);
    expect(showsAnAmount(html)).toBe(false);
  });

  it("is offered only the procedures in the categories on its plan in the picker", async () => {
    // Knee-only clinic: the Hip video made above is not offered.
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const kneeHtml = await render(LinksPage, "/admin/links");
    expect(kneeHtml).not.toContain(hipVideoTitle);
    expect(kneeHtml).toContain("categories on your clinic");

    // Hip clinic: it is, with its placeholder mark and its Create button.
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const hipHtml = await render(LinksPage, "/admin/links");
    expect(hipHtml).toContain(hipVideoTitle);
    expect(hipHtml).toContain("Placeholder");
    expect(hipHtml).toContain("Create share link");
  });

  it("sees an estimate on Billing that is labelled as one", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).toContain("Active");
    expect(html).toContain("2 surgeons");
    expect(html).toContain("Per month");
    expect(showsAnAmount(html)).toBe(true);
    expect(html).toContain("not an invoice");
    expect(html).not.toContain("managed by Pulse 3D");
  });
});

describe("an admin of a clinic managed by Pulse", () => {
  it("sees the managed message on Billing and no self-serve controls", async () => {
    signInAs(orgManaged, "admin", "Vitest pages clinic (managed)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).toContain("managed by Pulse 3D");
    expect(html).toContain("invoiced by agreement");
    // No form and no submit button anywhere on the page (the only buttons are the shell menu).
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
  });
});
