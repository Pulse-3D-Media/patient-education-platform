/**
 * The setup steps a new clinic's office admins go through after the first
 * payment (the approved design, screens 04 and 06-setup-resume; four steps,
 * decided by Evan on 2026-11-19). Pure: no database, no Clerk, safe for the
 * browser. lib/db/setup.ts does the writes.
 *
 *   1. Clinic name     the real name (replacing the provisional one made at
 *                      sign-up) and the phone patients can call.
 *   2. Branding        logo and colour only.
 *   3. Your team       one invitation box per seat nobody holds yet.
 *   4. Test link       pick a procedure, then "Generate QR code".
 *
 * Every step can be skipped ("Skip for now"). Pressing a step's Continue
 * (or Finish) counts it as done, with whatever was saved; skipping is the
 * only thing that leaves a step undone, apart from a logo upload that failed
 * (decided 2026-11-19 after Evan's walkthrough). Where a clinic stands is kept
 * on its row, so whoever leaves comes back to the step they were on
 * ("Welcome back."), and any admin of the clinic sees the same place.
 *
 * HOW IT IS STORED (Clinic.setupStep and Clinic.setupDone):
 *
 *   setupStep   the step to come back to, or "finished". EMPTY means the
 *               clinic was made before setup existed: it counts as set up, so
 *               no clinic that was already open is ever asked to set up or
 *               shown the "Finish setup" reminder. A clinic gets "clinic"
 *               when its row is first made (lib/db/clinics.ts).
 *   setupDone   the steps that were completed. A step behind setupStep that
 *               is not in it was skipped, and is shown as "Later".
 *
 * Both only ever move forward: going Back is just a link, and saving a step
 * never moves setupStep back. So a save repeated (a double press, a retry)
 * or two admins saving at once always end in the same place.
 */

