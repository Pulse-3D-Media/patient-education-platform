import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as clinicLock from "./clinic-lock";
import { prisma } from "./client";
import { updateClinicBranding } from "./clinics";
import { listNotesForClinic } from "./notes";

/**
 * The forced overlap for the clinic log: two people save a change to the
 * same clinic at the same moment. Branding made this a real case, because
 * Pulse staff (on /pulse) and the clinic's own admin (on /admin/branding)
 * can now both save to one clinic.
 *
 * Every change writes a sentence saying what the value WAS and what it
 * became. If a second save lands between the first save's read of "what it
 * was" and its write, the first save's sentence describes a value that was
 * already gone, and then overwrites the second save without anyone being
 * told. changeClinicWithLog() prevents that by locking the clinic's row as
 * it reads (readClinicLocked in lib/db/clinic-lock.ts), so the second save
 * has to wait until the first has committed.
 *
 * How the overlap is forced: readClinicLocked is wrapped for one call, save
 * A's. The wrapper does A's read, then starts save B on another connection,
 * waits far longer than an unblocked save needs, notes whether B finished,
 * and only then lets A carry on to its write. So B arrives exactly in the
 * gap between A's read and A's write.
 *
 *   With the lock:  B cannot finish during the wait. It runs after A has
 *                   committed, reads A's value, and both log entries are
 *                   true.
 *   The control:    the same overlap with a plain read and no lock. B gets
 *                   through in the gap, and A then logs "changed from red"
 *                   over a row that was already blue. That is the bug,
 *                   shown on purpose: it proves this test would notice if
 *                   the lock were ever removed.
 */

vi.mock("./clinic-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clinic-lock")>();
  // The real function stays the default; one test at a time swaps in a wrapper.
  return { ...actual, readClinicLocked: vi.fn(actual.readClinicLocked) };
});

const real = await vi.importActual<typeof import("./clinic-lock")>("./clinic-lock");

/** How long save A holds still, after its read, while save B tries to get through. A save that is not blocked finishes in tens of milliseconds. */
const WAIT_MS = 600;

const RED = "#aa0000";
const GREEN = "#00aa00";
const BLUE = "#0000aa";

const createdClinicIds: string[] = [];

async function makeClinic() {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest log race clinic ${randomBytes(4).toString("hex")}`, status: "ACTIVE", brandColor: RED },
    select: { id: true },
  });
  createdClinicIds.push(clinic.id);
  return clinic.id;
}

afterEach(() => {
  vi.mocked(clinicLock.readClinicLocked).mockImplementation(real.readClinicLocked);
});

afterAll(async () => {
  await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
  await prisma.$disconnect();
});

/** The same read as readClinicLocked, without the lock. What the code did before, and what the control uses. */
async function readWithoutLock(tx: Prisma.TransactionClient, clinicId: string, select: Prisma.ClinicSelect) {
  return tx.clinic.findUnique({ where: { id: clinicId }, select });
}

/**
 * Save A (red to green, and dark to light) and, between A's read and A's
 * write, save B (to blue, in dark). `read` is how A reads: the real locking read, or the plain one for
 * the control. Returns whether B had already finished by the time A went
 * on to write.
 */
async function saveBothAtOnce(clinicId: string, read: (tx: Prisma.TransactionClient, id: string, select: Prisma.ClinicSelect) => Promise<unknown>) {
  let otherFinishedDuringWait = false;
  let other: Promise<unknown> = Promise.resolve();

  vi.mocked(clinicLock.readClinicLocked).mockImplementationOnce((async (tx: Prisma.TransactionClient, id: string, select: Prisma.ClinicSelect) => {
    const before = await read(tx, id, select);
    let done = false;
    // Save B always uses the real locking read: the wrapper is for one call only.
    other = updateClinicBranding(clinicId, { phone: null, brandColor: BLUE, brandFont: null, brandTheme: null }, "Staff B").then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    otherFinishedDuringWait = done;
    return before;
  }) as never);

  await updateClinicBranding(clinicId, { phone: null, brandColor: GREEN, brandFont: null, brandTheme: "light" }, "Admin A");
  await other;
  return otherFinishedDuringWait;
}

/** The log, oldest first, as "who: what". */
async function logOf(clinicId: string) {
  const notes = await listNotesForClinic(clinicId); // newest first
  return notes.map((note) => `${note.authorName}: ${note.body}`).reverse();
}

describe("two saves to one clinic at the same moment", () => {
  it("the second waits for the first, and each log entry describes the value that was really there", async () => {
    const clinicId = await makeClinic();

    const otherFinishedDuringWait = await saveBothAtOnce(clinicId, real.readClinicLocked);

    // B could not get through while A held the row.
    expect(otherFinishedDuringWait).toBe(false);

    // A went first (red to green, dark to light). B then read A's green and A's light, and changed those.
    expect(await logOf(clinicId)).toEqual([
      `Admin A: Branding changed: colour changed from ${RED} to ${GREEN}; mode changed from Dark to Light.`,
      `Staff B: Branding changed: colour changed from ${GREEN} to ${BLUE}; mode changed from Light to Dark.`,
    ]);

    // The last save won, and the log's last line agrees with the row.
    const row = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { brandColor: true, brandTheme: true } });
    expect(row).toEqual({ brandColor: BLUE, brandTheme: null });
  });

  it("control: without the lock, the second save slips into the gap and the first one logs a value that was already gone", async () => {
    const clinicId = await makeClinic();

    const otherFinishedDuringWait = await saveBothAtOnce(clinicId, readWithoutLock);

    // B got through between A's read and A's write...
    expect(otherFinishedDuringWait).toBe(true);

    // ...so the row went red, blue, green. But A had read red before B wrote, and says so:
    // its entry claims "changed from red" over a row that was blue, and B's change is
    // overwritten with nothing in the log to show it happened in between.
    const log = await logOf(clinicId);
    expect(log).toContain(`Staff B: Branding changed: colour changed from ${RED} to ${BLUE}.`);
    expect(log).toContain(`Admin A: Branding changed: colour changed from ${RED} to ${GREEN}; mode changed from Dark to Light.`);

    const row = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { brandColor: true, brandTheme: true } });
    expect(row).toEqual({ brandColor: GREEN, brandTheme: "light" });
  });
});
