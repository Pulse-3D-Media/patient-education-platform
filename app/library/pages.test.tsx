import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryState, type CategoryState } from "@/lib/access";
import { CATEGORIES } from "@/lib/categories";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { prisma } from "@/lib/db/client";
import { recordLibraryPlay, setFavorite } from "@/lib/db/personal-videos";
import { countPublishedVideosByKind, searchUsableVideos } from "@/lib/db/videos";
import { FAVORITES_EMPTY } from "@/lib/library-rows";
import CategoryPage from "./[category]/page";
import SearchPage from "./search/page";
import LibraryPage from "./page";

/**
 * The library routes rendered on the server, the way a request would render
 * them, with Clerk replaced by a stand-in and the database real. What these
 * prove: a category not on the clinic's plan is locked on the home page and
 * on its own page, and nothing playable reaches the browser for it; a
 * placeholder is never sent to a clinic shown finished animations only; a
 * clinic that is not open gets the calm page; and every tile agrees with
 * the rule in lib/access.ts for whatever the shared test database holds.
 *
 * The test database is shared, so which categories are "available" or
 * "coming soon" depends on what is in it. Rather than assume, the tests
 * work the expected state out from the real counts with the same rule the
 * page uses, and then check the page drew that state. The one thing they
 * fix themselves is a published Hip video, so Hip is certainly locked for
 * a Knee-only clinic.
 *
 * Tapping (play, send) needs a signed-in browser and is checked on the preview.
 */

vi.mock("@clerk/nextjs/server", () => ({
  auth: Object.assign(vi.fn(), { protect: vi.fn() }),
  clerkClient: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

// The category rows are real, read from the test database, unless a test hands in its own (hipForSale below):
// whether Hip is for sale there is not this file's to assume or to change.
vi.mock("@/lib/db/category-config", async (original) => {
  const actual = await original<typeof import("@/lib/db/category-config")>();
  return { ...actual, getCategoryConfigs: vi.fn(actual.getCategoryConfigs) };
});

/** For the next renders, say whether Hip is for sale, leaving every other category's row as the database has it. */
async function hipForSale(sellable: boolean) {
  const actual = await vi.importActual<typeof import("@/lib/db/category-config")>("@/lib/db/category-config");
  const real = await actual.getCategoryConfigs();
  vi.mocked(getCategoryConfigs).mockResolvedValue({ ...real, HIP: { sellable, comingSoonText: null } });
}

/** The address "Add to your plan" goes to for one category. */
const addLink = (slug: string) => `href="/admin/billing?add=${slug}#change"`;

/**
 * The More categories list on the home page, as one entry per row, keyed by
 * the category's name as it is drawn ("Foot &amp; Ankle", as React writes it).
 * There is exactly one list inside the section, and the rows are its <li>s.
 */
function moreRows(html: string): { list: string; rows: Map<string, string> } {
  const section = html.slice(html.indexOf("<details"));
  const lists = section.match(/<ul[^>]*>[\s\S]*?<\/ul>/g) ?? [];
  expect(lists).toHaveLength(1);
  const list = lists[0] ?? "";
  const rows = new Map<string, string>();
  for (const row of list.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? []) {
    const name = row.match(/<span[^>]*>([^<]+)<\/span>/)?.[1];
    expect(name).toBeTruthy();
    rows.set(name!, row);
  }
  return { list, rows };
}

/** Pretend Clerk says this person is in this organization: a member unless told they are an admin. */
function signInAs(orgId: string, orgName: string, role: "member" | "admin" = "member") {
  vi.mocked(auth).mockResolvedValue({
    userId: "user_vitest",
    orgId,
    has: ({ role: wanted }: { role: string }) => role === "admin" && wanted === "org:admin",
  } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: orgName, hasImage: false, imageUrl: "" }, publicMetadata: {}, role: role === "admin" ? "org:admin" : "org:member" }],
      }),
    },
  } as never);
}

function fakeOrgId() {
  return `org_test_${randomBytes(8).toString("hex")}`;
}

