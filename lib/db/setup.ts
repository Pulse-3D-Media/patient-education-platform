import { nextSetupState, readSetupProgress, type SetupProgress, type SetupStepKey } from "../setup";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";

/**
 * Where one clinic's setup stands, and the one write that moves it on
 * (Clinic.setupStep and Clinic.setupDone; the rules are lib/setup.ts).
 *
 * Every function takes the clinic id first (rule 1), and that id always comes
 * from the server's own check of who is signed in, never from the browser.
 *
 * No log entry is written for setup itself: it records only where the admins
 * are in the steps. What each step changes (the name, the branding, the
 * invitations, the test link) is written and logged by the code that always
 * changes those things.
 */

/** Where this clinic's setup stands, or null when it is not going through setup (made before setup existed). Throws for an unknown id. */
export async function getSetupProgress(clinicId: string): Promise<SetupProgress | null> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { setupStep: true, setupDone: true } });
  if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
  return readSetupProgress(clinic.setupStep, clinic.setupDone);
}

/**
 * Record that one step was completed ("done") or skipped, and move the
 * clinic on. Returns where setup stands afterwards (null for a clinic not
 * going through setup, for which nothing is written).
 *
 * Read, decide and write are one transaction holding the clinic's row lock
 * (the lock every change to a clinic takes), so two admins saving at the
 * same moment take turns, and the second decides from what the first wrote.
 * nextSetupState() never moves backwards and adds a step to the done list at
 * most once, so a repeated save (a double press, a retry, a second tab) ends
 * exactly where the first one did, and a save that changes nothing writes
 * nothing.
 */
export async function recordSetupStep(clinicId: string, step: SetupStepKey, outcome: "done" | "skipped"): Promise<SetupProgress | null> {
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { setupStep: true, setupDone: true });
    if (!clinic) throw new Error(`No clinic has the id "${clinicId}".`);
    const next = nextSetupState({ setupStep: clinic.setupStep, setupDone: clinic.setupDone ?? [] }, step, outcome);
    if (!next) return null;
    const unchanged = next.setupStep === clinic.setupStep && next.setupDone.join() === (clinic.setupDone ?? []).join();
    if (!unchanged) await tx.clinic.update({ where: { id: clinicId }, data: next, select: { id: true } });
    return readSetupProgress(next.setupStep, next.setupDone);
  });
}
