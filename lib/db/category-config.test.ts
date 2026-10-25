import { Category } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_COMING_SOON, CategoryDetailsError, comingSoonSentence, getCategoryConfigs, getCategoryList, saveCategoryConfig } from "./category-config";
import { prisma } from "./client";

/**
 * The CategoryConfig rows against the real test database. There is at most
 * one row per category, shared by every test run, so these tests note which
 * rows they created (and what one row said before) and put things back
 * afterwards. Rows that already existed are left as they were found.
 */

const ALL = Object.values(Category);
const EDITED: Category = "FOOT_ANKLE";

/** Every column a test here may change, so a row can be put back exactly. */
const FIELDS = { sellable: true, comingSoonText: true, label: true, slug: true, imageUrl: true, sortOrder: true, formerSlugs: true } as const;
type Saved = { sellable: boolean; comingSoonText: string | null; label: string | null; slug: string | null; imageUrl: string | null; sortOrder: number | null; formerSlugs: string[] };

let createdByThisRun: Category[] = [];
let editedBefore: Saved | null = null;
let hipBefore: Saved | null = null;

beforeAll(async () => {
  const existing = new Set((await prisma.categoryConfig.findMany({ select: { category: true } })).map((row) => row.category));
  createdByThisRun = ALL.filter((category) => !existing.has(category));
  editedBefore = await prisma.categoryConfig.findUnique({ where: { category: EDITED }, select: FIELDS });
  hipBefore = await prisma.categoryConfig.findUnique({ where: { category: "HIP" }, select: FIELDS });
});

afterAll(async () => {
  // HIP first: the two may have swapped addresses, and the slug column is unique.
  if (hipBefore && !createdByThisRun.includes("HIP")) {
    await prisma.categoryConfig.update({ where: { category: "HIP" }, data: { ...hipBefore, slug: null } });
  }
  if (editedBefore && !createdByThisRun.includes(EDITED)) {
    await prisma.categoryConfig.update({ where: { category: EDITED }, data: editedBefore });
  }
  if (hipBefore && !createdByThisRun.includes("HIP")) {
    await prisma.categoryConfig.update({ where: { category: "HIP" }, data: hipBefore });
  }
  await prisma.categoryConfig.deleteMany({ where: { category: { in: createdByThisRun } } });
  await prisma.$disconnect();
});

describe("comingSoonSentence", () => {
  it("uses the category's own sentence when there is one, else the default", () => {
    expect(comingSoonSentence(undefined)).toBe(DEFAULT_COMING_SOON);
    expect(comingSoonSentence({ sellable: true, comingSoonText: null })).toBe(DEFAULT_COMING_SOON);
    expect(comingSoonSentence({ sellable: true, comingSoonText: "   " })).toBe(DEFAULT_COMING_SOON);
    expect(comingSoonSentence({ sellable: false, comingSoonText: "Hip arrives in November." })).toBe("Hip arrives in November.");
  });
});

describe("getCategoryConfigs", () => {
  it("answers for every category, creating any missing row with the defaults", async () => {
    const configs = await getCategoryConfigs();
    expect(Object.keys(configs).sort()).toEqual([...ALL].sort());
    for (const category of createdByThisRun) {
      expect(configs[category]).toEqual({ sellable: true, comingSoonText: null });
    }
    expect(await prisma.categoryConfig.count()).toBe(ALL.length);
  });

  it("returns what saveCategoryConfig wrote", async () => {
    const saved = await saveCategoryConfig(EDITED, { sellable: false, comingSoonText: "Ankle and foot arrive after launch." });
    expect(saved).toEqual({ sellable: false, comingSoonText: "Ankle and foot arrive after launch." });
    expect((await getCategoryConfigs())[EDITED]).toEqual(saved);
    expect(await prisma.categoryConfig.count()).toBe(ALL.length);
  });
});