const createdClinicIds: string[] = [];
const createdVideoIds: string[] = [];
const orgKnee = fakeOrgId();
const orgHipFinishedOnly = fakeOrgId();
const orgPending = fakeOrgId();
const orgHipAll = fakeOrgId();
let kneeClinic = "";
let hipAllClinic = "";
let hipFinishedOnlyClinic = "";
const hipTitle = `Vitest library hip video ${randomBytes(4).toString("hex")}`;
const hipSrc = `https://example.com/vitest-${randomBytes(4).toString("hex")}.mp4`;

beforeAll(async () => {
  const clinics = [
    { name: "Vitest library clinic (knee)", clerkOrgId: orgKnee, status: "ACTIVE", categories: ["KNEE"], showPlaceholders: true },
    { name: "Vitest library clinic (hip, finished only)", clerkOrgId: orgHipFinishedOnly, status: "ACTIVE", categories: ["HIP"], showPlaceholders: false },
    { name: "Vitest library clinic (pending)", clerkOrgId: orgPending, status: "PENDING", categories: ["KNEE"], showPlaceholders: true },
    // Hip on the plan and placeholders shown, so the Hip placeholder made below is always there to send.
    { name: "Vitest library clinic (hip)", clerkOrgId: orgHipAll, status: "ACTIVE", categories: ["HIP"], showPlaceholders: true },
  ] as const;
  const ids: string[] = [];
  for (const data of clinics) {
    const clinic = await prisma.clinic.create({ data: { ...data, categories: [...data.categories] }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    ids.push(clinic.id);
  }
  [kneeClinic, hipFinishedOnlyClinic, , hipAllClinic] = ids;

  // A published Hip placeholder, so Hip has something in it whatever else the database holds.
  const video = await prisma.video.create({
    data: { title: hipTitle, category: "HIP", videoUrl: hipSrc, isPublished: true, isPlaceholder: true },
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

/** Render the category page for one slug the way the server does. */
async function renderCategory(slug: string) {
  return renderToStaticMarkup(await CategoryPage({ params: Promise.resolve({ category: slug }) } as never));
}

/** The state every category is in for one clinic, from the real counts and the rule the page uses. */
async function expectedStates(clinicId: string) {
  const [access, counts] = await Promise.all([getClinicAccess(clinicId), countPublishedVideosByKind()]);
  if (!access) throw new Error("clinic missing");
  const states = {} as Record<string, CategoryState>;
  for (const category of CATEGORIES) states[category.value] = categoryState(access, category.value, counts[category.value]);
  return states;
}

describe("the library home", () => {
  it("draws every tile in the state the rule gives it, and locks Hip for a Knee-only clinic", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = renderToStaticMarkup(await LibraryPage());
    const states = await expectedStates(kneeClinic);

    // Hip has a published video (made above) and is not on the plan.
    expect(states.HIP).toBe("locked");
    // Knee is on the plan; with Knee coming soon in an empty database it would be "coming-soon", and that is drawn correctly too.
    expect(states.KNEE).not.toBe("locked");

    for (const category of CATEGORIES) {
      // A category on the plan has a tab, whatever its state; one that is not has no link at all.
      const link = `href="/library/${category.slug}"`;
      if (category.value === "KNEE") expect(html).toContain(link);
      else expect(html).not.toContain(link);
      // "View category" only where there is something to see.
      if (states[category.value] === "available") expect(html).toContain(`aria-label="View ${category.label}"`);
      else expect(html).not.toContain(`aria-label="View ${category.label}"`);
    }
    expect(html).toContain("Not on your plan");
    // The locked line does not carry the locked category's video.
    expect(html).not.toContain(hipSrc);
  });

  it("puts the clinic's own categories first, the locked ones in a closed More categories section, and leaves out coming soon ones not on the plan", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = renderToStaticMarkup(await LibraryPage());
    const states = await expectedStates(kneeClinic);

    // Split the page at the More categories section: the main grid is everything before it.
    const at = html.indexOf("<details");
    expect(at).toBeGreaterThan(-1);
    const main = html.slice(0, at);
    const more = html.slice(at);

    // Closed until tapped, because this clinic has a category of its own.
    expect(more).not.toMatch(/^<details[^>]*\sopen/);
    expect(more).toContain("More categories");

    for (const category of CATEGORIES) {
      const label = `>${category.label.replace("&", "&amp;")}<`; // as React writes it
      if (category.value === "KNEE") {
        // On the plan: a tab and a row of its own, whatever state it is in, and not listed again below.
        expect(main).toContain(label);
        expect(main).toContain('id="row-knee"');
        expect(more).not.toContain(label);
      } else if (states[category.value] === "locked") {
        expect(more).toContain(label);
        expect(main).not.toContain(label);
      } else {
        // Not on the plan and nothing in it: not on the page at all.
        expect(states[category.value]).toBe("coming-soon");
        expect(html).not.toContain(label);
      }
    }
    const locked = CATEGORIES.filter((c) => states[c.value] === "locked").length;
    expect(more).toContain(`(${locked} not on your plan)`);
  });

  it("lists the locked categories one to a row, each with its padlock, its name as plain text and 'Not on your plan'", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = renderToStaticMarkup(await LibraryPage());
    const states = await expectedStates(kneeClinic);
    const { list, rows } = moreRows(html);

    // A single column at every width: no grid that would set the rows side by side.
    expect(list.match(/^<ul[^>]*>/)![0]).not.toMatch(/grid|flex|columns/);
    const lockedLabels = CATEGORIES.filter((c) => states[c.value] === "locked").map((c) => c.label.replace("&", "&amp;"));
    expect([...rows.keys()]).toEqual(lockedLabels);
    for (const row of rows.values()) {
      // The padlock (a drawing, hidden from screen readers), the name, and the plain words. A member's row links nowhere.
      expect(row).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]*?<rect/);
      expect(row).toContain("Not on your plan");
      expect(row).not.toContain("<a ");
      // The name itself is plain text, not a link and not underlined.
      expect(row).not.toMatch(/<span[^>]*underline[^>]*>[^<]+<\/span>/);
    }
  });

  it("opens More categories, and says so, for an open clinic with nothing on its plan", async () => {
    const orgNone = fakeOrgId();
    const clinic = await prisma.clinic.create({
      data: { name: "Vitest library clinic (no categories)", clerkOrgId: orgNone, status: "ACTIVE", categories: [] },
      select: { id: true },
    });
    createdClinicIds.push(clinic.id);
    signInAs(orgNone, "Vitest library clinic (no categories)");
    const html = renderToStaticMarkup(await LibraryPage());

    expect(html).toContain("Your clinic&#x27;s plan has no categories yet.");
    // Hip has a published video, so it is listed, and the section starts open.
    expect(html).toMatch(/<details[^>]*\sopen/);
    expect(html).toContain(">Hip<");
    expect(html).not.toContain('href="/library/');
  });

  it("gives an office admin one 'Add to your plan' link on each locked category that is for sale, to Billing with that category suggested, and no price", async () => {
    await hipForSale(true);
    signInAs(orgKnee, "Vitest library clinic (knee)", "admin");
    const html = renderToStaticMarkup(await LibraryPage());
    const states = await expectedStates(kneeClinic);

    expect(html).toContain(addLink("hip"));
    expect(html).toContain("Add to your plan");
    expect(html).toContain('aria-label="Add Hip to your plan"');
    // On Hip's own row, after its name, and the only link in that row (the name is not one).
    const hipRow = moreRows(html).rows.get("Hip");
    expect(hipRow).toBeDefined();
    expect(hipRow!.match(/<a /g)).toHaveLength(1);
    expect(hipRow!.indexOf(addLink("hip"))).toBeGreaterThan(hipRow!.indexOf(">Hip<"));
    expect(hipRow).toContain(">Add to your plan</a>");
    expect(hipRow).not.toContain("Not on your plan");
    // A category already on the plan has no such link, and neither does one with nothing in it yet (it is not on the page at all).
    expect(html).not.toContain(addLink("knee"));
    for (const category of CATEGORIES) {
      if (states[category.value] !== "locked") expect(html).not.toContain(addLink(category.slug));
    }
    // Still locked: the link adds nothing by itself, and nothing playable is sent.
    expect(html).not.toContain('href="/library/hip"');
    expect(html).not.toContain(hipSrc);
    // No prices in the library.
    expect(html).not.toMatch(/\$\d/);
  });

  it("tells a member to ask an office admin, and links nowhere", async () => {
    await hipForSale(true);
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain("Ask your office admin to add one of these.");
    expect(html).not.toContain("Add to your plan");
    expect(html).not.toContain("/admin/billing");
    expect(moreRows(html).rows.get("Hip")).toContain("Not on your plan");
  });

  it("offers nothing for a locked category that is not for sale, to an admin or a member", async () => {
    await hipForSale(false);
    signInAs(orgKnee, "Vitest library clinic (knee)", "admin");
    const admin = renderToStaticMarkup(await LibraryPage());
    expect(admin).toContain(">Hip<");
    expect(admin).not.toContain(addLink("hip"));
    expect(admin).not.toContain("Add Hip to your plan");
    const adminHip = moreRows(admin).rows.get("Hip");
    expect(adminHip).toContain("Not on your plan");
    expect(adminHip).not.toContain("<a ");

    signInAs(orgKnee, "Vitest library clinic (knee)");
    const member = renderToStaticMarkup(await LibraryPage());
    expect(member).toContain(">Hip<");
    expect(member).not.toContain("/admin/billing");
  });

  it("shows a clinic that is not open the calm page, not the tiles; a member is told to ask an admin and gets no Billing button", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)");
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain("Choose a plan to start");
    expect(html).not.toContain('href="/library/knee"');
    expect(html).toContain("Ask one of them to open Billing.");
    expect(html).not.toContain("Go to billing");
    expect(html).not.toContain('href="/admin/billing"');
  });

  it("gives an admin of a clinic that is not open (a new clinic's owner, most often) a button to Billing", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)", "admin");
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain("Choose a plan to start");
    expect(html).toContain("Go to billing");
    expect(html).toContain('href="/admin/billing"');
    expect(html).not.toContain("Ask one of them to open Billing.");
    expect(html).not.toContain('href="/library/knee"');
  });
});

