import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SubscriptionSnapshot } from "../billing-state";
import { DEFAULT_PRICING_CONFIG } from "../pricing";
import { OWNER_AUTO_SEAT_WORDS } from "../seats";
import { reconcileSubscription, recordAcceptedPlan, setStripeCustomer } from "./billing";
import * as clinicLock from "./clinic-lock";
import { setClinicPlan, setClinicStatusByStaff } from "./clinics";
import { prisma } from "./client";
import { createPricingVersion } from "./pricing";
import { holdSeatForInvitation, releaseSeat, reserveSeat } from "./seats";

/**
 * The account owner is seated automatically when the clinic opens, against
 * the real test database. Since 2026-11-19 (Evan) the person who signs up
 * takes a seat at any clinic made from now on (Clinic.setupStep set: the
 * "made from now on" tests below); a clinic made before keeps the rule of
 * 2026-11-16/18 (a solo owner on exactly one seat), which the older tests
 * here still prove. The rule is ownerAutoSeatDue() in
 * lib/seats.ts; the write is seatOwnerIfDue() in lib/db/seats.ts, run by
 * both ways a clinic opens: a first confirmed payment (reconcileSubscription)
 * and Pulse staff (changeClinicWithLog: Open by hand, or setting the plan).
 *
 * What these prove: the owner is given a seat once, with one log entry, when
 * the clinic opens with seats and nobody else holds or is invited to one;
 * not when someone else holds a seat or an invitation holds one; not again
 * after the owner gives it up and the clinic opens a second time; nothing
 * without an owner; and two openings at the same moment (forced into the gap
 * between one's lock and its write) seat the owner once. Stripe is a
 * stand-in; everything made here is removed at the end.
 */

vi.mock("./clinic-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clinic-lock")>();
  return { ...actual, readClinicLocked: vi.fn(actual.readClinicLocked) };
});
const real = await vi.importActual<typeof import("./clinic-lock")>("./clinic-lock");

const tag = randomBytes(4).toString("hex");
let serial = 0;
const unique = (prefix: string) => `${prefix}_vitest${tag}${(serial += 1)}`;
const user = () => `user_vitest${randomBytes(6).toString("hex")}`;
const clinicIds: string[] = [];
let pricingVersionId = "";

beforeAll(async () => {
  pricingVersionId = (await createPricingVersion(DEFAULT_PRICING_CONFIG, "Vitest owner auto-seat fixtures. Never active.", { userId: "user_vitest", name: "Vitest" })).id;
});

afterEach(() => {
  vi.mocked(clinicLock.readClinicLocked).mockImplementation(real.readClinicLocked);
});

afterAll(async () => {
  await prisma.clinicNote.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinicBilling.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.billingPlan.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  if (pricingVersionId) await prisma.pricingVersion.deleteMany({ where: { id: pricingVersionId } });
  await prisma.$disconnect();
});

/** A new, unpaid clinic, as /onboarding leaves it: PENDING, no seats, its creator the owner (or none). */
async function newClinic(owner: string | null, surgeonSeats = 0, setupStep: string | null = null) {
  const clinic = await prisma.clinic.create({
    data: { name: `Vitest owner seat ${tag} ${(serial += 1)}`, practiceType: "CLINIC", ownerClerkUserId: owner, surgeonSeats, setupStep },
    select: { id: true },
  });
  clinicIds.push(clinic.id);
  return clinic.id;
}

/** The first card payment for a plan of `seats`, confirmed by the Stripe stand-in. Returns the "look at Stripe" to repeat. */
async function firstPayment(clinicId: string, seats: number) {
  const customerId = unique("cus");
  const subscriptionId = unique("sub");
  await setStripeCustomer(clinicId, customerId);
  const plan = await recordAcceptedPlan(clinicId, {
    pricingVersionId,
    categories: ["KNEE"],
    entitledCategories: ["KNEE"],
    surgeonSeats: seats,
    interval: "MONTH",
    perSeatCents: 8_900,
    totalCents: 8_900 * seats,
    acceptedById: "user_vitest",
    acceptedByName: "Vitest Admin",
  });
  const snapshot: SubscriptionSnapshot = {
    subscriptionId,
    customerId,
    status: "active",
    latestInvoicePaid: true,
    currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
    cancelAt: null,
    planId: plan.id,
  };
  const look = () => reconcileSubscription({ clinicId, subscriptionId, fetchSubscription: async () => snapshot });
  await look();
  return look;
}

async function seatHolders(clinicId: string) {
  return (await prisma.seatAllocation.findMany({ where: { clinicId }, select: { clerkUserId: true } })).map((row) => row.clerkUserId);
}

async function autoSeatNotes(clinicId: string) {
  return prisma.clinicNote.findMany({ where: { clinicId, body: { startsWith: OWNER_AUTO_SEAT_WORDS } }, select: { body: true, authorName: true } });
}

