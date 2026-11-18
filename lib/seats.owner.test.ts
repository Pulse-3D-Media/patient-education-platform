import { describe, expect, it } from "vitest";
import { OWNER_AUTO_SEAT_WORDS, noSeatHelp, ownerAutoSeatDue, ownerAutoSeatNote, seatSummary } from "./seats";

/**
 * The two plain rules added for a solo owner (decided by the user on
 * 2026-11-16): when the owner is seated automatically, and what the library
 * says to someone without a seat. No database, no Clerk. The database half
 * is lib/db/owner-auto-seat.test.ts.
 */

const due = {
  wasOpenWithSeats: false,
  isOpenWithSeats: true,
  planSeats: 1,
  ownerClerkUserId: "user_vitestowner",
  seated: 0,
  invited: 0,
  doneBefore: false,
};

describe("ownerAutoSeatDue: a solo owner is seated when the clinic opens", () => {
  it("is due when the clinic has just opened with exactly one seat, has an owner, and nobody holds or is invited to it", () => {
    expect(ownerAutoSeatDue(due)).toBe(true);
  });

  it("is not due for each thing that is not so", () => {
    expect(ownerAutoSeatDue({ ...due, wasOpenWithSeats: true }), "already open with seats: not an opening").toBe(false);
    expect(ownerAutoSeatDue({ ...due, isOpenWithSeats: false }), "still closed, or no seats").toBe(false);
    // Only a plan of exactly one seat (limited by the user on 2026-11-18): an owner who buys several keeps choosing.
    for (const planSeats of [0, 2, 3, 10]) expect(ownerAutoSeatDue({ ...due, planSeats }), `${planSeats} seats`).toBe(false);
    expect(ownerAutoSeatDue({ ...due, ownerClerkUserId: null }), "no owner").toBe(false);
    expect(ownerAutoSeatDue({ ...due, ownerClerkUserId: "not a user id" }), "an owner id that is not a Clerk id").toBe(false);
    expect(ownerAutoSeatDue({ ...due, seated: 1 }), "someone holds a seat").toBe(false);
    expect(ownerAutoSeatDue({ ...due, invited: 1 }), "an invitation holds a seat").toBe(false);
    expect(ownerAutoSeatDue({ ...due, doneBefore: true }), "done once already at this clinic").toBe(false);
  });

  it("logs the fixed words the rule looks for, then the count", () => {
    const note = ownerAutoSeatNote(seatSummary(2, 1));
    expect(note.startsWith(OWNER_AUTO_SEAT_WORDS)).toBe(true);
    expect(note).toBe("The account owner was given a seat when the clinic opened, because nobody else holds or is invited to one. Now 1 of 2 seats in use.");
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
