import { describe, expect, it } from "vitest";
import {
  CATEGORY_DEFAULTS,
  DEFAULT_CATEGORY_LIST,
  categoryListFromRows,
  defaultOrder,
  findCategoryBySlug,
  formerSlugsAfter,
  inListOrder,
  labelOf,
  labelsInOrder,
  labelsOf,
  readCategoryDetails,
  takenSlugs,
  type CategoryRow,
} from "./categories";

/**
 * The category list as every screen draws it: the starting details in
 * CATEGORY_DEFAULTS with the CategoryConfig rows laid over them, and the
 * checks on the Categories panel's details boxes. Plain values, no database.
 */

/** A row with nothing changed, as the table makes it on first read. */
function row(category: CategoryRow["category"], changes: Partial<CategoryRow> = {}): CategoryRow {
  return { category, sellable: true, comingSoonText: null, label: null, slug: null, imageUrl: null, sortOrder: null, formerSlugs: [], ...changes };
}

const allRows = (changes: Partial<Record<CategoryRow["category"], Partial<CategoryRow>>> = {}) =>
  CATEGORY_DEFAULTS.map((entry) => row(entry.value, changes[entry.value]));

describe("categoryListFromRows", () => {
  it("is exactly today's list when every detail is empty, and when there are no rows at all", () => {
    for (const list of [categoryListFromRows(allRows()), categoryListFromRows([]), DEFAULT_CATEGORY_LIST]) {
      expect(list.map(({ value, label, slug, image }) => ({ value, label, slug, image }))).toEqual(CATEGORY_DEFAULTS);
      expect(list.map((entry) => entry.order)).toEqual([10, 20, 30, 40, 50, 60]);
      expect(list.every((entry) => entry.sellable && entry.comingSoonText === null && entry.formerSlugs.length === 0)).toBe(true);
    }
  });

  it("lays a row's details over the defaults, and only that row's", () => {
    const list = categoryListFromRows(
      allRows({ KNEE: { label: "Knee and Leg", slug: "knee-leg", imageUrl: "https://example.com/knee.jpg", formerSlugs: ["old-knee"], sellable: false } }),
    );
    const knee = list.find((entry) => entry.value === "KNEE")!;
    expect(knee).toMatchObject({ label: "Knee and Leg", slug: "knee-leg", image: "https://example.com/knee.jpg", formerSlugs: ["old-knee"], sellable: false });
    const hip = list.find((entry) => entry.value === "HIP")!;
    expect(hip).toMatchObject({ label: "Hip", slug: "hip", sellable: true });
  });

  it("sorts by place, keeping the default order for a tie", () => {
    const list = categoryListFromRows(allRows({ FOOT_ANKLE: { sortOrder: 5 }, HIP: { sortOrder: 30 } }));
    // Foot & Ankle first; Hip ties with Knee at 30 and comes after it, as it does by default.
    expect(list.map((entry) => entry.value)).toEqual(["FOOT_ANKLE", "SPINE", "COMPLEX_SPINE", "KNEE", "HIP", "SHOULDER"]);
  });

  it("reads a blank label as the default", () => {
    expect(labelOf(categoryListFromRows(allRows({ KNEE: { label: "   " } })), "KNEE")).toBe("Knee");
  });
});

describe("the name helpers", () => {
  const list = categoryListFromRows(allRows({ KNEE: { label: "Knee and Leg", sortOrder: 1 } }));

  it("say the current name, in the list's order", () => {
    expect(labelOf(list, "KNEE")).toBe("Knee and Leg");
    expect(labelsOf(list).KNEE).toBe("Knee and Leg");
    expect(labelsOf(list).HIP).toBe("Hip");
    expect(labelsInOrder(list, ["HIP", "KNEE"])).toEqual(["Knee and Leg", "Hip"]);
    expect(inListOrder(list, ["HIP", "KNEE", "KNEE"])).toEqual(["KNEE", "HIP"]);
  });

  it("never show nothing for a value the list does not have", () => {
    expect(labelOf([], "KNEE")).toBe("Knee");
    expect(labelOf(list, "ELBOW")).toBe("ELBOW");
  });
});

describe("findCategoryBySlug", () => {
  const list = categoryListFromRows(allRows({ KNEE: { slug: "knee-leg", formerSlugs: ["knee-joint"] } }));

  it("finds the current address", () => {
    expect(findCategoryBySlug(list, "knee-leg")).toMatchObject({ category: { value: "KNEE" }, current: true });
    expect(findCategoryBySlug(list, "hip")).toMatchObject({ category: { value: "HIP" }, current: true });
  });

  it("finds an earlier address, the default included, so the page can redirect it", () => {
    expect(findCategoryBySlug(list, "knee")).toMatchObject({ category: { value: "KNEE" }, current: false });
    expect(findCategoryBySlug(list, "knee-joint")).toMatchObject({ category: { value: "KNEE" }, current: false });
  });

  it("knows nothing of an address no category ever had", () => {
    expect(findCategoryBySlug(list, "elbow")).toBeUndefined();
    expect(findCategoryBySlug(list, "")).toBeUndefined();
  });
});