describe("a first confirmed payment", () => {
  it("seats a solo owner, logs it once, and a repeated look at Stripe changes nothing", async () => {
    const owner = user();
    const clinicId = await newClinic(owner);
    const look = await firstPayment(clinicId, 1);

    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true } })).status).toBe("ACTIVE");
    expect(await seatHolders(clinicId)).toEqual([owner]);
    const notes = await autoSeatNotes(clinicId);
    expect(notes).toEqual([{ body: `${OWNER_AUTO_SEAT_WORDS}, because the person who sets up a clinic takes a seat when one is free. Now 1 of 1 seat in use.`, authorName: "seats" }]);

    await look();
    await look();
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });

  it("does NOT seat the owner of a plan of several seats (limited to exactly one seat on 2026-11-18): they choose with Take a seat", async () => {
    const owner = user();
    const clinicId = await newClinic(owner);
    await firstPayment(clinicId, 3);
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true } })).status).toBe("ACTIVE");
    expect(await seatHolders(clinicId)).toEqual([]);
    expect(await autoSeatNotes(clinicId)).toEqual([]);
    // Taking one themselves still works.
    expect((await reserveSeat(clinicId, owner)).held).toBe(true);
  });

  it("does not seat the owner when an invitation already holds a seat", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 1);
    expect((await holdSeatForInvitation(clinicId)).held).toBe(true);
    await firstPayment(clinicId, 1);
    expect(await seatHolders(clinicId)).toEqual([]);
    expect(await autoSeatNotes(clinicId)).toEqual([]);
  });

  it("does not seat the owner when someone else holds the only seat", async () => {
    const owner = user();
    const other = user();
    const clinicId = await newClinic(owner, 1);
    expect((await reserveSeat(clinicId, other)).held).toBe(true);
    await firstPayment(clinicId, 1);
    expect(await seatHolders(clinicId)).toEqual([other]);
    expect(await autoSeatNotes(clinicId)).toEqual([]);
  });

  it("does not seat the owner of a two-seat plan, with someone else holding a seat or not", async () => {
    const owner = user();
    const other = user();
    const clinicId = await newClinic(owner, 2);
    expect((await reserveSeat(clinicId, other)).held).toBe(true);
    await firstPayment(clinicId, 2);
    expect(await seatHolders(clinicId)).toEqual([other]);
  });

  it("seats nobody at a clinic with no account owner", async () => {
    const clinicId = await newClinic(null);
    await firstPayment(clinicId, 1);
    expect(await seatHolders(clinicId)).toEqual([]);
    expect(await autoSeatNotes(clinicId)).toEqual([]);
  });
});

describe("Pulse staff opening a clinic", () => {
  it("plan first, then Open by hand: the owner is seated at the opening", async () => {
    const owner = user();
    const clinicId = await newClinic(owner);
    await setClinicPlan(clinicId, ["KNEE"], 1, "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([]);
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });

  it("Open by hand first, then the plan: the owner is seated when the seats arrive", async () => {
    const owner = user();
    const clinicId = await newClinic(owner);
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([]);
    await setClinicPlan(clinicId, ["KNEE"], 1, "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([owner]);
    // Raising the seats of a clinic that is already open with seats is not an opening.
    await setClinicPlan(clinicId, ["KNEE"], 2, "Vitest Staff");
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });

  it("a clinic Pulse opens with more than one seat (a managed clinic included) is never auto-seated", async () => {
    for (const managedByPulse of [false, true]) {
      const owner = user();
      const clinicId = await newClinic(owner);
      if (managedByPulse) await prisma.clinic.update({ where: { id: clinicId }, data: { managedByPulse: true } });
      await setClinicPlan(clinicId, ["KNEE"], 5, "Vitest Staff");
      await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
      expect(await seatHolders(clinicId), `managed: ${managedByPulse}`).toEqual([]);
      expect(await autoSeatNotes(clinicId)).toEqual([]);
    }
  });

  it("a managed clinic Pulse opens with exactly one seat seats its owner", async () => {
    const owner = user();
    const clinicId = await newClinic(owner);
    await prisma.clinic.update({ where: { id: clinicId }, data: { managedByPulse: true } });
    await setClinicPlan(clinicId, ["KNEE"], 1, "Vitest Staff");
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([owner]);
  });

  it("an owner who gave the seat up is not seated again when the clinic closes and opens again", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 1);
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([owner]);

    await releaseSeat(clinicId, owner);
    await setClinicStatusByStaff(clinicId, "PAUSED", "Vitest: paused.", "Vitest Staff");
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened again.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });
});

