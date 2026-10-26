import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { categoryState } from "../access";
import { readNewCategory } from "../categories";
import { getClinicAccess } from "./access";
import {
  CATEGORY_IN_USE,
  CategoryDetailsError,
  NOT_FOR_SALE_YET,
  addCategory,
  deleteUnusedCategory,
  getCategoryAvailability,
  getCategoryList,
  listDeletableCategories,
  listSellableCategories,
  saveCategoryConfig,
} from "./category-config";
import { PlanCategoriesRefusedError, setClinicPlan } from "./clinics";
import { prisma } from "./client";
import { countPublishedVideosByKind } from "./videos";

/**
 * Adding a category (K3) against the real test database. Each test adds
 * categories with a made-up name of its own and the file removes them, and
 * anything it made in them, at the end. Nothing in the app deletes a
 * category; only this cleanup does, on the testing branch.
 */

const tag = randomBytes(3).toString("hex");
const name = (what: string) => `Vitest ${what} ${tag}`;
const addedKeys: string[] = [];
const clinicIds: string[] = [];
const videoIds: string[] = [];

async function add(what: string, slug = `vitest-${what}-${tag}`) {
  const read = readNewCategory({ label: name(what), slug, imageUrl: "", sortOrder: "" }, await getCategoryList());
  if (!read.ok) throw new Error(read.error);
  const added = await addCategory(read.category);
  addedKeys.push(added.value);
  return added;
}

afterAll(async () => {
  await prisma.share.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { videoId: { in: videoIds } }] } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.categoryConfig.deleteMany({ where: { category: { in: addedKeys } } });
  await prisma.$disconnect();
});

describe("addCategory", () => {
  it("adds a category to the list, not for sale, coming soon until something is published in it", async () => {
    const added = await add("hand");
    expect(added).toMatchObject({ label: name("hand"), slug: `vitest-hand-${tag}`, sellable: false });
    expect(added.value).toMatch(/^VITEST_HAND_/);
    expect((await getCategoryList()).map((entry) => entry.value)).toContain(added.value);
    expect((await getCategoryAvailability())[added.value]).toBe("not-for-sale");
    expect(await listSellableCategories()).not.toContain(added.value);

    // A clinic Pulse gives it to by hand sees it as coming soon, by the same rule as any category.
    const clinic = await prisma.clinic.create({ data: { name: name("clinic"), status: "ACTIVE", categories: ["KNEE", added.value] }, select: { id: true } });
    clinicIds.push(clinic.id);
    const access = await getClinicAccess(clinic.id);
    const counts = await countPublishedVideosByKind();
    expect(categoryState(access!, added.value, counts[added.value])).toBe("coming-soon");

    // Once a video in it is published, it is available to that clinic.
    const video = await prisma.video.create({
      data: { title: name("video"), category: added.value, videoUrl: "https://example.com/vitest.mp4", isPublished: true },
      select: { id: true },
    });
    videoIds.push(video.id);
    expect(categoryState(access!, added.value, (await countPublishedVideosByKind(added.value))[added.value])).toBe("available");
  });

  it("refuses a name or an address another category has, writing nothing", async () => {
    const first = await add("dup");
    const before = await prisma.categoryConfig.count();
    const list = await getCategoryList();
    await expect(addCategory({ key: `${first.value}_X`, label: first.label, slug: `vitest-other-${tag}`, imageUrl: null, sortOrder: 90 })).rejects.toBeInstanceOf(
      CategoryDetailsError,
    );
    await expect(addCategory({ key: `VITEST_OTHER_${tag.toUpperCase()}`, label: name("other"), slug: first.slug, imageUrl: null, sortOrder: 90 })).rejects.toBeInstanceOf(
      CategoryDetailsError,
    );
    await expect(addCategory({ key: `VITEST_KNEE2_${tag.toUpperCase()}`, label: name("knee2"), slug: "knee", imageUrl: null, sortOrder: 90 })).rejects.toBeInstanceOf(
      CategoryDetailsError,
    );
    expect(await prisma.categoryConfig.count()).toBe(before);
    expect(readNewCategory({ label: name("other"), slug: first.slug, imageUrl: "", sortOrder: "" }, list)).toMatchObject({ ok: false });
  });

  it("lets two adds of the same category at once end with one", async () => {
    const read = readNewCategory({ label: name("race"), slug: `vitest-race-${tag}`, imageUrl: "", sortOrder: "" }, await getCategoryList());
    if (!read.ok) throw new Error(read.error);
    addedKeys.push(read.category.key);
    const results = await Promise.allSettled([addCategory(read.category), addCategory(read.category)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(CategoryDetailsError);
    expect(await prisma.categoryConfig.count({ where: { category: read.category.key } })).toBe(1);
  });

  it("cannot be put on sale until new categories' pricing is decided, and its details can be changed", async () => {
    const added = await add("sale");
    await expect(saveCategoryConfig(added.value, { sellable: true, comingSoonText: null })).rejects.toThrow(NOT_FOR_SALE_YET);
    expect((await prisma.categoryConfig.findUnique({ where: { category: added.value } }))?.sellable).toBe(false);
    await saveCategoryConfig(added.value, { sellable: false, comingSoonText: "Soon." }, { label: name("sale2"), slug: `vitest-sale2-${tag}`, imageUrl: null, sortOrder: 95 });
    expect((await getCategoryList()).find((entry) => entry.value === added.value)).toMatchObject({
      label: name("sale2"),
      slug: `vitest-sale2-${tag}`,
      order: 95,
      formerSlugs: [`vitest-sale-${tag}`],
      comingSoonText: "Soon.",
    });
  });

  it("leaves a clinic's plan exactly as it was", async () => {
    const clinic = await prisma.clinic.create({ data: { name: name("plan"), status: "ACTIVE", categories: ["KNEE", "HIP"], surgeonSeats: 2 }, select: { id: true } });
    clinicIds.push(clinic.id);
    await add("plan");
    expect(await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { categories: true, surgeonSeats: true } })).toEqual({ categories: ["KNEE", "HIP"], surgeonSeats: 2 });
  });
});