describe("a category's own page", () => {
  it("gives the Send button only to someone holding a seat; everyone else can play, and is told why there is no Send", async () => {
    signInAs(orgHipAll, "Vitest library clinic (hip)");
    const noSeat = await renderCategory("hip");
    expect(noSeat).toContain(hipTitle);
    expect(noSeat).toContain(`Play ${hipTitle}`);
    expect(noSeat).not.toContain(`Send ${hipTitle} to a patient`);
    expect(noSeat).toContain("Sending one to a patient needs a surgeon seat");

    await prisma.seatAllocation.create({ data: { clinicId: hipAllClinic, clerkUserId: "user_vitest", syncState: "SYNCED" } });
    try {
      signInAs(orgHipAll, "Vitest library clinic (hip)");
      const seated = await renderCategory("hip");
      expect(seated).toContain(`Send ${hipTitle} to a patient`);
      expect(seated).not.toContain("needs a surgeon seat");
    } finally {
      await prisma.seatAllocation.deleteMany({ where: { clinicId: hipAllClinic } });
    }
  });

  it("does not count a seat at another clinic", async () => {
    await prisma.seatAllocation.create({ data: { clinicId: kneeClinic, clerkUserId: "user_vitest", syncState: "SYNCED" } });
    try {
      signInAs(orgHipAll, "Vitest library clinic (hip)");
      expect(await renderCategory("hip")).not.toContain(`Send ${hipTitle} to a patient`);
    } finally {
      await prisma.seatAllocation.deleteMany({ where: { clinicId: kneeClinic } });
    }
  });

  it("says a category off the plan is not on the plan, and sends nothing playable, even when the address is typed", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = await renderCategory("hip");
    expect(html).toContain("is not on your clinic");
    expect(html).toContain('href="/library"');
    expect(html).not.toContain(hipTitle);
    expect(html).not.toContain(hipSrc);
    expect(html).not.toContain("to a patient");
  });

  it("gives an office admin 'Add to your plan' on a locked category's page, and still sends nothing playable", async () => {
    await hipForSale(true);
    signInAs(orgKnee, "Vitest library clinic (knee)", "admin");
    const html = await renderCategory("hip");
    expect(html).toContain("is not on your clinic");
    expect(html).toContain(addLink("hip"));
    expect(html).toContain("Add to your plan");
    expect(html).toContain('href="/library"');
    expect(html).not.toContain(hipTitle);
    expect(html).not.toContain(hipSrc);
    expect(html).not.toMatch(/\$\d/);
  });

  it("tells a member on a locked category's page to ask an office admin, with no link to Billing", async () => {
    await hipForSale(true);
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = await renderCategory("hip");
    expect(html).toContain("Ask your office admin to add this.");
    expect(html).not.toContain("Add to your plan");
    expect(html).not.toContain("/admin/billing");
  });

  it("offers nothing on the page of a locked category that is not for sale", async () => {
    await hipForSale(false);
    signInAs(orgKnee, "Vitest library clinic (knee)", "admin");
    const html = await renderCategory("hip");
    expect(html).toContain("is not on your clinic");
    expect(html).not.toContain("Add to your plan");
    expect(html).not.toContain("/admin/billing");
    expect(html).not.toContain("Ask your office admin");
  });

  it("has no 'Add to your plan' on the page of a category that is on the plan", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)", "admin");
    const html = await renderCategory("knee");
    expect(html).not.toContain("Add to your plan");
    expect(html).not.toContain("/admin/billing?add=");
  });

  it("draws a category on the plan in the state the rule gives it", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = await renderCategory("knee");
    const states = await expectedStates(kneeClinic);
    if (states.KNEE === "available") {
      expect(html).toContain("to a patient");
    } else if (states.KNEE === "coming-soon") {
      expect(html).toContain("Coming soon");
    } else {
      expect(html).toContain("Nothing in Knee yet");
    }
    expect(html).not.toContain("not on your clinic");
  });

  it("never sends a placeholder to a clinic shown finished animations only, and says so honestly when that leaves nothing", async () => {
    signInAs(orgHipFinishedOnly, "Vitest library clinic (hip, finished only)");
    const html = await renderCategory("hip");
    const states = await expectedStates(hipFinishedOnlyClinic);

    // The placeholder made above is never on this clinic's page, whatever else Hip holds.
    expect(html).not.toContain(hipTitle);
    expect(html).not.toContain(hipSrc);
    expect(html).not.toContain("not on your clinic");

    if (states.HIP === "empty") {
      expect(html).toContain("Nothing in Hip yet");
      expect(html).toContain("finished animations only");
      expect(html).not.toContain("to a patient");
    } else {
      // Something finished is published in Hip right now, so the grid shows, without the placeholder.
      expect(states.HIP).toBe("available");
      expect(html).toContain("to a patient");
    }
  });

  it("is not found for a slug that is not a category", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    await expect(renderCategory("elbow")).rejects.toThrow("notFound");
  });

  it("shows a clinic that is not open the calm page, with the Billing button for an admin only", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)");
    const member = await renderCategory("knee");
    expect(member).toContain("Choose a plan to start");
    expect(member).not.toContain("to a patient");
    expect(member).not.toContain('href="/admin/billing"');

    signInAs(orgPending, "Vitest library clinic (pending)", "admin");
    const admin = await renderCategory("knee");
    expect(admin).toContain("Choose a plan to start");
    expect(admin).toContain('href="/admin/billing"');
    expect(admin).not.toContain("to a patient");
  });
});