describe("readCategoryDetails", () => {
  const read = (raw: Partial<{ label: unknown; slug: unknown; imageUrl: unknown; sortOrder: unknown }>) =>
    readCategoryDetails("KNEE", { label: "", slug: "", imageUrl: "", sortOrder: "", ...raw });

  it("reads empty boxes, and boxes holding exactly the default, as the default", () => {
    expect(read({})).toEqual({ ok: true, details: { label: null, slug: null, imageUrl: null, sortOrder: null } });
    const knee = CATEGORY_DEFAULTS.find((entry) => entry.value === "KNEE")!;
    expect(read({ label: " Knee ", slug: "knee", imageUrl: knee.image, sortOrder: String(defaultOrder("KNEE")) })).toEqual({
      ok: true,
      details: { label: null, slug: null, imageUrl: null, sortOrder: null },
    });
  });

  it("keeps a real change, tidied", () => {
    expect(read({ label: "  Knee and Leg ", slug: " knee-leg ", imageUrl: "https://example.com/a.jpg", sortOrder: "15" })).toEqual({
      ok: true,
      details: { label: "Knee and Leg", slug: "knee-leg", imageUrl: "https://example.com/a.jpg", sortOrder: 15 },
    });
  });

  it("takes a name of 40 characters and refuses 41, or more than one line", () => {
    expect(read({ label: "a".repeat(40) }).ok).toBe(true);
    expect(read({ label: "a".repeat(41) })).toMatchObject({ ok: false, error: expect.stringContaining("40") });
    expect(read({ label: "Knee\nLeg" })).toMatchObject({ ok: false, error: "Keep the name on one line." });
    expect(read({ label: "Knee\tLeg" })).toMatchObject({ ok: false });
  });

  it("refuses a web address of the wrong shape, too long, or one that is a page of its own", () => {
    for (const slug of ["Knee", "knee leg", "knee--leg", "-knee", "knee-", "knee_leg", "knée", "knee/leg"]) {
      expect(read({ slug })).toMatchObject({ ok: false });
    }
    expect(read({ slug: "a".repeat(40) }).ok).toBe(true);
    expect(read({ slug: "a".repeat(41) })).toMatchObject({ ok: false });
    expect(read({ slug: "search" })).toMatchObject({ ok: false, error: expect.stringContaining("page of its own") });
    expect(read({ slug: "watch" })).toMatchObject({ ok: false });
  });

  it("takes only an https picture address, the same rule as a logo", () => {
    for (const imageUrl of ["http://example.com/a.jpg", "javascript:alert(1)", "example.com/a.jpg", "https://user:pw@example.com/a.jpg"]) {
      expect(read({ imageUrl })).toMatchObject({ ok: false, error: expect.stringContaining("https://") });
    }
  });

  it("takes a place from 1 to 9999 and nothing else", () => {
    expect(read({ sortOrder: "1" })).toMatchObject({ ok: true, details: { sortOrder: 1 } });
    expect(read({ sortOrder: "9999" })).toMatchObject({ ok: true, details: { sortOrder: 9999 } });
    for (const sortOrder of ["0", "10000", "-5", "1.5", "ten", "1e3"]) {
      expect(read({ sortOrder })).toMatchObject({ ok: false });
    }
  });

  it("treats a box that was not sent at all as empty, and refuses a category we do not have", () => {
    expect(readCategoryDetails("KNEE", { label: null, slug: undefined, imageUrl: 7, sortOrder: null })).toEqual({
      ok: true,
      details: { label: null, slug: null, imageUrl: null, sortOrder: null },
    });
    expect(readCategoryDetails("ELBOW" as never, { label: "", slug: "", imageUrl: "", sortOrder: "" })).toMatchObject({ ok: false });
  });
});

describe("takenSlugs and formerSlugsAfter", () => {
  const list = categoryListFromRows(allRows({ HIP: { slug: "hip-joint", formerSlugs: ["hips"] } }));

  it("keeps every address another category has or had, and none of this category's own", () => {
    const taken = takenSlugs(list, "KNEE");
    for (const slug of ["hip-joint", "hip", "hips", "shoulder", "foot-ankle"]) expect(taken.has(slug)).toBe(true);
    expect(taken.has("knee")).toBe(false);
    expect(takenSlugs(list, "HIP").has("hips")).toBe(false);
  });

  it("remembers the address being left, never the default (which always redirects) or the new one", () => {
    expect(formerSlugsAfter("HIP", { slug: "hip-joint", formerSlugs: ["hips"] }, "hip-and-pelvis")).toEqual(["hips", "hip-joint"]);
    expect(formerSlugsAfter("KNEE", { slug: "knee", formerSlugs: [] }, "knee-leg")).toEqual([]);
    // Going back to an address it had takes it off the earlier list.
    expect(formerSlugsAfter("HIP", { slug: "hip-joint", formerSlugs: ["hips"] }, "hips")).toEqual(["hip-joint"]);
    // No change, nothing new remembered.
    expect(formerSlugsAfter("HIP", { slug: "hip-joint", formerSlugs: ["hips"] }, "hip-joint")).toEqual(["hips"]);
  });
});
