import { auth, clerkClient } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { createShare } from "@/lib/db/shares";
import BillingPage from "./billing/page";
import BrandingPage from "./branding/page";
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
const orgGrace = fakeOrgId();
const orgGraceOver = fakeOrgId();
const orgHospital = fakeOrgId();
const DAY_MS = 86_400_000;
/** A published Hip video made here, so the procedure picker has one thing whose category is known. */
const hipVideoTitle = `Vitest pages hip video ${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  const clinics: Prisma.ClinicCreateInput[] = [
    { name: "Vitest pages clinic (active)", clerkOrgId: orgActive, status: "ACTIVE", categories: ["KNEE"], surgeonSeats: 2 },
    { name: "Vitest pages clinic (pending)", clerkOrgId: orgPending, status: "PENDING", categories: ["KNEE", "SHOULDER"], surgeonSeats: 1 },
    { name: "Vitest pages clinic (managed)", clerkOrgId: orgManaged, status: "ACTIVE", categories: ["SPINE"], surgeonSeats: 4, managedByPulse: true },
    { name: "Vitest pages clinic (hip)", clerkOrgId: orgHip, status: "ACTIVE", categories: ["HIP"], surgeonSeats: 1 },
    // A payment failed: one clinic still inside its grace period, one whose grace ran out yesterday.
    { name: "Vitest pages clinic (grace)", clerkOrgId: orgGrace, status: "PAST_DUE", graceEndsAt: new Date(Date.now() + 5 * DAY_MS), categories: ["KNEE"], surgeonSeats: 1, practiceType: "CLINIC" },
    { name: "Vitest pages clinic (grace over)", clerkOrgId: orgGraceOver, status: "PAST_DUE", graceEndsAt: new Date(Date.now() - DAY_MS), categories: ["KNEE"], surgeonSeats: 1, practiceType: "CLINIC" },
    { name: "Vitest pages clinic (hospital)", clerkOrgId: orgHospital, status: "ACTIVE", categories: ["KNEE"], surgeonSeats: 2, practiceType: "HOSPITAL" },
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

  // Two links for the Hip clinic: one written the way every link was before the
  // first-play rule (no policy, so the database makes it FIXED), played twice,
  // and one made now, not yet played. The links page has to describe each by
  // the rule it was made under.
  const hipClinic = createdClinicIds[3];
  await prisma.share.create({
    data: { code: `p${randomBytes(3).toString("hex").slice(0, 5)}`, clinicId: hipClinic, videoId: video.id, expiresAt: new Date(Date.now() + 60 * 86_400_000), viewCount: 2 },
  });
  await createShare(hipClinic, video.id);
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
      [BrandingPage, "/admin/branding"],
    ] as const) {
      signInAs(orgActive, "member", "Vitest pages clinic (active)");
      const html = await render(page, path);
      expect(html).toContain("This page is for your clinic");
      expect(html).not.toContain('aria-label="Clinic admin"');
      // Nor the icon that opens the admin menu.
      expect(html).not.toContain('aria-controls="admin-menu"');
      expect(html).not.toContain("Create share link");
      expect(html).not.toContain("Save branding");
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
      [BrandingPage, "/admin/branding"],
    ] as const) {
      signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
      const html = await render(page, path);
      expect(html).toContain("Choose a plan to start");
      expect(html).toContain('href="/admin/billing"');
      expect(html).toContain("Go to billing");
      expect(html).not.toContain("Create share link");
      expect(html).not.toContain("Save branding");
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

  it("describes each link by the rule it was made under, and says how long a new link works, in the words createShare uses", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const html = await render(LinksPage, "/admin/links");
    // The intro and the helper text beside Create: how a new link works.
    expect(html).toContain("after the patient first plays it");
    expect(html).toMatch(/Works for \d+ days after the first play/);
    // The legacy link: its fixed date, why it will not shorten, and its two play starts.
    expect(html).toContain("date set when the link was made, playing does not change it");
    expect(html).toContain("2 play starts");
    // The new link: not played yet, stops on its unclaimed date unless played first.
    expect(html).toContain("if never played");
    expect(html).toContain("Not played yet");
    // Playback is what is counted, so nothing is called a view or an opening.
    expect(html).not.toMatch(/\d+ views?\b/);
    expect(html).not.toContain("Not opened");
  });

  it("says links cannot be made, and turns the Create buttons off, when a link setting is out of range, instead of failing", async () => {
    // A number past the limit can only get there by a hand edit; the page must still draw.
    const hipClinic = createdClinicIds[3];
    await prisma.clinic.update({ where: { id: hipClinic }, data: { viewDaysOverride: 366 } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
      const html = await render(LinksPage, "/admin/links");
      expect(html).toContain("Links cannot be made right now");
      expect(html).toContain("Ask Pulse 3D");
      expect(html).not.toContain("after the patient first plays it");
      expect(html).toMatch(/<button[^>]*disabled[^>]*>Create share link/);
      // The rest of the page is still there: the procedure, and the existing links with their words.
      expect(html).toContain(hipVideoTitle);
      expect(html).toContain("2 play starts");
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
      await prisma.clinic.update({ where: { id: hipClinic }, data: { viewDaysOverride: null } });
    }
  });

  it("gets the same honest words on the overview's newest links", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const html = await render(AdminOverviewPage, "/admin");
    expect(html).toContain("if never played");
    expect(html).toContain("Not played yet");
    expect(html).toContain("2 play starts");
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

  it("gets the Branding page: where the logo is changed, the colour, font and phone form, and no box to type a logo address", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(BrandingPage, "/admin/branding");

    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/branding"/);
    // The logo is explained, not uploaded here: it lives on the Clerk organization.
    expect(html).toContain("No logo yet");
    expect(html).toContain("General, then Update profile");
    expect(html).toContain('href="/admin/people"');
    // The form: one colour, the six fonts, the phone.
    expect(html).toContain('name="brandColor"');
    expect(html.match(/name="brandFont"/g)).toHaveLength(6);
    // Dark or light: two choices, and a clinic that never chose opens on Dark.
    expect(html.match(/name="brandTheme"/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*name="brandTheme"[^>]*checked=""[^>]*value="dark"/);
    expect(html).not.toMatch(/<input[^>]*name="brandTheme"[^>]*checked=""[^>]*value="light"/);
    expect(html).toContain('name="phone"');
    expect(html).toContain("Save branding");
    // Only Pulse staff can type a logo address, and the clinic never sends its own id.
    expect(html).not.toContain('name="logoUrl"');
    expect(html).not.toContain('name="clinicId"');
    // No plan or price words here either.
    for (const word of PLAN_WORDS) expect(html).not.toContain(word);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  it("wears its own branding on every admin page: colour and font on the shell, its name in the banner", async () => {
    await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandColor: "#7a1f2b", brandFont: "montserrat", phone: "8015550123" } });
    try {
      for (const [page, path] of [
        [AdminOverviewPage, "/admin"],
        [LinksPage, "/admin/links"],
        [BrandingPage, "/admin/branding"],
      ] as const) {
        signInAs(orgActive, "admin", "Vitest pages clinic (active)");
        const html = await render(page, path);
        // A dark red is too dark to see on the near-black screens, so the shell gets a lightened shade of it, never the raw value.
        expect(html).toMatch(/--brand-accent:#[0-9a-f]{6}/);
        expect(html).not.toContain("--brand-accent:#2a829b");
        expect(html).toContain("font-montserrat");
        // The clinic's name is always in the banner, on every admin page: it labels the logo's link home, and stands in as words until the logo has loaded.
        expect(html).toContain('aria-label="Vitest pages clinic (active), library home"');
        expect(html).toMatch(/<header\b[\s\S]*?Vitest pages clinic \(active\)[\s\S]*?<\/header>/);
        // The admin menu's icon is offered to an admin; the menu itself stays shut until it is pressed.
        expect(html).toContain('aria-controls="admin-menu"');
        expect(html).not.toContain('id="admin-menu"');
      }
      // The Branding form opens on what is saved.
      signInAs(orgActive, "admin", "Vitest pages clinic (active)");
      const branding = await render(BrandingPage, "/admin/branding");
      expect(branding).toContain('value="#7a1f2b"');
      expect(branding).toContain('value="(801) 555-0123"');
    } finally {
      await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandColor: null, brandFont: null, phone: null } });
    }
  });

  it("a clinic that chose light gets light screens, for its admin and its members alike, and no other clinic does", async () => {
    await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandTheme: "light" } });
    try {
      for (const [page, path] of [
        [AdminOverviewPage, "/admin"],
        [LinksPage, "/admin/links"],
        [BillingPage, "/admin/billing"],
      ] as const) {
        signInAs(orgActive, "admin", "Vitest pages clinic (active)");
        const html = await render(page, path);
        // The mode is on the shell's outermost element, written by the server: nothing is switched after the page loads.
        expect(html).toMatch(/^<div data-theme="light"/);
        expect(html).not.toContain('data-theme="dark"');
        // The Pulse look on a light ground is the deep teal, and the link shade is a dark one, not the pale blue used on black.
        expect(html).toContain("--brand-accent:#1e5668");
        expect(html).toContain("--brand-accent-bright:#1e5668");
        expect(html).not.toContain("--brand-accent-bright:#5fb8d4");
        // The dark-ground shades ride along, for the video player, which is black in both modes.
        expect(html).toContain("--brand-dark-accent-bright:#5fb8d4");
      }

      // A member cannot change it and sees it all the same (here on the page that tells them admin is not for them).
      signInAs(orgActive, "member", "Vitest pages clinic (active)");
      expect(await render(AdminOverviewPage, "/admin")).toMatch(/^<div data-theme="light"/);

      // The Branding form opens on Light, and its "what your team sees" card is light too.
      signInAs(orgActive, "admin", "Vitest pages clinic (active)");
      const branding = await render(BrandingPage, "/admin/branding");
      expect(branding).toMatch(/<input[^>]*name="brandTheme"[^>]*checked=""[^>]*value="light"/);
      expect(branding.match(/data-theme="light"/g)).toHaveLength(2);

      // Another clinic, asked in the same breath, is still dark.
      signInAs(orgManaged, "admin", "Vitest pages clinic (managed)");
      const other = await render(BillingPage, "/admin/billing");
      expect(other).toMatch(/^<div data-theme="dark"/);
      expect(other).not.toContain('data-theme="light"');
    } finally {
      await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandTheme: null } });
    }
  });

  it("falls back to dark for a stored mode it does not understand, and the junk never reaches the page", async () => {
    await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandTheme: 'sepia" onload="x' } });
    try {
      signInAs(orgActive, "admin", "Vitest pages clinic (active)");
      const html = await render(AdminOverviewPage, "/admin");
      expect(html).toMatch(/^<div data-theme="dark"/);
      expect(html).not.toContain("sepia");
    } finally {
      await prisma.clinic.update({ where: { id: createdClinicIds[0] }, data: { brandTheme: null } });
    }
  });

  it("with no branding set, looks exactly as it did: the Pulse colours and Inter, in dark", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(AdminOverviewPage, "/admin");
    expect(html).toMatch(/^<div data-theme="dark"/);
    expect(html).toContain("--brand-accent:#2a829b");
    expect(html).toContain("--brand-accent-bright:#5fb8d4");
    expect(html).not.toMatch(/font-(merriweather|open-sans|source-sans|montserrat|nunito-sans)/);
  });
});

describe("a clinic whose payment failed", () => {
  it("stays open inside its grace period: the overview works, and Billing says the payment failed and until when", async () => {
    signInAs(orgGrace, "admin", "Vitest pages clinic (grace)");
    const overview = await render(AdminOverviewPage, "/admin");
    expect(overview).not.toContain("did not go through");
    expect(overview).not.toContain("Go to billing");

    const billing = await render(BillingPage, "/admin/billing");
    expect(billing).toContain("Payment failed");
    expect(billing).toContain("still open for now");
    expect(billing).toContain("They stay open until");
    expect(billing).toContain("Mountain Time");
  });

  it("is closed everywhere but Billing once the grace period is over", async () => {
    signInAs(orgGraceOver, "admin", "Vitest pages clinic (grace over)");
    const overview = await render(AdminOverviewPage, "/admin");
    expect(overview).toContain("last payment did not go through");
    expect(overview).toContain("Go to billing");

    const billing = await render(BillingPage, "/admin/billing");
    expect(billing).toContain("Past due");
    expect(billing).not.toContain("still open for now");
    expect(billing).toContain("Your plan");
  });
});

describe("the practice question on Billing", () => {
  it("is asked of an admin whose clinic has not answered, with exactly the two answers, and promises no price or checkout", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).toContain("Which describes your practice?");
    expect(html).toContain('value="CLINIC"');
    expect(html).toContain('value="HOSPITAL"');
    expect(html).not.toContain('value="UNKNOWN"');
    // Still no purchasable UI: nothing to pick a plan with, nothing about a card form.
    expect(html).not.toMatch(/checkout|card number|subscribe/i);
  });

  it("is not asked again once answered, and a hospital is told Pulse sets it up, with no amount shown", async () => {
    signInAs(orgGrace, "admin", "Vitest pages clinic (grace)");
    const answered = await render(BillingPage, "/admin/billing");
    expect(answered).not.toContain("Which describes your practice?");
    expect(answered).toContain("You told us this is a clinic or private practice");

    signInAs(orgHospital, "admin", "Vitest pages clinic (hospital)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).not.toContain("Which describes your practice?");
    expect(html).toContain("hospital or health system");
    expect(html).toContain("Priced by agreement");
    expect(showsAnAmount(html)).toBe(false);
  });

  it("is never shown to a member, who does not see Billing at all", async () => {
    signInAs(orgActive, "member", "Vitest pages clinic (active)");
    expect(await render(BillingPage, "/admin/billing")).not.toContain("Which describes your practice?");
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
