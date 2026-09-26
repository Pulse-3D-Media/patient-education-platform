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
import PrintPage from "./print/[code]/page";
import ReactivatePage from "./reactivate/[code]/page";

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
  OrganizationProfile: Object.assign(() => <span />, { Page: () => null }),
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

/** Someone else in the signed-in person's organization: a doctor to send links from, or an owner without a seat. */
type OtherMember = { userId: string; firstName: string; lastName: string };

/**
 * Pretend Clerk says this person (user_vitest, "Vi Test") is in this
 * organization, as an admin or a member, along with `others`. The member
 * list is paged the way Clerk pages it, with a total count.
 */
function signInAs(orgId: string, role: "admin" | "member", orgName: string, others: OtherMember[] = []) {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  const organization = { name: orgName, hasImage: false, imageUrl: "" };
  const membership = (person: OtherMember, memberRole: string) => ({
    organization,
    publicMetadata: {},
    role: memberRole,
    createdAt: 1,
    publicUserData: { userId: person.userId, firstName: person.firstName, lastName: person.lastName, identifier: `${person.userId}@example.test`, imageUrl: "" },
  });
  const everyone = [
    membership({ userId: "user_vitest", firstName: "Vi", lastName: "Test" }, role === "admin" ? "org:admin" : "org:member"),
    ...others.map((person) => membership(person, "org:member")),
  ];
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async (params: { userId?: string[] }) => {
        const data = params.userId ? everyone.filter((entry) => params.userId!.includes(entry.publicUserData.userId)) : everyone;
        return { data, totalCount: data.length };
      },
    },
  } as never);
}