describe("a clinic made from now on (it goes through setup): the person who signs up takes a seat", () => {
  it("seats the owner of a three-seat plan at the first payment, once: you and 2 more", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 0, "clinic");
    const look = await firstPayment(clinicId, 3);
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect((await autoSeatNotes(clinicId)).map((note) => note.body)).toEqual([
      `${OWNER_AUTO_SEAT_WORDS}, because the person who sets up a clinic takes a seat when one is free. Now 1 of 3 seats in use.`,
    ]);
    await look();
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });

  it("seats the owner in a free seat beside others who already hold or were invited to one", async () => {
    const owner = user();
    const other = user();
    const clinicId = await newClinic(owner, 3, "clinic");
    expect((await reserveSeat(clinicId, other)).held).toBe(true);
    expect((await holdSeatForInvitation(clinicId)).held).toBe(true);
    await firstPayment(clinicId, 3);
    expect((await seatHolders(clinicId)).sort()).toEqual([owner, other].sort());
    expect(await prisma.seatInvitation.count({ where: { clinicId } })).toBe(1);
  });

  it("never takes a seat someone holds or was invited to: with every seat taken the owner is not seated, and nothing breaks", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 2, "clinic");
    expect((await reserveSeat(clinicId, user())).held).toBe(true);
    expect((await holdSeatForInvitation(clinicId)).held).toBe(true);
    await firstPayment(clinicId, 2);
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { status: true } })).status).toBe("ACTIVE");
    expect(await seatHolders(clinicId)).not.toContain(owner);
    expect(await autoSeatNotes(clinicId)).toEqual([]);
  });

  it("Pulse staff opening a new clinic with five seats seats its owner", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 0, "finished");
    await setClinicPlan(clinicId, ["KNEE"], 5, "Vitest Staff");
    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    expect(await seatHolders(clinicId)).toEqual([owner]);
  });

  it("the last seat taken by an invitation at the same moment as the opening: one of them gets it, never both", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 0, "clinic");
    // Two seats, one already held, so exactly one is left for the owner or the invitation.
    await setClinicPlan(clinicId, ["KNEE"], 2, "Vitest Staff");
    expect((await reserveSeat(clinicId, user())).held).toBe(true);

    let hold: Promise<Awaited<ReturnType<typeof holdSeatForInvitation>>> | null = null;
    let holdFinishedDuringWait = false;
    // The opening takes the clinic's lock; before it writes, the invitation reaches for the last seat on another connection.
    vi.mocked(clinicLock.readClinicLocked).mockImplementationOnce((async (tx: Prisma.TransactionClient, id: string, select: Prisma.ClinicSelect) => {
      const row = await real.readClinicLocked(tx, id, select);
      let done = false;
      hold = holdSeatForInvitation(clinicId).then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      holdFinishedDuringWait = done;
      return row;
    }) as typeof real.readClinicLocked);

    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff");
    const held = await (hold as unknown as Promise<Awaited<ReturnType<typeof holdSeatForInvitation>>>);

    expect(holdFinishedDuringWait, "the invitation waited for the opening's lock").toBe(false);
    // The opening got there first, so the owner has the last seat and the invitation was refused.
    expect(await seatHolders(clinicId)).toContain(owner);
    expect(held.held).toBe(false);
    const inUse = (await prisma.seatAllocation.count({ where: { clinicId } })) + (await prisma.seatInvitation.count({ where: { clinicId } }));
    expect(inUse).toBe(2);
  });

  it("the same race left to run freely never puts the clinic over its seats", async () => {
    for (let round = 0; round < 3; round++) {
      const owner = user();
      const clinicId = await newClinic(owner, 0, "clinic");
      await setClinicPlan(clinicId, ["KNEE"], 2, "Vitest Staff");
      expect((await reserveSeat(clinicId, user())).held).toBe(true);
      const [, held] = await Promise.all([setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff"), holdSeatForInvitation(clinicId)]);
      const ownerSeated = (await seatHolders(clinicId)).includes(owner);
      expect(ownerSeated !== held.held, `round ${round}: exactly one of them got the last seat`).toBe(true);
      const inUse = (await prisma.seatAllocation.count({ where: { clinicId } })) + (await prisma.seatInvitation.count({ where: { clinicId } }));
      expect(inUse).toBe(2);
    }
  });
});

describe("two openings at the same moment", () => {
  /** How long the first opening holds the clinic's lock while the second tries to get through. */
  const WAIT_MS = 2000;

  it("the second waits for the first, finds the clinic already open, and the owner holds one seat with one log entry", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 1);
    let second: Promise<unknown> | null = null;
    let secondFinishedDuringWait = false;

    // The first opening takes the clinic's lock, then, before it writes anything, the second starts on
    // another connection. The first holds still for a while so the second has every chance to get through.
    vi.mocked(clinicLock.readClinicLocked).mockImplementationOnce((async (tx: Prisma.TransactionClient, id: string, select: Prisma.ClinicSelect) => {
      const row = await real.readClinicLocked(tx, id, select);
      let done = false;
      second = setClinicStatusByStaff(clinicId, "OPEN", "Vitest: the second opening.", "Vitest Staff B").then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      secondFinishedDuringWait = done;
      return row;
    }) as typeof real.readClinicLocked);

    await setClinicStatusByStaff(clinicId, "OPEN", "Vitest: the first opening.", "Vitest Staff A");
    await second;

    expect(secondFinishedDuringWait).toBe(false);
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });

  it("a first payment and Pulse staff opening at once seat the owner once", async () => {
    const owner = user();
    const clinicId = await newClinic(owner, 1);
    await Promise.all([firstPayment(clinicId, 1), setClinicStatusByStaff(clinicId, "OPEN", "Vitest: opened by hand.", "Vitest Staff")]);
    expect(await seatHolders(clinicId)).toEqual([owner]);
    expect(await autoSeatNotes(clinicId)).toHaveLength(1);
  });
});
