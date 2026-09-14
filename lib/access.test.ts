import { describe, expect, it } from "vitest";
import {
  accessFromClinic,
  accessRefusalMessage,
  categoryState,
  decideVideoAccess,
  inLibraryOrder,
  visibleCount,
  type AccessReason,
  type ClinicAccess,
  type VideoFacts,
} from "./access";

/**
 * The access rule with plain values and no database: which clinic may use
 * which video, in what order the checks run, and which of the four states
 * a library category is in. The database reads that feed it are tested in
 * lib/db/access.test.ts; the write it guards, in lib/db/shares.test.ts.
 */

function access(overrides: Partial<ClinicAccess> = {}): ClinicAccess {
  return { clinicId: "clinic_a", status: "ACTIVE", open: true, categories: ["KNEE"], showPlaceholders: true, ...overrides };
}

function video(overrides: Partial<VideoFacts> = {}): VideoFacts {
  return { category: "KNEE", isPublished: true, isPlaceholder: false, ...overrides };
}

describe("accessFromClinic", () => {
  it("reads open from the status rule, and puts the plan's categories in library order, each once", () => {
    const active = accessFromClinic({ id: "c1", status: "ACTIVE", categories: ["HIP", "KNEE", "HIP", "SPINE"], showPlaceholders: false });
    expect(active).toEqual({ clinicId: "c1", status: "ACTIVE", open: true, categories: ["SPINE", "KNEE", "HIP"], showPlaceholders: false });

    for (const status of ["PENDING", "PAUSED", "PAST_DUE", "CANCELED"] as const) {
      expect(accessFromClinic({ id: "c1", status, categories: ["KNEE"], showPlaceholders: true }).open).toBe(false);
    }
  });

  it("does not read managedByPulse: it is not one of the facts", () => {
    // The type has no such field, so a managed clinic is decided by its status and plan alone.
    const fields = Object.keys(accessFromClinic({ id: "c1", status: "PAUSED", categories: [], showPlaceholders: true }));
    expect(fields).not.toContain("managedByPulse");
  });
});

describe("inLibraryOrder", () => {
  it("orders by the library and drops repeats", () => {
    expect(inLibraryOrder(["FOOT_ANKLE", "KNEE", "COMPLEX_SPINE", "KNEE"])).toEqual(["COMPLEX_SPINE", "KNEE", "FOOT_ANKLE"]);
    expect(inLibraryOrder([])).toEqual([]);
  });
});

describe("decideVideoAccess", () => {
  it("allows a published video in a category on the plan of an open clinic", () => {
    expect(decideVideoAccess(access(), video())).toEqual({ allowed: true });
    expect(decideVideoAccess(access(), video({ isPlaceholder: true }))).toEqual({ allowed: true });
  });

  it("refuses a clinic that is not open, whatever the video, before looking at the video", () => {
    for (const status of ["PENDING", "PAUSED", "PAST_DUE", "CANCELED"] as const) {
      expect(decideVideoAccess(access({ status, open: false }), video())).toEqual({ allowed: false, reason: "clinic-closed" });
    }
    // Even a missing video reads as clinic-closed for a closed clinic: nothing is granted, and nothing is revealed.
    expect(decideVideoAccess(access({ open: false }), null)).toEqual({ allowed: false, reason: "clinic-closed" });
  });

  it("refuses a video that does not exist", () => {
    expect(decideVideoAccess(access(), null)).toEqual({ allowed: false, reason: "no-such-video" });
  });

  it("refuses an unpublished video, even in a category on the plan", () => {
    expect(decideVideoAccess(access(), video({ isPublished: false }))).toEqual({ allowed: false, reason: "unpublished" });
  });

  it("refuses a video whose category is not on the plan, and a clinic with no plan at all", () => {
    expect(decideVideoAccess(access({ categories: ["HIP"] }), video({ category: "KNEE" }))).toEqual({ allowed: false, reason: "not-on-plan" });
    expect(decideVideoAccess(access({ categories: [] }), video())).toEqual({ allowed: false, reason: "not-on-plan" });
  });

  it("refuses a placeholder only when the clinic is shown finished animations only", () => {
    expect(decideVideoAccess(access({ showPlaceholders: false }), video({ isPlaceholder: true }))).toEqual({ allowed: false, reason: "placeholder-hidden" });
    expect(decideVideoAccess(access({ showPlaceholders: false }), video({ isPlaceholder: false }))).toEqual({ allowed: true });
  });

  it("decides the same video differently for two clinics with different plans", () => {
    const knee = video({ category: "KNEE" });
    expect(decideVideoAccess(access({ clinicId: "a", categories: ["KNEE"] }), knee).allowed).toBe(true);
    expect(decideVideoAccess(access({ clinicId: "b", categories: ["HIP"] }), knee).allowed).toBe(false);
  });

  it("runs the checks in the order the reasons are listed, so the first failing one is named", () => {
    // Unpublished and off-plan and hidden: unpublished is named, because it comes first.
    const result = decideVideoAccess(access({ categories: ["HIP"], showPlaceholders: false }), video({ isPublished: false, isPlaceholder: true }));
    expect(result).toEqual({ allowed: false, reason: "unpublished" });
    // Off-plan and hidden: off-plan is named.
    expect(decideVideoAccess(access({ categories: ["HIP"], showPlaceholders: false }), video({ isPlaceholder: true }))).toEqual({
      allowed: false,
      reason: "not-on-plan",
    });
  });
});

