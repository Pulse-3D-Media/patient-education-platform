import { describe, expect, it } from "vitest";
import { SETUP_FINISHED_HREF, hrefAfterSave, nextSetupState, readSetupProgress, setupIsDue, setupLeftWords, stepAfter, stepBefore, stepIsOpen } from "./setup";

/** The setup rules (lib/setup.ts). Pure: no database. The writes are tested in lib/db/setup.test.ts. */

describe("readSetupProgress", () => {
  it("reads a clinic made before setup existed (nothing stored) as not going through setup, so it is never reminded", () => {
    expect(readSetupProgress(null, [])).toBeNull();
    expect(setupIsDue(readSetupProgress(null, []))).toBe(false);
  });

  it("a brand-new clinic is on step 1 with nothing done", () => {
    const progress = readSetupProgress("clinic", []);
    expect(progress).toMatchObject({ current: "clinic", finished: false, doneCount: 0, total: 4 });
    expect(progress?.steps.map((step) => step.state)).toEqual(["current", "ahead", "ahead", "ahead"]);
    expect(setupIsDue(progress)).toBe(true);
  });

  it("marks a skipped step Later and a completed one Done, as drawn (06-setup-resume)", () => {
    const progress = readSetupProgress("team", ["clinic"]);
    expect(progress?.steps.map((step) => step.state)).toEqual(["done", "later", "current", "ahead"]);
    expect(progress?.doneCount).toBe(1);
  });

  it("is finished at the end, with skipped steps still Later", () => {
    const progress = readSetupProgress("finished", ["clinic", "team", "test"]);
    expect(progress).toMatchObject({ current: null, finished: true, doneCount: 3 });
    expect(progress?.steps.map((step) => step.state)).toEqual(["done", "later", "done", "done"]);
    expect(setupIsDue(progress)).toBe(false);
  });

  it("reads a damaged value as finished, and ignores unknown done steps, so nobody is nagged by a bad row", () => {
    expect(readSetupProgress("somewhere", ["nonsense"])).toMatchObject({ finished: true, doneCount: 0 });
  });
});

describe("nextSetupState", () => {
  it("moves on one step, adding the step to done only when it was completed", () => {
    expect(nextSetupState({ setupStep: "clinic", setupDone: [] }, "clinic", "done")).toEqual({ setupStep: "branding", setupDone: ["clinic"] });
    expect(nextSetupState({ setupStep: "branding", setupDone: ["clinic"] }, "branding", "skipped")).toEqual({ setupStep: "team", setupDone: ["clinic"] });
    expect(nextSetupState({ setupStep: "test", setupDone: [] }, "test", "done")).toEqual({ setupStep: "finished", setupDone: ["test"] });
  });

  it("is the same when repeated (a double press, a retry)", () => {
    const once = nextSetupState({ setupStep: "clinic", setupDone: [] }, "clinic", "done");
    expect(once && nextSetupState(once, "clinic", "done")).toEqual(once);
  });

  it("never moves back: a step saved again from the finished page keeps setup finished, and adds it to done", () => {
    expect(nextSetupState({ setupStep: "finished", setupDone: ["clinic"] }, "branding", "done")).toEqual({ setupStep: "finished", setupDone: ["clinic", "branding"] });
    // Two admins: one already on step 3, the other saving step 1. Step 3 stays.
    expect(nextSetupState({ setupStep: "team", setupDone: [] }, "clinic", "done")).toEqual({ setupStep: "team", setupDone: ["clinic"] });
  });

  it("skipping never takes a completed step out of done", () => {
    expect(nextSetupState({ setupStep: "branding", setupDone: ["clinic"] }, "clinic", "skipped")).toEqual({ setupStep: "branding", setupDone: ["clinic"] });
  });

  it("writes nothing for a clinic not going through setup", () => {
    expect(nextSetupState({ setupStep: null, setupDone: [] }, "clinic", "done")).toBeNull();
  });
});

