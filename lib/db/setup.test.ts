import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as clinicLock from "./clinic-lock";
import { prisma } from "./client";
import { upsertClinicForClerkOrg } from "./clinics";
import { getSetupProgress, recordSetupStep } from "./setup";

/**
 * Saved setup progress, against the real test database: a clinic made from
 * now on starts on step 1, a clinic made before is left out, a save moves
 * on and is safe to repeat, and two admins saving at once (one forced into
 * the other's lock) both land and nothing is lost or moved back.
 */

vi.mock("./clinic-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clinic-lock")>();
  return { ...actual, readClinicLocked: vi.fn(actual.readClinicLocked) };
});
const real = await vi.importActual<typeof import("./clinic-lock")>("./clinic-lock");

const clinicIds: string[] = [];

/** A clinic as a new sign-up makes it: through the Clerk sync, which starts setup. */
async function newClinic() {
  const clinic = await upsertClinicForClerkOrg(`org_vitestsetup${randomBytes(8).toString("hex")}`, { name: "Vitest setup clinic", logoUrl: null });
  clinicIds.push(clinic.id);
  return clinic.id;
}

afterEach(() => {
  vi.mocked(clinicLock.readClinicLocked).mockImplementation(real.readClinicLocked);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.$disconnect();
});

describe("setup progress", () => {
  it("a clinic made from now on starts on step 1", async () => {
    const clinicId = await newClinic();
    expect(await getSetupProgress(clinicId)).toMatchObject({ current: "clinic", doneCount: 0, finished: false });
  });

  it("a clinic made before setup existed is not going through it, and a save writes nothing", async () => {
    const clinic = await prisma.clinic.create({ data: { name: "Vitest setup old clinic" }, select: { id: true } });
    clinicIds.push(clinic.id);
    expect(await getSetupProgress(clinic.id)).toBeNull();
    expect(await recordSetupStep(clinic.id, "clinic", "done")).toBeNull();
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id }, select: { setupStep: true, setupDone: true } })).toEqual({ setupStep: null, setupDone: [] });
  });

  it("moves on step by step, keeps skipped steps as Later, and finishes", async () => {
    const clinicId = await newClinic();
    await recordSetupStep(clinicId, "clinic", "done");
    await recordSetupStep(clinicId, "branding", "skipped");
    expect(await getSetupProgress(clinicId)).toMatchObject({ current: "team", doneCount: 1 });
    await recordSetupStep(clinicId, "team", "done");
    const end = await recordSetupStep(clinicId, "test", "done");
    expect(end).toMatchObject({ finished: true, doneCount: 3 });
    expect(end?.steps.find((step) => step.key === "branding")?.state).toBe("later");
    // "Add it now" from the finished page: done, still finished.
    expect(await recordSetupStep(clinicId, "branding", "done")).toMatchObject({ finished: true, doneCount: 4 });
  });

  it("the same save twice ends where the first did", async () => {
    const clinicId = await newClinic();
    await recordSetupStep(clinicId, "clinic", "done");
    await recordSetupStep(clinicId, "clinic", "done");
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { setupStep: true, setupDone: true } })).toEqual({ setupStep: "branding", setupDone: ["clinic"] });
  });

  it("two saves of one step at the same moment (the second forced into the first's lock) give one step done, once", async () => {
    const clinicId = await newClinic();
    let second: Promise<unknown> | null = null;
    let secondFinishedDuringWait = false;
    vi.mocked(clinicLock.readClinicLocked).mockImplementationOnce((async (tx: Prisma.TransactionClient, id: string, select: Prisma.ClinicSelect) => {
      const row = await real.readClinicLocked(tx, id, select);
      let done = false;
      second = recordSetupStep(clinicId, "clinic", "done").then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      secondFinishedDuringWait = done;
      return row;
    }) as typeof real.readClinicLocked);

    await recordSetupStep(clinicId, "clinic", "done");
    await second;
    expect(secondFinishedDuringWait, "the second save waited for the first").toBe(false);
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { setupStep: true, setupDone: true } })).toEqual({ setupStep: "branding", setupDone: ["clinic"] });
  });

  it("two admins saving different steps at once keep both, and the one further on decides where setup stands", async () => {
    const clinicId = await newClinic();
    await recordSetupStep(clinicId, "clinic", "done");
    await recordSetupStep(clinicId, "branding", "skipped");
    await Promise.all([recordSetupStep(clinicId, "team", "done"), recordSetupStep(clinicId, "branding", "done")]);
    expect(await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { setupStep: true, setupDone: true } })).toEqual({
      setupStep: "test",
      setupDone: ["clinic", "branding", "team"],
    });
  });
});