describe("accessRefusalMessage", () => {
  it("has a plain sentence for every reason, with nothing technical in it", () => {
    const reasons: AccessReason[] = ["clinic-closed", "no-such-video", "unpublished", "not-on-plan", "placeholder-hidden"];
    for (const reason of reasons) {
      const message = accessRefusalMessage(reason);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/error|invalid|403|401|denied|forbidden/i);
    }
    // The unpublished sentence is the one the admin page has always shown.
    expect(accessRefusalMessage("unpublished")).toBe("That video is not published, so it cannot be shared.");
    expect(accessRefusalMessage("not-on-plan")).toMatch(/plan/);
    expect(accessRefusalMessage("placeholder-hidden")).toMatch(/placeholder/);
  });
});

describe("categoryState", () => {
  it("is coming-soon when nothing is published, whether or not the category is on the plan", () => {
    expect(categoryState(access({ categories: ["KNEE"] }), "KNEE", undefined)).toBe("coming-soon");
    expect(categoryState(access({ categories: ["KNEE"] }), "KNEE", { real: 0, placeholder: 0 })).toBe("coming-soon");
    expect(categoryState(access({ categories: [] }), "HIP", undefined)).toBe("coming-soon");
  });

  it("is locked when something is published but the category is not on the plan", () => {
    expect(categoryState(access({ categories: ["KNEE"] }), "HIP", { real: 1, placeholder: 0 })).toBe("locked");
    expect(categoryState(access({ categories: ["KNEE"] }), "HIP", { real: 0, placeholder: 3 })).toBe("locked");
    expect(categoryState(access({ categories: [] }), "HIP", { real: 0, placeholder: 3 })).toBe("locked");
  });

  it("is empty when the category is on the plan but everything in it is a placeholder the clinic is not shown", () => {
    expect(categoryState(access({ showPlaceholders: false }), "KNEE", { real: 0, placeholder: 3 })).toBe("empty");
  });

  it("is available when the category is on the plan and there is something to show", () => {
    expect(categoryState(access(), "KNEE", { real: 0, placeholder: 3 })).toBe("available");
    expect(categoryState(access({ showPlaceholders: false }), "KNEE", { real: 1, placeholder: 3 })).toBe("available");
    expect(categoryState(access(), "KNEE", { real: 2, placeholder: 0 })).toBe("available");
  });

  it("takes no notice of whether the category is for sale: that is not one of its inputs", () => {
    // A category that has come off sale but is on the plan is still available. There is no sale input to give.
    expect(categoryState(access({ categories: ["SHOULDER"] }), "SHOULDER", { real: 1, placeholder: 0 })).toBe("available");
  });
});

describe("visibleCount", () => {
  it("counts the finished animations, plus the placeholders when the clinic is shown them", () => {
    expect(visibleCount(access(), { real: 2, placeholder: 3 })).toBe(5);
    expect(visibleCount(access({ showPlaceholders: false }), { real: 2, placeholder: 3 })).toBe(2);
    expect(visibleCount(access(), undefined)).toBe(0);
  });
});
