import { Category } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_COMING_SOON, comingSoonSentence, getCategoryConfigs, saveCategoryConfig } from "./category-config";
import { prisma } from "./client";

/**
 * The CategoryConfig rows against the real test database. There is at most
 * one row per category, shared by every test run, so these tests note which
 * rows they created (and what one row said before) and put things back
 * afterwards. Rows that already existed are left as they were found.
 */

const ALL = Object.values(Category);
const EDITED: Category = "FOOT_ANKLE";

let createdByThisRun: Category[] = [];
let editedBefore: { sellable: boolean; comingSoonText: string | null } | null = null;

beforeAll(async () => {
  const existing = new Set((await prisma.categoryConfig.findMany({ select: { category: true } })).map((row) => row.category));
  createdByThisRun = ALL.filter((category) => !existing.has(category));
  const row = await prisma.categoryConfig.findUnique({ where: { category: EDITED } });
  editedBefore = row ? { sellable: row.sellable, comingSoonText: row.comingSoonText } : null;
});

afterAll(async () => {
  if (editedBefore && !createdByThisRun.includes(EDITED)) {
    await prisma.categoryConfig.update({ where: { category: EDITED }, data: editedBefore });
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