export const SETUP_STEPS = [
  { key: "clinic", label: "Clinic name" },
  { key: "branding", label: "Branding" },
  { key: "team", label: "Your team" },
  { key: "test", label: "Test link" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

/** The stored value once the last step is behind the clinic. */
export const SETUP_FINISHED = "finished";

/** What a brand-new clinic's row starts with. */
export const SETUP_START: SetupStepKey = "clinic";

/** Where setup lives. The address of one step is SETUP_PATH/<step>. */
export const SETUP_PATH = "/onboarding/setup";
export const SETUP_DONE_PATH = `${SETUP_PATH}/done`;

export function isSetupStep(value: unknown): value is SetupStepKey {
  return typeof value === "string" && SETUP_STEPS.some((step) => step.key === value);
}

export function setupStepHref(step: SetupStepKey): string {
  return `${SETUP_PATH}/${step}`;
}

/** 0 for the first step, 4 for "finished", -1 for anything not understood. */
function position(stored: string | null): number {
  if (stored === SETUP_FINISHED) return SETUP_STEPS.length;
  return SETUP_STEPS.findIndex((step) => step.key === stored);
}

/** One step as the progress list shows it. */
export type SetupStepState = "done" | "later" | "current" | "ahead";

/** Where one clinic's setup stands, worked out from the two stored values. */
export type SetupProgress = {
  /** The step to come back to, or null once setup is finished. */
  current: SetupStepKey | null;
  finished: boolean;
  /** How many steps were completed (not skipped). "1 of 4" in the list, "0 of 4 done" in the library. */
  doneCount: number;
  total: number;
  steps: { key: SetupStepKey; label: string; state: SetupStepState }[];
};

/**
 * Read the stored values. Null when the clinic is not going through setup
 * at all (setupStep empty: made before setup existed). A stored value that
 * is not understood counts as finished, so a damaged row never nags anyone.
 */
export function readSetupProgress(setupStep: string | null | undefined, setupDone: readonly string[] | null | undefined): SetupProgress | null {
  if (setupStep === null || setupStep === undefined) return null;
  const at = position(setupStep);
  const reached = at === -1 ? SETUP_STEPS.length : at;
  const done = new Set((setupDone ?? []).filter(isSetupStep));
  const steps = SETUP_STEPS.map((step, index) => {
    const state: SetupStepState = done.has(step.key) ? "done" : index < reached ? "later" : index === reached ? "current" : "ahead";
    return { key: step.key, label: step.label, state };
  });
  const finished = reached >= SETUP_STEPS.length;
  return {
    current: finished ? null : SETUP_STEPS[reached].key,
    finished,
    doneCount: steps.filter((step) => step.state === "done").length,
    total: SETUP_STEPS.length,
    steps,
  };
}

/** Should the admins of this clinic see the "Finish setup" reminder? Only while setup is under way. */
export function setupIsDue(progress: SetupProgress | null): progress is SetupProgress & { finished: false } {
  return progress !== null && !progress.finished;
}

/** The step after `step`, or "finished" after the last one. */
export function stepAfter(step: SetupStepKey): SetupStepKey | typeof SETUP_FINISHED {
  const index = position(step);
  return index + 1 < SETUP_STEPS.length ? SETUP_STEPS[index + 1].key : SETUP_FINISHED;
}

/** The step before `step`, for the Back link, or null on the first. */
export function stepBefore(step: SetupStepKey): SetupStepKey | null {
  const index = position(step);
  return index > 0 ? SETUP_STEPS[index - 1].key : null;
}

/**
 * What to store after one step was completed or skipped, given what is
 * stored now. Never moves backwards: a step saved again from the finished
 * page ("Add it now") keeps the clinic finished, and of two admins saving
 * different steps at once, the one further on wins. Completing adds the step
 * to setupDone once; skipping never takes a completed step out of it.
 *
 * Returns null when the clinic is not going through setup (setupStep empty),
 * so nothing is written for it.
 */
export function nextSetupState(
  stored: { setupStep: string | null; setupDone: readonly string[] },
  step: SetupStepKey,
  outcome: "done" | "skipped",
): { setupStep: string; setupDone: string[] } | null {
  if (stored.setupStep === null) return null;
  const now = position(stored.setupStep);
  const after = stepAfter(step);
  // A stored value not understood counts as finished (readSetupProgress reads it that way too).
  const setupStep = now === -1 ? SETUP_FINISHED : position(after) > now ? after : stored.setupStep;
  const done = stored.setupDone.filter(isSetupStep);
  const withStep = outcome === "done" && !done.includes(step) ? [...done, step] : done;
  // Kept in step order, so the stored list reads the same however the steps were saved.
  const setupDone = SETUP_STEPS.map((s) => s.key).filter((key) => withStep.includes(key));
  return { setupStep, setupDone };
}

/** Where to send an admin after a step: the next step while setup is under way, else the finished page. */
export function hrefAfterSave(setupStep: string | null): string {
  return isSetupStep(setupStep) ? setupStepHref(setupStep) : SETUP_DONE_PATH;
}

/** What the library's reminder says for a step left undone once the steps are behind the clinic (Evan, 2026-11-19). */
export const SETUP_STEP_TODO: Record<SetupStepKey, string> = {
  clinic: "Add your clinic's name",
  branding: "Add your logo",
  team: "Invite your team",
  test: "Try a test link",
};

/** The reminder in the library's menu: its words, where it opens, and the count. */
export type SetupReminder = { title: string; href: string; doneCount: number; total: number };

/**
 * The library's "Finish setup" reminder for an office admin, or null when
 * there is nothing left (decided 2026-11-19, after Evan's walkthrough).
 *
 * A step counts as done when the admin pressed its Continue (or Finish), with
 * whatever was saved; "Skip for now" is the only thing that leaves a step
 * undone (and a logo upload that failed, which leaves branding undone).
 *
 *   - while the steps are under way: "Finish setup", "1 of 4 done", opening
 *     setup at the step the clinic is on, as drawn;
 *   - once the last step is passed with something left undone: the first
 *     thing left, named ("Add your logo"), opening that step;
 *   - nothing left undone: no reminder.
 *
 * This is wider than setupIsDue() above, which is about the steps still being
 * under way, and which the reminder emails read; those stop once the steps
 * are behind the clinic, even with something skipped.
 */
export function setupReminder(progress: SetupProgress | null): SetupReminder | null {
  if (!progress || progress.doneCount >= progress.total) return null;
  const counts = { doneCount: progress.doneCount, total: progress.total };
  if (!progress.finished) return { title: "Finish setup", href: SETUP_PATH, ...counts };
  const left = progress.steps.find((step) => step.state !== "done");
  return left ? { title: SETUP_STEP_TODO[left.key], href: setupStepHref(left.key), ...counts } : null;
}
