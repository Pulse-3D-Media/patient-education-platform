import { describe, expect, it } from "vitest";
import { OWNER_AUTO_SEAT_WORDS, noSeatHelp, ownerAutoSeatDue, ownerAutoSeatNote, seatSummary } from "./seats";

/**
 * The plain rules about the account owner's seat: when the owner is seated
 * automatically (the person who signs up takes a seat, decided by Evan on
 * 2026-11-19; clinics made before keep the one-seat rule of 2026-11-16/18),
 * and what the library says to someone without a seat. No database, no
 * Clerk. The database half is lib/db/owner-auto-seat.test.ts.
 */

/** A clinic made from now on, opening with three seats and nobody seated. */
const due = {
  wasOpenWithSeats: false,
  isOpenWithSeats: true,
  planSeats: 3,
  ownerClerkUserId: "user_vitestowner",
  ownerSeated: false,
  seated: 0,
  invited: 0,
  doneBefore: false,
  newClinic: true,
};

describe("ownerAutoSeatDue: the person who signs up takes a seat when the clinic opens", () => {
  it("is due for a new clinic of any size with a seat free", () => {
    for (const planSeats of [1, 2, 3, 10]) expect(ownerAutoSeatDue({ ...due, planSeats }), `${planSeats} seats`).toBe(true);
    expect(ownerAutoSeatDue({ ...due, seated: 1, invited: 1 }), "two of three taken by others: the third is free").toBe(true);
  });

  it("never takes a seat someone holds or was invited to", () => {
    expect(ownerAutoSeatDue({ ...due, seated: 3 }), "all held").toBe(false);
    expect(ownerAutoSeatDue({ ...due, invited: 3 }), "all held by invitations").toBe(false);
    expect(ownerAutoSeatDue({ ...due, seated: 2, invited: 1 }), "all taken, people and invitations together").toBe(false);
    expect(ownerAutoSeatDue({ ...due, planSeats: 1, invited: 1 }), "the one seat is invited").toBe(false);
  });

  it("leaves clinics made before setup existed on the old rule: exactly one seat, nobody else", () => {
    const old = { ...due, newClinic: false };
    expect(ownerAutoSeatDue({ ...old, planSeats: 1 })).toBe(true);
    for (const planSeats of [2, 3, 10]) expect(ownerAutoSeatDue({ ...old, planSeats }), `${planSeats} seats, made before`).toBe(false);
    expect(ownerAutoSeatDue({ ...old, planSeats: 1, seated: 1 }), "someone holds the one seat").toBe(false);
  });

  it("is not due for each other thing that is not so", () => {
    expect(ownerAutoSeatDue({ ...due, wasOpenWithSeats: true }), "already open with seats: not an opening").toBe(false);
    expect(ownerAutoSeatDue({ ...due, isOpenWithSeats: false }), "still closed, or no seats").toBe(false);
    expect(ownerAutoSeatDue({ ...due, planSeats: 0 }), "no seats on the plan").toBe(false);
    expect(ownerAutoSeatDue({ ...due, ownerClerkUserId: null }), "no owner").toBe(false);
    expect(ownerAutoSeatDue({ ...due, ownerClerkUserId: "not a user id" }), "an owner id that is not a Clerk id").toBe(false);
    expect(ownerAutoSeatDue({ ...due, ownerSeated: true, seated: 1 }), "the owner holds a seat already").toBe(false);
    expect(ownerAutoSeatDue({ ...due, doneBefore: true }), "done once already at this clinic").toBe(false);
  });

  it("logs the fixed words the rule looks for, then the count", () => {
    const note = ownerAutoSeatNote(seatSummary(3, 1));
    expect(note.startsWith(OWNER_AUTO_SEAT_WORDS)).toBe(true);
    expect(note).toBe("The account owner was given a seat when the clinic opened, because the person who sets up a clinic takes a seat when one is free. Now 1 of 3 seats in use.");
  });
});

describe("noSeatHelp: what the library says to someone without a seat", () => {
  it("offers the owner Take a seat when one is free", () => {
    expect(noSeatHelp({ isOwner: true, isAdmin: true, seatFree: true })).toBe("take");
  });

  it("sends an admin, the owner with no seat free included, to People: they are the office admin", () => {
    expect(noSeatHelp({ isOwner: true, isAdmin: true, seatFree: false })).toBe("people");
    expect(noSeatHelp({ isOwner: false, isAdmin: true, seatFree: true })).toBe("people");
    expect(noSeatHelp({ isOwner: false, isAdmin: true, seatFree: false })).toBe("people");
  });

  it("tells a member to ask an office admin, seat free or not", () => {
    expect(noSeatHelp({ isOwner: false, isAdmin: false, seatFree: true })).toBe("ask");
    expect(noSeatHelp({ isOwner: false, isAdmin: false, seatFree: false })).toBe("ask");
  });
});
