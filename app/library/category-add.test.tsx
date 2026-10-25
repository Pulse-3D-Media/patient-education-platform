import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readNewCategory } from "@/lib/categories";
import { addCategory, getCategoryList } from "@/lib/db/category-config";
import { prisma } from "@/lib/db/client";
import CategoryPage from "./[category]/page";
import LibraryPage from "./page";

/**
 * A category added on /pulse/videos (K3), seen from the library: a clinic
 * Pulse gives it to by hand gets a pill, a row that says Coming soon (nothing
 * is published in it yet), and its own page at its address. A clinic without
 * it sees nothing of it: a coming-soon category off the plan is not on the
 * home page. Clerk is a stand-in, the database is real, and the category is
 * removed at the end.
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

const tag = randomBytes(3).toString("hex");
const label = `Vitest Elbow ${tag}`;
const slug = `vitest-elbow-${tag}`;
const withIt = { org: `org_test_${randomBytes(8).toString("hex")}`, name: "Vitest added-category clinic" };
const without = { org: `org_test_${randomBytes(8).toString("hex")}`, name: "Vitest knee-only clinic" };
const clinicIds: string[] = [];
let key = "";

function signIn(who: { org: string; name: string }) {
  vi.mocked(auth).mockResolvedValue({ userId: "user_vitest", orgId: who.org, has: () => false } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: who.name, hasImage: false, imageUrl: "" }, publicMetadata: {}, role: "org:member" }],
      }),
    },
  } as never);
}

beforeAll(async () => {
  const read = readNewCategory({ label, slug, imageUrl: "", sortOrder: "" }, await getCategoryList());
  if (!read.ok) throw new Error(read.error);
  key = (await addCategory(read.category)).value;
  for (const [who, categories] of [[withIt, ["KNEE", key]], [without, ["KNEE"]]] as const) {
    const clinic = await prisma.clinic.create({ data: { name: who.name, clerkOrgId: who.org, status: "ACTIVE", categories: [...categories] }, select: { id: true } });
    clinicIds.push(clinic.id);
  }
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.categoryConfig.deleteMany({ where: { category: key } });
  await prisma.$disconnect();
});

describe("an added category in the library", () => {
  it("is a pill and a Coming soon row for a clinic that has it", async () => {
    signIn(withIt);
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain(`href="/library/${slug}"`);
    expect(html).toContain(label);
    expect(html).toContain("Coming soon");
  });

  it("has its own page at its address, saying it is coming soon", async () => {
    signIn(withIt);
    const html = renderToStaticMarkup(await CategoryPage({ params: Promise.resolve({ category: slug }) } as never));
    expect(html).toContain(`${label}</h1>`);
    expect(html).toContain("Coming soon");
  });

  it("is nowhere for a clinic without it while nothing is published in it", async () => {
    signIn(without);
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).not.toContain(label);
    expect(html).not.toContain(`href="/library/${slug}"`);
  });
});