/**
 * The rows on the home page, for a clinic of their own (Knee only), so what
 * this person hearted and played is known exactly. "user_vitest" is the
 * person signInAs() signs in.
 */
describe("the library home's rows", () => {
  const orgRows = fakeOrgId();
  let rowsClinic = "";
  const tag = randomBytes(4).toString("hex");
  const titles = Array.from({ length: 6 }, (_, i) => `Vitest rows knee ${i + 1} ${tag}`);
  const ids: string[] = [];

  /** The HTML of one section of the home page, from its opening tag to its end. */
  function section(html: string, marker: string): string {
    const at = html.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf("<section", at);
    return html.slice(start, html.indexOf("</section>", at) + "</section>".length);
  }

  async function renderHome() {
    signInAs(orgRows, "Vitest library clinic (rows)");
    return renderToStaticMarkup(await LibraryPage());
  }

  beforeAll(async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "Vitest library clinic (rows)", clerkOrgId: orgRows, status: "ACTIVE", categories: ["KNEE"] },
      select: { id: true },
    });
    rowsClinic = clinic.id;
    createdClinicIds.push(clinic.id);
    for (const [i, title] of titles.entries()) {
      // Made a minute apart, so the newest is certain.
      const video = await prisma.video.create({
        data: { title, category: "KNEE", videoUrl: `https://example.com/${tag}-${i}.mp4`, isPublished: true, createdAt: new Date(Date.now() + i * 60_000) },
        select: { id: true },
      });
      ids.push(video.id);
      createdVideoIds.push(video.id);
    }
  });

  it("with nothing hearted or played: the quiet favorites line, no Most watched, the tabs with All lit", async () => {
    const html = await renderHome();
    expect(section(html, 'id="favorites"')).toContain(FAVORITES_EMPTY);
    expect(html).not.toContain("Most watched");
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/library"|<a[^>]*href="\/library"[^>]*aria-current="page"/);
    expect(html).toContain('href="/library/knee"');
    // No number about plays or hearts anywhere.
    expect(html).not.toMatch(/\b\d+ (plays?|views?|favorites?)\b/i);
  });

  it("each category on the plan is a row of at most five cards, newest first, with View category", async () => {
    const html = await renderHome();
    const knee = section(html, 'id="row-knee"');
    const plays = [...knee.matchAll(/aria-label="Play [^"]+"/g)];
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.length).toBeLessThanOrEqual(5);
    expect(knee).toContain('aria-label="View Knee"');
    expect(knee).toContain('href="/library/knee"');
    // The newest of this file's videos is there, and the oldest of six cannot be among the newest five.
    expect(knee).toContain(titles[5]);
    expect(knee).not.toContain(titles[0]);
  });

  it("shows My favorites, newest heart first, with their hearts filled wherever they appear", async () => {
    await setFavorite(rowsClinic, "user_vitest", ids[1]!, true, new Date("2026-10-01T00:00:00Z"));
    await setFavorite(rowsClinic, "user_vitest", ids[5]!, true, new Date("2026-10-02T00:00:00Z"));
    const html = await renderHome();
    const favorites = section(html, 'id="favorites"');
    expect(favorites).not.toContain(FAVORITES_EMPTY);
    expect(favorites.indexOf(titles[5]!)).toBeGreaterThan(-1);
    expect(favorites.indexOf(titles[5]!)).toBeLessThan(favorites.indexOf(titles[1]!));
    expect(favorites).toContain(`aria-label="Remove ${titles[5]} from my favorites"`);
    // The same video in the Knee row has its heart filled too; one not hearted does not.
    const knee = section(html, 'id="row-knee"');
    expect(knee).toMatch(new RegExp(`aria-pressed="true"[^>]*aria-label="Remove ${titles[5]} from my favorites"`));
    expect(knee).toMatch(new RegExp(`aria-pressed="false"[^>]*aria-label="Add ${titles[4]} to my favorites"`));
  });

  it("hides a favorite whose category is not on the plan, and sends nothing playable for it", async () => {
    // A heart left over from when Hip was on the plan (written directly: the app would refuse it today).
    const hipId = createdVideoIds[0]!;
    await prisma.personalVideo.create({ data: { clinicId: rowsClinic, clerkUserId: "user_vitest", videoId: hipId, favoritedAt: new Date(), playCount: 9 } });
    const html = await renderHome();
    expect(html).not.toContain(hipTitle);
    expect(html).not.toContain(hipSrc);
  });

  it("shows Most watched only once three different videos have been played, most played first", async () => {
    await recordLibraryPlay(rowsClinic, "user_vitest", ids[2]!);
    await recordLibraryPlay(rowsClinic, "user_vitest", ids[3]!);
    await recordLibraryPlay(rowsClinic, "user_vitest", ids[3]!);
    // Two played (the Hip play above is off the plan and does not count): not yet.
    expect(await renderHome()).not.toContain("Most watched");

    await recordLibraryPlay(rowsClinic, "user_vitest", ids[4]!);
    const html = await renderHome();
    const most = section(html, 'id="most-watched-heading"');
    expect(most.indexOf(titles[3]!)).toBeGreaterThan(-1);
    expect(most.indexOf(titles[3]!)).toBeLessThan(most.indexOf(titles[2]!));
    expect(most).toContain(titles[4]);
    // Still no number on the page.
    expect(html).not.toMatch(/\b\d+ (plays?|views?|times?)\b/i);
  });

  it("is someone else's own: another person in the same clinic sees none of it", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_vitest_someone_else", orgId: orgRows, has: () => false } as never);
    vi.mocked(auth.protect).mockResolvedValue(undefined as never);
    vi.mocked(clerkClient).mockResolvedValue({
      organizations: {
        getOrganizationMembershipList: async () => ({
          data: [{ organization: { name: "Vitest library clinic (rows)", hasImage: false, imageUrl: "" }, publicMetadata: {}, role: "org:member" }],
        }),
      },
    } as never);
    const html = renderToStaticMarkup(await LibraryPage());
    expect(section(html, 'id="favorites"')).toContain(FAVORITES_EMPTY);
    expect(html).not.toContain("Most watched");
    expect(html).not.toContain(`aria-label="Remove ${titles[5]} from my favorites"`);
  });

  it("draws the tabs on a category's page with that one lit, and the hearts on its cards", async () => {
    signInAs(orgRows, "Vitest library clinic (rows)");
    const html = await renderCategory("knee");
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/library\/knee"|<a[^>]*href="\/library\/knee"[^>]*aria-current="page"/);
    expect(html).toContain('href="/library"');
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*aria-label="Remove ${titles[1]} from my favorites"`));
    expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*aria-label="Add ${titles[0]} to my favorites"`));
  });

  it("puts the pills first on a category's page and keeps no headline on the home page", async () => {
    signInAs(orgRows, "Vitest library clinic (rows)");
    const category = await renderCategory("knee");
    expect(category.indexOf('aria-label="Categories"')).toBeLessThan(category.indexOf("<h1"));
    const home = await renderHome();
    expect(home).toMatch(/<h1 class="sr-only">My Procedure Library<\/h1>/);
  });

  /** Render the search results the way the server does, for what was typed. */
  async function renderSearch(q: string | undefined) {
    signInAs(orgRows, "Vitest library clinic (rows)");
    return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) } as never));
  }

  it("search finds what the clinic may use, by any part of the title, ignoring capitals, with no pill lit", async () => {
    const html = await renderSearch(`ROWS KNEE`);
    for (const title of titles) expect(html).toContain(title);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('aria-label="Categories"');
    // The cards have their hearts, filled where this person hearted.
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*aria-label="Remove ${titles[1]} from my favorites"`));
  });

  it("search never finds a video off the plan, and says so plainly when nothing matches", async () => {
    const html = await renderSearch(hipTitle);
    expect(html).not.toContain(hipSrc);
    expect(html).toContain("No procedures match");
    expect(html).not.toContain("<article");
  });

  it("search reads % and _ as themselves, and an empty search goes home", async () => {
    const access = await getClinicAccess(rowsClinic);
    if (!access) throw new Error("clinic missing");
    for (const wild of ["%", "_"]) {
      for (const video of await searchUsableVideos(access, wild, 60)) expect(video.title).toContain(wild);
    }
    await expect(renderSearch("   ")).rejects.toThrow("redirect:/library");
    await expect(renderSearch(undefined)).rejects.toThrow("redirect:/library");
  });

  it("search shows a clinic that is not open the calm page", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)");
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ q: "knee" }) } as never));
    expect(html).toContain("Choose a plan to start");
    expect(html).not.toContain("<article");
  });
});
