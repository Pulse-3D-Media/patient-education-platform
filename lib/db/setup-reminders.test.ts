import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { daysAfter } from "../setup-reminders";
import * as clinicLock from "./clinic-lock";
import { prisma } from "./client";
import { claimSetupReminder, listClinicsDueSetupReminder } from "./setup-reminders";

/**
 * The reminder record, against the real test database: the list the daily
 * job reads, and the claim that decides and records under the clinic's lock.
 * "Now" is in 2031, so the clinics other test files leave behind (made today)
 * are never in any window.
 */

vi.mock("./clinic-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clinic-lock")>();
  return { ...actual, readClinicLocked: vi.fn(actual.readClinicLocked) };
});
const real = await vi.importActual<typeof import("./clinic-lock")>("./clinic-lock");

const NOW = new Date("2031-03-10T15:20:00.000Z");
const LIST_NOW = new Date("2031-09-10T15:20:00.000Z");
const clinicIds: string[] = [];

/** A clinic that signed up `daysAgo` days before NOW, open and part-way through setup unless told otherwise. */
async function clinic(daysAgo: number, data: Partial<Prisma.ClinicUncheckedCreateInput> = {}, now: Date = NOW) {
  const row = await prisma.clinic.create({
    data: {
      name: "Vitest reminder clinic",
      clerkOrgId: `org_vitestremind${randomBytes(8).toString("hex")}`,
      ownerClerkUserId: "user_vitestowner",
      status: "ACTIVE",
      setupStep: "branding",
      setupDone: ["clinic"],
      createdAt: daysAfter(now, -daysAgo),
      ...data,
    },
    select: { id: true },
  });
  clinicIds.push(row.id);
  return row.id;
}

const stored = (id: string) => prisma.clinic.findUniqueOrThrow({ where: { id }, select: { setupReminder: true, setupReminderAt: true } });

afterEach(() => {
  vi.mocked(clinicLock.readClinicLocked).mockImplementation(real.readClinicLocked);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.$disconnect();
});

describe("claiming a reminder", () => {
  it("records reminder 1 a day after sign-up, and a second claim the same day gets nothing", async () => {
    const id = await clinic(1);
    expect(await stored(id)).toEqual({ setupReminder: 0, setupReminderAt: null });
    expect(await claimSetupReminder(id, NOW)).toMatchObject({ reminder: 1, progress: { current: "branding", doneCount: 1 } });
    expect(await stored(id)).toEqual({ setupReminder: 1, setupReminderAt: NOW });
    expect(await claimSetupReminder(id, NOW)).toBeNull();
    expect(await claimSetupReminder(id, daysAfter(NOW, 2))).toBeNull();
  });

  it("goes 1, 2, 3 at a day, a week and two weeks, and a fourth run claims nothing", async () => {
    const signedUp = daysAfter(NOW, -1);
    const id = await clinic(1);
    expect((await claimSetupReminder(id, NOW))?.reminder).toBe(1);
    expect(await claimSetupReminder(id, daysAfter(signedUp, 7 - 0.001))).toBeNull();
    expect((await claimSetupReminder(id, daysAfter(signedUp, 7)))?.reminder).toBe(2);
    expect(await claimSetupReminder(id, daysAfter(signedUp, 14 - 0.001))).toBeNull();
    expect((await claimSetupReminder(id, daysAfter(signedUp, 14)))?.reminder).toBe(3);
    for (const day of [14.5, 15, 20, 40]) expect(await claimSetupReminder(id, daysAfter(signedUp, day))).toBeNull();
    expect((await stored(id)).setupReminder).toBe(3);
  });

  it("a missed week gives one reminder, the newest", async () => {
    const id = await clinic(9);
    expect((await claimSetupReminder(id, NOW))?.reminder).toBe(2);
    expect(await claimSetupReminder(id, NOW)).toBeNull();
  });

  it("never for a finished clinic, one made before setup, or a closed one, and nothing is written", async () => {
    const ids = [
      await clinic(2, { setupStep: "finished", setupDone: ["clinic", "branding", "team", "test"] }),
      await clinic(2, { setupStep: null, setupDone: [] }),
      await clinic(2, { status: "PENDING" }),
      await clinic(2, { status: "PAUSED" }),
      await clinic(2, { status: "CANCELED" }),
      await clinic(2, { status: "PAST_DUE", graceEndsAt: daysAfter(NOW, 3) }),
      await clinic(2, { ownerClerkUserId: null }),
    ];
    for (const id of ids) {
      expect(await claimSetupReminder(id, NOW)).toBeNull();
      expect(await stored(id)).toEqual({ setupReminder: 0, setupReminderAt: null });
    }
  });

  it("two runs claiming at the same moment (the second forced into the first's lock) record one reminder, once", async () => {
    const id = await clinic(1);
    let second: Promise<unknown> | null = null;
    let secondFinishedDuringWait = false;
    vi.mocked(clinicLock.readClinicLocked).mockImplementationOnce((async (tx: Prisma.TransactionClient, clinicId: string, select: Prisma.ClinicSelect) => {
      const row = await real.readClinicLocked(tx, clinicId, select);
      let done = false;
      second = claimSetupReminder(id, NOW).then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      secondFinishedDuringWait = done;
      return row;
    }) as typeof real.readClinicLocked);

    const first = await claimSetupReminder(id, NOW);
    const secondResult = await second;
    expect(secondFinishedDuringWait, "the second claim waited for the first").toBe(false);
    expect(first?.reminder).toBe(1);
    expect(secondResult).toBeNull();
    expect((await stored(id)).setupReminder).toBe(1);
  });
});

describe("the daily list", () => {
  it("holds exactly the clinics due now, oldest first, and respects the limit", async () => {
    // A "now" of its own, so the clinics the tests above made are in no window.
    const NOW = LIST_NOW;
    const at = (daysAgo: number, data: Partial<Prisma.ClinicUncheckedCreateInput> = {}) => clinic(daysAgo, data, NOW);
    const due1 = await at(1.5);
    const due2 = await at(8);
    const due3 = await at(15);
    const alreadySent = await at(3, { setupReminder: 1 });
    const tooEarly = await at(0.5);
    const tooLate = await at(22);
    const finished = await at(2, { setupStep: "finished" });
    const pending = await at(2, { status: "PENDING" });
    const noOwner = await at(2, { ownerClerkUserId: null });
    const old = await at(2, { setupStep: null });

    const listed = (await listClinicsDueSetupReminder(NOW, 50)).map((row) => row.id);
    expect(listed).toEqual([due3, due2, due1]);
    for (const id of [alreadySent, tooEarly, tooLate, finished, pending, noOwner, old]) expect(listed).not.toContain(id);

    expect((await listClinicsDueSetupReminder(NOW, 2)).map((row) => row.id)).toEqual([due3, due2]);
    // Rows handed back carry what is needed to find the owner, and no name.
    expect(Object.keys((await listClinicsDueSetupReminder(NOW, 1))[0]).sort()).toEqual(["clerkOrgId", "id", "ownerClerkUserId"]);
  });
});