describe("deleteUnusedCategory (decided by Evan on 2026-10-26)", () => {
  it("deletes an added category nothing uses, and lists it as deletable until then", async () => {
    const added = await add("mistake");
    expect(await listDeletableCategories()).toContain(added.value);
    await deleteUnusedCategory(added.value);
    expect(await prisma.categoryConfig.findUnique({ where: { category: added.value } })).toBeNull();
    expect((await getCategoryList()).map((entry) => entry.value)).not.toContain(added.value);
  });

  it("never deletes a starting category, or one with a video (even unpublished) or on a clinic's plan", async () => {
    await expect(deleteUnusedCategory("KNEE")).rejects.toBeInstanceOf(CategoryDetailsError);
    expect(await listDeletableCategories()).not.toContain("KNEE");

    const withVideo = await add("withvideo");
    const video = await prisma.video.create({ data: { title: name("draft"), category: withVideo.value, videoUrl: "https://example.com/v.mp4", isPublished: false }, select: { id: true } });
    videoIds.push(video.id);
    await expect(deleteUnusedCategory(withVideo.value)).rejects.toThrow(CATEGORY_IN_USE);
    expect(await listDeletableCategories()).not.toContain(withVideo.value);

    const onPlan = await add("onplan");
    const clinic = await prisma.clinic.create({ data: { name: name("planned"), status: "ACTIVE", categories: [onPlan.value] }, select: { id: true } });
    clinicIds.push(clinic.id);
    await expect(deleteUnusedCategory(onPlan.value)).rejects.toThrow(CATEGORY_IN_USE);
    expect(await prisma.categoryConfig.findUnique({ where: { category: onPlan.value } })).not.toBeNull();
  });

  it("a plan saved at the same moment as a delete: the delete waits for it and refuses (the lock), with a control", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // A plan save holding the category row the way setClinicPlan() does (FOR SHARE), slow to commit.
    const race = async (lock: boolean) => {
      const added = await add(lock ? "race-lock" : "race-plain");
      const clinic = await prisma.clinic.create({ data: { name: name("race clinic"), status: "ACTIVE" }, select: { id: true } });
      clinicIds.push(clinic.id);
      const save = prisma.$transaction(
        async (tx) => {
          if (lock) await tx.$queryRaw`SELECT "category" FROM "CategoryConfig" WHERE "category" = ${added.value} FOR SHARE`;
          await tx.clinic.update({ where: { id: clinic.id }, data: { categories: [added.value] } });
          await wait(2000);
        },
        { timeout: 20_000 },
      );
      await wait(400);
      const deleted = deleteUnusedCategory(added.value).then(
        () => "deleted",
        (error: unknown) => (error instanceof CategoryDetailsError ? error.message : "other"),
      );
      await save;
      return { outcome: await deleted, row: await prisma.categoryConfig.findUnique({ where: { category: added.value } }) };
    };

    const locked = await race(true);
    expect(locked.outcome).toBe(CATEGORY_IN_USE);
    expect(locked.row).not.toBeNull();

    // Control: without the lock, the delete does not see the uncommitted plan and goes through, leaving a
    // clinic with a category that no longer exists. That is what setClinicPlan()'s lock prevents.
    const plain = await race(false);
    expect(plain.outcome).toBe("deleted");
    expect(plain.row).toBeNull();
  });
});

describe("setClinicPlan after a delete", () => {
  it("refuses a category that was deleted a moment ago, saving nothing", async () => {
    const added = await add("gone");
    await deleteUnusedCategory(added.value);
    const clinic = await prisma.clinic.create({ data: { name: name("gone clinic"), status: "ACTIVE", categories: ["KNEE"] }, select: { id: true } });
    clinicIds.push(clinic.id);
    await expect(setClinicPlan(clinic.id, ["KNEE", added.value], 0, "Vitest")).rejects.toBeInstanceOf(PlanCategoriesRefusedError);
    expect((await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { categories: true } }))?.categories).toEqual(["KNEE"]);
  });
});