/** Two more people in the Hip clinic: a surgeon holding a seat, and the owner, who holds none. */
const HIP_SURGEON: OtherMember = { userId: "user_vitesthipsurgeon", firstName: "Jane", lastName: "Smith" };
const HIP_OWNER: OtherMember = { userId: "user_vitesthipowner", firstName: "Olive", lastName: "Owner" };

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
  // The Hip clinic's seats: the signed-in admin and one surgeon. Its owner holds none.
  await prisma.clinic.update({
    where: { id: hipClinic },
    data: {
      surgeonSeats: 3,
      ownerClerkUserId: HIP_OWNER.userId,
      seatAllocations: {
        create: [
          { clerkUserId: "user_vitest", syncState: "SYNCED" },
          { clerkUserId: HIP_SURGEON.userId, syncState: "SYNCED", displayName: "Jane Smith, PA-C" },
        ],
      },
    },
  });
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
      expect(html).not.toContain(">Create link<");
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
    expect(html).toContain("1 seat");
    expect(html).toContain("Estimate");
    expect(html).toContain("not an invoice");
    expect(html).toContain("nothing has been charged");
    // The navigation is there, and Billing is marked as the current page.
    expect(html).toContain('aria-label="Clinic admin"');
    // React writes attributes in prop order, and Link puts href last, so the mark comes before the address.
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/billing"/);
  });

  it("gets 'Choose a plan first' on People, with a way to Billing and no way to invite anyone", async () => {
    signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
    const html = await render(PeoplePage, "/admin/people");
    expect(html).toContain("Choose a plan first");
    expect(html).toContain('href="/admin/billing"');
    expect(html).not.toContain("Send invitation");
    expect(html).not.toContain("Invite someone");
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  it("gets the closed-clinic page on the overview, Shared links and Branding, with a way to Billing, no links workspace, and one main landmark", async () => {
    for (const [page, path] of [
      [AdminOverviewPage, "/admin"],
      [LinksPage, "/admin/links"],
      [BrandingPage, "/admin/branding"],
    ] as const) {
      signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
      const html = await render(page, path);
      expect(html).toContain("Choose a plan to start");
      expect(html).toContain('href="/admin/billing"');
      expect(html).toContain("Go to billing");
      expect(html).not.toContain(">Create link<");
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
    expect(html).not.toContain(">Create link<");
    for (const word of PLAN_WORDS) expect(html).not.toContain(word);
    expect(showsAnAmount(html)).toBe(false);
  });

  it("gets the links workspace on /admin/links, with no list of past links and no plan words", async () => {
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(LinksPage, "/admin/links");
    expect(html).toContain("Shared links");
    expect(html).toContain("Procedures");
    expect(html).toContain("Search procedures");
    expect(html).not.toContain("Existing links");
    expect(html).not.toContain("Cancel link");
    // Nobody at this clinic holds a seat, so there is nobody a link can be from, and it says where to fix that.
    expect(html).toContain("Nobody in your clinic holds a seat yet");
    expect(html).toContain('href="/admin/people"');
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
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)", [HIP_SURGEON, HIP_OWNER]);
    const hipHtml = await render(LinksPage, "/admin/links");
    expect(hipHtml).toContain(hipVideoTitle);
    expect(hipHtml).toContain("Placeholder");
    expect(hipHtml).toContain(">Create link<");
  });

  it("draws no doctor picker up front: the choice is made on a row, for each link, with nothing picked in advance", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)", [HIP_SURGEON, HIP_OWNER]);
    const html = await render(LinksPage, "/admin/links");
    // The dropdown only opens when Create link is pressed (checked in the browser); the first draw has none.
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Links are from");
    expect(html).toContain("choose the doctor it is from");
    expect(html).toContain(">Create link<");
    // Nobody's account id is sent into the page's markup.
    expect(html).not.toContain(HIP_OWNER.userId);
  });

  it("says how long a new link works, in the words createShare uses, and lists none of the links already made", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)", [HIP_SURGEON, HIP_OWNER]);
    const html = await render(LinksPage, "/admin/links");
    expect(html).toMatch(/A link works for \d+ days? after the patient first plays it/);
    // The Hip clinic has two links (made above); the page shows neither.
    expect(html).not.toContain("2 play starts");
    expect(html).not.toContain("Not played yet");
    expect(html).not.toContain("/watch/");
  });

  it("says links cannot be made when a link setting is out of range, instead of failing", async () => {
    // A number past the limit can only get there by a hand edit; the page must still draw.
    const hipClinic = createdClinicIds[3];
    await prisma.clinic.update({ where: { id: hipClinic }, data: { viewDaysOverride: 366 } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      signInAs(orgHip, "admin", "Vitest pages clinic (hip)", [HIP_SURGEON, HIP_OWNER]);
      const html = await render(LinksPage, "/admin/links");
      expect(html).toContain("Links cannot be made right now");
      expect(html).toContain("Ask Pulse 3D");
      expect(html).not.toContain("after the patient first plays it");
      // The rest of the page is still there: the procedure and its button, which says why when pressed (and the action refuses too).
      expect(html).toContain(hipVideoTitle);
      expect(html).toContain(">Create link<");
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
    expect(html).toContain("2 seats");
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

describe("the practice type on Billing", () => {
  it("is never asked: a clinic Pulse staff never marked is treated as a clinic, and no question, answer or practice field is on the page", async () => {
    // orgActive was made with the default practice type, UNKNOWN.
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).not.toContain("Which describes your practice?");
    expect(html).not.toContain("Your practice");
    expect(html).not.toContain("You told us");
    expect(html).not.toContain("Answer the question");
    expect(html).not.toContain('name="practiceType"');
    expect(html).not.toContain('value="HOSPITAL"');
    // Nothing about a card form is ever drawn here: the card is entered on Stripe's page.
    expect(html).not.toMatch(/card number/i);
  });

  it("a hospital is told Pulse sets it up, with no picker, no amount shown and no way to change what it is", async () => {
    signInAs(orgHospital, "admin", "Vitest pages clinic (hospital)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).toContain("Set up by Pulse 3D");
    expect(html).toContain("Hospitals and health systems");
    expect(html).toContain("Priced by agreement");
    expect(html).not.toContain("Continue to payment");
    expect(html).not.toContain('name="practiceType"');
    expect(showsAnAmount(html)).toBe(false);
  });

  it("is never shown to a member, who does not see Billing at all", async () => {
    signInAs(orgActive, "member", "Vitest pages clinic (active)");
    const html = await render(BillingPage, "/admin/billing");
    expect(html).not.toContain("Which describes your practice?");
    expect(html).not.toContain("Your plan");
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

describe("who a link is from, on People and on the pamphlet", () => {
  it("People shows the name patients see for each person holding a seat, and none for the owner without one", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)", [HIP_SURGEON, HIP_OWNER]);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {}); // the stand-in has no invitation list; the page says so
    try {
      const html = await render(PeoplePage, "/admin/people");
      expect(html).toContain("Patients see: <span");
      expect(html).toContain("Jane Smith, PA-C");
      expect(html).toContain("Dr. Vi Test");
      expect(html).toContain("Change the name patients see for Jane Smith");
      expect(html).not.toContain("Change the name patients see for Olive Owner");
    } finally {
      quiet.mockRestore();
    }
  });

  it("the pamphlet says who sent it, carries the placeholder mark, and an older link names only the clinic", async () => {
    const hipClinic = createdClinicIds[3];
    const video = createdVideoIds[0];
    const withSender = await createShare(hipClinic, video, { sender: { clerkUserId: HIP_SURGEON.userId, fallbackName: "Dr. Jane Smith" } });
    const older = await createShare(hipClinic, video);

    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const html = await render(() => PrintPage({ params: Promise.resolve({ code: withSender.code }) } as never), `/admin/print/${withSender.code}`);
    // Twice: the sheet carries the pamphlet once per half.
    expect(html.match(/Sent by Jane Smith, PA-C, Vitest pages clinic \(hip\)/g)).toHaveLength(2);
    expect(html.match(/Placeholder: plays a sample animation, not this procedure/g)).toHaveLength(2);

    const olderHtml = await render(() => PrintPage({ params: Promise.resolve({ code: older.code }) } as never), `/admin/print/${older.code}`);
    expect(olderHtml).toContain("From Vitest pages clinic (hip)");
    expect(olderHtml).not.toContain("Sent by");
  });

  it("the pamphlet is not found for a member, or for another clinic's link", async () => {
    const hipClinic = createdClinicIds[3];
    const share = await createShare(hipClinic, createdVideoIds[0]);
    signInAs(orgHip, "member", "Vitest pages clinic (hip)");
    await expect(render(() => PrintPage({ params: Promise.resolve({ code: share.code }) } as never), "/admin/print")).rejects.toThrow("notFound");
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    await expect(render(() => PrintPage({ params: Promise.resolve({ code: share.code }) } as never), "/admin/print")).rejects.toThrow("notFound");
  });
});

describe("a paused link a patient has asked about", () => {
  /** A first-play link of the Hip clinic, played 20 days ago with 10 days, so it paused 10 days ago, asked about an hour ago. */
  async function makeAskedAbout(over: Partial<Prisma.ShareUncheckedCreateInput> = {}) {
    const share = await prisma.share.create({
      data: {
        code: `r${randomBytes(3).toString("hex").slice(0, 5)}`,
        clinicId: createdClinicIds[3],
        videoId: createdVideoIds[0],
        expiryPolicy: "FIRST_PLAY",
        firstPlayedAt: new Date(Date.now() - 20 * DAY_MS),
        daysAfterFirstPlay: 10,
        expiresAt: new Date(Date.now() - 10 * DAY_MS),
        renewalRequestedAt: new Date(Date.now() - 60 * 60 * 1000),
        senderName: "Dr. Jane Smith",
        viewCount: 1,
        ...over,
      },
      select: { code: true },
    });
    return share.code;
  }

  const reactivate = (code: string) => () => ReactivatePage({ params: Promise.resolve({ code }) } as never);

  it("is listed on the overview under 'Links waiting to be reactivated', with a way to the page that turns it back on", async () => {
    const code = await makeAskedAbout();
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const html = await render(AdminOverviewPage, "/admin");

    expect(html).toContain("Links waiting to be reactivated");
    expect(html).toContain(hipVideoTitle);
    expect(html).toContain("From Dr. Jane Smith");
    expect(html).toContain(`href="/admin/reactivate/${code}"`);
    expect(html).toContain("Turn it back on");
    // Another clinic sees none of it.
    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    const other = await render(AdminOverviewPage, "/admin");
    expect(other).toContain("Links waiting to be reactivated");
    expect(other).toContain("None right now.");
    expect(other).not.toContain(`/admin/reactivate/${code}`);
  });

  it("gets its own page for the clinic's admin: the details, where it stands, and one Confirm button that is a form, nothing else", async () => {
    const code = await makeAskedAbout();
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");
    const html = await render(reactivate(code), `/admin/reactivate/${code}`);

    expect(html).toContain("Turn a link back on");
    expect(html).toContain("Nothing changes until you press Confirm.");
    expect(html).toContain(hipVideoTitle);
    expect(html).toContain("Dr. Jane Smith");
    expect(html).toContain("Paused since");
    expect(html).toContain("Confirm: turn this link back on");
    expect(html).toMatch(/<form[^>]*>[\s\S]*name="code"[^>]*value="/);
    // The one thing that submits is Confirm (the shell's own menu buttons are not forms).
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
    expect(html.match(/<form/g)).toHaveLength(1);
    // The navigation marks the overview, where the waiting list lives.
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin"/);
  });

  it("offers no Confirm for a link that is working, finished, or made under the older rule, and says why", async () => {
    signInAs(orgHip, "admin", "Vitest pages clinic (hip)");

    const working = await makeAskedAbout({ expiresAt: new Date(Date.now() + 5 * DAY_MS), renewalRequestedAt: null });
    const workingHtml = await render(reactivate(working), `/admin/reactivate/${working}`);
    expect(workingHtml).toContain("Working until");
    expect(workingHtml).not.toContain("Confirm: turn this link back on");

    const finished = await makeAskedAbout({ renewalsUsed: 10 });
    const finishedHtml = await render(reactivate(finished), `/admin/reactivate/${finished}`);
    expect(finishedHtml).toContain("the maximum");
    expect(finishedHtml).toContain("Make a new link");
    expect(finishedHtml).not.toContain("Confirm: turn this link back on");

    const legacy = await makeAskedAbout({ expiryPolicy: "FIXED", firstPlayedAt: null, daysAfterFirstPlay: null, renewalRequestedAt: null });
    const legacyHtml = await render(reactivate(legacy), `/admin/reactivate/${legacy}`);
    expect(legacyHtml).toContain("older rule");
    expect(legacyHtml).not.toContain("Confirm: turn this link back on");
  });

  it("is admins-only, not found for another clinic's admin, and closed with a reason for a clinic that is not open", async () => {
    const code = await makeAskedAbout();

    signInAs(orgHip, "member", "Vitest pages clinic (hip)");
    const member = await render(reactivate(code), `/admin/reactivate/${code}`);
    expect(member).toContain("This page is for your clinic");
    expect(member).not.toContain("Confirm");

    signInAs(orgActive, "admin", "Vitest pages clinic (active)");
    await expect(render(reactivate(code), `/admin/reactivate/${code}`)).rejects.toThrow("notFound");

    signInAs(orgPending, "admin", "Vitest pages clinic (pending)");
    const pending = await render(reactivate(code), `/admin/reactivate/${code}`);
    expect(pending).toContain("Links cannot be turned back on while your clinic is not open");
    expect(pending).toContain("Choose a plan to start");
    expect(pending).toContain('href="/admin/billing"');
    expect(pending).not.toContain("Confirm");
  });
});
