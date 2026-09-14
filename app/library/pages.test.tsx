import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryState, type CategoryState } from "@/lib/access";
import { CATEGORIES } from "@/lib/categories";
import { getClinicAccess } from "@/lib/db/access";
import { prisma } from "@/lib/db/client";
import { countPublishedVideosByKind } from "@/lib/db/videos";
import CategoryPage from "./[category]/page";
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

/** Pretend Clerk says this person is a member of this organization, with the surgeon question answered. */
function signInAs(orgId: string, orgName: string) {
  vi.mocked(auth).mockResolvedValue({ userId: "user_vitest", orgId, has: () => false } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: orgName, hasImage: false, imageUrl: "" }, publicMetadata: { kind: "surgeon" }, role: "org:member" }],
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
let kneeClinic = "";
let hipFinishedOnlyClinic = "";
const hipTitle = `Vitest library hip video ${randomBytes(4).toString("hex")}`;
const hipSrc = `https://example.com/vitest-${randomBytes(4).toString("hex")}.mp4`;

beforeAll(async () => {
  const clinics = [
    { name: "Vitest library clinic (knee)", clerkOrgId: orgKnee, status: "ACTIVE", categories: ["KNEE"], showPlaceholders: true },
    { name: "Vitest library clinic (hip, finished only)", clerkOrgId: orgHipFinishedOnly, status: "ACTIVE", categories: ["HIP"], showPlaceholders: false },
    { name: "Vitest library clinic (pending)", clerkOrgId: orgPending, status: "PENDING", categories: ["KNEE"], showPlaceholders: true },
  ] as const;
  const ids: string[] = [];
  for (const data of clinics) {
    const clinic = await prisma.clinic.create({ data: { ...data, categories: [...data.categories] }, select: { id: true } });
    createdClinicIds.push(clinic.id);
    ids.push(clinic.id);
  }
  [kneeClinic, hipFinishedOnlyClinic] = ids;

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
      const link = `href="/library/${category.slug}"`;
      if (states[category.value] === "available") expect(html).toContain(link);
      else expect(html).not.toContain(link);
    }
    expect(html).toContain("Not on your plan");
    // The locked tile does not carry the locked category's video.
    expect(html).not.toContain(hipSrc);
  });

  it("shows a clinic that is not open the calm page, not the tiles", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)");
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain("Choose a plan to start");
    expect(html).not.toContain('href="/library/knee"');
  });
});

describe("a category's own page", () => {
  it("says a category off the plan is not on the plan, and sends nothing playable, even when the address is typed", async () => {
    signInAs(orgKnee, "Vitest library clinic (knee)");
    const html = await renderCategory("hip");
    expect(html).toContain("is not on your clinic");
    expect(html).toContain('href="/library"');
    expect(html).not.toContain(hipTitle);
    expect(html).not.toContain(hipSrc);
    expect(html).not.toContain("to a patient");
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

  it("shows a clinic that is not open the calm page", async () => {
    signInAs(orgPending, "Vitest library clinic (pending)");
    const html = await renderCategory("knee");
    expect(html).toContain("Choose a plan to start");
    expect(html).not.toContain("to a patient");
  });
});
