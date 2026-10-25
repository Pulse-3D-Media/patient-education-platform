import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryList, saveCategoryConfig } from "@/lib/db/category-config";
import { setClinicPlan } from "@/lib/db/clinics";
import { prisma } from "@/lib/db/client";
import { categoriesCsv } from "@/lib/report-csv";
import CategoryPage from "./[category]/page";
import LibraryPage from "./page";

/**
 * A category renamed on /pulse/videos, seen from the other side: the
 * library draws the new name and the new address, the old address (the
 * default and any earlier one) redirects to the new one so no bookmark
 * breaks, and a clinic log entry written afterwards uses the new name.
 * Clerk is a stand-in and the database is real. Knee's row is put back
 * exactly as it was found.
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

const FIELDS = { sellable: true, comingSoonText: true, label: true, slug: true, imageUrl: true, sortOrder: true, formerSlugs: true } as const;

const orgId = `org_test_${randomBytes(8).toString("hex")}`;
const clinicName = "Vitest rename clinic";
let clinicId = "";
let kneeBefore: Awaited<ReturnType<typeof prisma.categoryConfig.findUnique<{ where: { category: "KNEE" }; select: typeof FIELDS }>>> = null;

function signIn() {
  vi.mocked(auth).mockResolvedValue({ userId: "user_vitest", orgId, has: () => false } as never);
  vi.mocked(auth.protect).mockResolvedValue(undefined as never);
  vi.mocked(clerkClient).mockResolvedValue({
    organizations: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { name: clinicName, hasImage: false, imageUrl: "" }, publicMetadata: {}, role: "org:member" }],
      }),
    },
  } as never);
}

beforeAll(async () => {
  await getCategoryList(); // makes sure every row exists
  kneeBefore = await prisma.categoryConfig.findUnique({ where: { category: "KNEE" }, select: FIELDS });
  const clinic = await prisma.clinic.create({
    data: { name: clinicName, clerkOrgId: orgId, status: "ACTIVE", categories: ["KNEE"], showPlaceholders: true },
    select: { id: true },
  });
  clinicId = clinic.id;
  // Renamed twice, so there is an earlier address besides the default one.
  const sale = { sellable: kneeBefore?.sellable ?? true, comingSoonText: kneeBefore?.comingSoonText ?? null };
  await saveCategoryConfig("KNEE", sale, { label: "Knee Joint", slug: "vitest-knee-joint", imageUrl: null, sortOrder: null });
  await saveCategoryConfig("KNEE", sale, { label: "Knee and Leg", slug: "vitest-knee-leg", imageUrl: null, sortOrder: null });
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(async () => {
  if (kneeBefore) await prisma.categoryConfig.update({ where: { category: "KNEE" }, data: kneeBefore });
  await prisma.clinicNote.deleteMany({ where: { clinicId } });
  await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.$disconnect();
});

describe("a renamed category", () => {
  it("shows its new name and address on the library home", async () => {
    signIn();
    const html = renderToStaticMarkup(await LibraryPage());
    expect(html).toContain('href="/library/vitest-knee-leg"');
    expect(html).toContain("Knee and Leg");
    expect(html).not.toContain('href="/library/knee"');
    expect(html).not.toContain('href="/library/vitest-knee-joint"');
  });

  it("opens at its new address, with the new name", async () => {
    signIn();
    const html = renderToStaticMarkup(await CategoryPage({ params: Promise.resolve({ category: "vitest-knee-leg" }) } as never));
    expect(html).toContain("Knee and Leg</h1>");
  });

  it("sends the original address and the earlier one on to the new one", async () => {
    signIn();
    for (const old of ["knee", "vitest-knee-joint"]) {
      await expect(CategoryPage({ params: Promise.resolve({ category: old }) } as never)).rejects.toThrow("redirect:/library/vitest-knee-leg");
    }
    // An address no category ever had is still not found.
    await expect(CategoryPage({ params: Promise.resolve({ category: "vitest-never-a-category" }) } as never)).rejects.toThrow("notFound");
  });

  it("is written with its new name in a clinic log entry, and in a report file", async () => {
    await setClinicPlan(clinicId, ["KNEE", "HIP"], 0, "Vitest");
    const note = await prisma.clinicNote.findFirst({ where: { clinicId }, orderBy: { createdAt: "desc" } });
    expect(note?.body).toContain("categories set to Knee and Leg, Hip (was Knee and Leg)");

    const list = await getCategoryList();
    const none = { made: 0, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 };
    expect(categoriesCsv([{ category: "KNEE", ...none }], list)).toContain('"Knee and Leg"');
  });
});
