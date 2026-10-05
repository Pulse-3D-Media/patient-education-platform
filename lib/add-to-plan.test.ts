import type { Category } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { addToPlanHref, addToPlanOffer, readSuggestedCategory } from "./add-to-plan";
import type { CategoryAvailability } from "./categories";

/**
 * The rules behind the library's "Add to your plan" link, with plain values:
 * who is shown the link, and what the Billing page makes of the suggestion
 * in its address (which is untrusted, like anything a browser sends).
 */

const options = (
  [
    ["SPINE", "sellable"],
    ["COMPLEX_SPINE", "coming-soon"],
    ["KNEE", "sellable"],
    ["SHOULDER", "sellable"],
    ["HIP", "sellable"],
    ["FOOT_ANKLE", "not-for-sale"],
  ] as [Category, CategoryAvailability][]
).map(([value, availability]) => ({ value, availability }));

describe("addToPlanOffer", () => {
  it("gives an office admin the link and tells a member to ask, for a category that is for sale", () => {
    expect(addToPlanOffer(true, { sellable: true, comingSoonText: null })).toBe("link");
    expect(addToPlanOffer(false, { sellable: true, comingSoonText: null })).toBe("ask");
  });

  it("offers nothing, to anyone, for a category that is not for sale", () => {
    expect(addToPlanOffer(true, { sellable: false, comingSoonText: null })).toBe("none");
    expect(addToPlanOffer(false, { sellable: false, comingSoonText: null })).toBe("none");
  });

  it("treats a category with no row as for sale, the table's own default", () => {
    expect(addToPlanOffer(true, undefined)).toBe("link");
    expect(addToPlanOffer(false, undefined)).toBe("ask");
  });
});

describe("addToPlanHref", () => {
  it("is the Billing page with the category's slug as a suggestion, landing on the plan form", () => {
    expect(addToPlanHref("hip")).toBe("/admin/billing?add=hip#change");
    expect(addToPlanHref("foot-ankle")).toBe("/admin/billing?add=foot-ankle#change");
  });
});

describe("readSuggestedCategory", () => {
  it("reads a known slug of a category that is for sale and not on the plan", () => {
    expect(readSuggestedCategory("shoulder", options, ["KNEE", "HIP"])).toBe("SHOULDER");
    expect(readSuggestedCategory("orthopedic-spine", options, [])).toBe("SPINE");
  });

  it("ignores a category the clinic already has", () => {
    expect(readSuggestedCategory("knee", options, ["KNEE", "HIP"])).toBeNull();
  });

  it("ignores a category that cannot be bought right now", () => {
    expect(readSuggestedCategory("foot-ankle", options, [])).toBeNull();
    expect(readSuggestedCategory("complex-spine", options, [])).toBeNull();
    // A category the page was given no option for at all.
    expect(readSuggestedCategory("hip", [], [])).toBeNull();
  });

  it("ignores anything that is not exactly one known slug", () => {
    for (const forged of ["elbow", "", "HIP", "Hip", "hip ", "hip,knee", "../hip", "<script>", "__proto__", "constructor"]) {
      expect(readSuggestedCategory(forged, options, [])).toBeNull();
    }
    // The same name given twice arrives as a list; a missing one as undefined.
    expect(readSuggestedCategory(["hip", "knee"], options, [])).toBeNull();
    expect(readSuggestedCategory(undefined, options, [])).toBeNull();
    expect(readSuggestedCategory(null, options, [])).toBeNull();
    expect(readSuggestedCategory(7, options, [])).toBeNull();
  });
});