describe("the step order and addresses", () => {
  it("knows the steps around each step", () => {
    expect(stepAfter("clinic")).toBe("branding");
    expect(stepAfter("test")).toBe("finished");
    expect(stepBefore("clinic")).toBeNull();
    expect(stepBefore("team")).toBe("branding");
  });

  it("sends an admin to the stored step, or to the library with the welcome dialog once setup is behind the clinic", () => {
    expect(hrefAfterSave("team")).toBe("/onboarding/setup/team");
    // Evan, 2026-11-20: no full "You're ready for patients." page any more.
    expect(SETUP_FINISHED_HREF).toBe("/library?welcome=setup");
    expect(hrefAfterSave("finished")).toBe(SETUP_FINISHED_HREF);
    expect(hrefAfterSave(null)).toBe(SETUP_FINISHED_HREF);
  });
});

describe("which steps the progress list opens (Evan, 2026-11-20)", () => {
  it("opens every step reached and the one after the step the clinic is on, and no further", () => {
    const atBranding = readSetupProgress("branding", ["clinic"])!;
    expect(stepIsOpen(atBranding, "clinic")).toBe(true);
    expect(stepIsOpen(atBranding, "branding")).toBe(true);
    expect(stepIsOpen(atBranding, "team")).toBe(true);
    expect(stepIsOpen(atBranding, "test")).toBe(false);

    const atStart = readSetupProgress("clinic", [])!;
    expect(stepIsOpen(atStart, "clinic")).toBe(true);
    expect(stepIsOpen(atStart, "branding")).toBe(true);
    expect(stepIsOpen(atStart, "team")).toBe(false);
  });

  it("opens a skipped step, and every step once setup is finished", () => {
    const skippedOne = readSetupProgress("test", ["clinic", "team"])!;
    expect(stepIsOpen(skippedOne, "branding")).toBe(true);
    const finished = readSetupProgress("finished", ["clinic"])!;
    for (const step of ["clinic", "branding", "team", "test"] as const) expect(stepIsOpen(finished, step)).toBe(true);
  });
});

describe("what the welcome dialog names as left for later", () => {
  it("names each skipped step in a few words, in order, and nothing when all are done", () => {
    expect(setupLeftWords(readSetupProgress("finished", ["clinic", "team"])!)).toEqual(["your logo", "a test link"]);
    expect(setupLeftWords(readSetupProgress("finished", ["clinic", "branding", "team", "test"])!)).toEqual([]);
  });
});

describe("setupReminder: the library's reminder (decided 2026-11-19, after Evan's walkthrough)", () => {
  it("says Finish setup with the count while the steps are under way", async () => {
    const { setupReminder } = await import("./setup");
    expect(setupReminder(readSetupProgress("team", ["clinic"]))).toEqual({ title: "Finish setup", href: "/onboarding/setup", doneCount: 1, total: 4 });
  });

  it("once the steps are passed, names what is left and opens that step", async () => {
    const { setupReminder } = await import("./setup");
    expect(setupReminder(readSetupProgress("finished", ["clinic", "team", "test"]))).toEqual({ title: "Add your logo", href: "/onboarding/setup/branding", doneCount: 3, total: 4 });
    expect(setupReminder(readSetupProgress("finished", ["branding", "test"]))?.title).toBe("Add your clinic's name");
  });

  it("goes away only when nothing is left undone, and never shows for a clinic made before setup", async () => {
    const { setupReminder } = await import("./setup");
    expect(setupReminder(readSetupProgress("finished", ["clinic", "branding", "team", "test"]))).toBeNull();
    expect(setupReminder(readSetupProgress(null, []))).toBeNull();
  });

  it("leaves setupIsDue (which the reminder emails read) about the steps being under way", () => {
    expect(setupIsDue(readSetupProgress("finished", ["clinic"]))).toBe(false);
  });
});