describe("the category details (name, web address, picture, place)", () => {
  const sale = { sellable: true, comingSoonText: null };
  const none = { label: null, slug: null, imageUrl: null, sortOrder: null };

  it("are today's values while the columns are empty", async () => {
    await saveCategoryConfig(EDITED, sale, none);
    const ankle = (await getCategoryList()).find((entry) => entry.value === EDITED)!;
    expect(ankle).toMatchObject({ label: "Foot & Ankle", slug: "foot-ankle", order: 60 });
    expect(ankle.image).toMatch(/^https:\/\/cdn\.prod\.website-files\.com\//);
  });

  it("show a rename in the list, keep the address being left, and go back to the defaults when emptied", async () => {
    await saveCategoryConfig(EDITED, sale, { label: "Foot and Ankle", slug: "foot-and-ankle", imageUrl: "https://example.com/ankle.jpg", sortOrder: 5 });
    let list = await getCategoryList();
    expect(list[0]).toMatchObject({ value: EDITED, label: "Foot and Ankle", slug: "foot-and-ankle", image: "https://example.com/ankle.jpg", order: 5 });
    // The default address always redirects on its own, so it is not written down.
    expect(list[0]?.formerSlugs).toEqual([]);

    await saveCategoryConfig(EDITED, sale, { label: "Foot and Ankle", slug: "ankle", imageUrl: null, sortOrder: 5 });
    list = await getCategoryList();
    expect(list.find((entry) => entry.value === EDITED)).toMatchObject({ slug: "ankle", formerSlugs: ["foot-and-ankle"] });

    await saveCategoryConfig(EDITED, sale, none);
    const ankle = (await getCategoryList()).find((entry) => entry.value === EDITED)!;
    expect(ankle).toMatchObject({ label: "Foot & Ankle", slug: "foot-ankle", order: 60 });
    // Both earlier addresses are remembered, so a bookmark to either still opens Foot & Ankle.
    expect(ankle.formerSlugs.sort()).toEqual(["ankle", "foot-and-ankle"]);
    expect(await prisma.categoryConfig.findUnique({ where: { category: EDITED }, select: { label: true, slug: true, imageUrl: true, sortOrder: true } })).toEqual(none);
  });

  it("refuse an address another category has or had, writing nothing", async () => {
    await saveCategoryConfig("HIP", { sellable: true, comingSoonText: null }, { label: null, slug: "hip-joint", imageUrl: null, sortOrder: null });
    const before = await prisma.categoryConfig.findUnique({ where: { category: EDITED }, select: FIELDS });

    for (const slug of ["hip-joint", "hip", "knee"]) {
      await expect(saveCategoryConfig(EDITED, { sellable: false, comingSoonText: "Changed" }, { label: "Changed", slug, imageUrl: null, sortOrder: null })).rejects.toBeInstanceOf(
        CategoryDetailsError,
      );
    }
    expect(await prisma.categoryConfig.findUnique({ where: { category: EDITED }, select: FIELDS })).toEqual(before);
  });

  it("let two saves for the same address at once end with one owner", async () => {
    const results = await Promise.allSettled([
      saveCategoryConfig(EDITED, sale, { label: null, slug: "vitest-race", imageUrl: null, sortOrder: null }),
      saveCategoryConfig("HIP", sale, { label: null, slug: "vitest-race", imageUrl: null, sortOrder: null }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(CategoryDetailsError);
    expect(await prisma.categoryConfig.count({ where: { slug: "vitest-race" } })).toBe(1);
  });

  it("leave the details alone when a save sends none", async () => {
    await saveCategoryConfig(EDITED, sale, { label: "Foot and Ankle", slug: null, imageUrl: null, sortOrder: null });
    await saveCategoryConfig(EDITED, { sellable: false, comingSoonText: null });
    expect((await getCategoryList()).find((entry) => entry.value === EDITED)).toMatchObject({ label: "Foot and Ankle", sellable: false });
  });
});
