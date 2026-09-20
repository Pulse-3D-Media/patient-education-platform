import { describe, expect, it } from "vitest";
import {
  PENDING_WINDOW_MS,
  checkSeatReduction,
  hasFreeSeat,
  isClerkUserId,
  overAllocatedWords,
  planSeatCheck,
  seatCheckIsEmpty,
  seatCountWords,
  seatStateOf,
  seatSummary,
  seatsFullMessage,
  type SeatMember,
  type SeatRow,
} from "./seats";

/**
 * The surgeon seat rules, with plain values: no database, no Clerk. Every
 * user id here is made up.
 */

const NOW = new Date("2026-09-20T12:00:00Z");
const YOUNG = new Date(NOW.getTime() - 10_000); // reserved ten seconds ago
const OLD = new Date(NOW.getTime() - PENDING_WINDOW_MS - 1_000); // past the window

const member = (userId: string, kind: SeatMember["kind"], joinedAt = 1): SeatMember => ({ userId, kind, joinedAt });
const row = (clerkUserId: string, syncState: SeatRow["syncState"] = "SYNCED", reservedAt = YOUNG): SeatRow => ({ clerkUserId, syncState, reservedAt });

describe("counting seats", () => {
  it("says what is in use, what is free and how far over", () => {
    expect(seatSummary(3, 2)).toEqual({ seats: 3, inUse: 2, free: 1, overBy: 0 });
    expect(seatSummary(3, 3)).toEqual({ seats: 3, inUse: 3, free: 0, overBy: 0 });
    expect(seatSummary(3, 5)).toEqual({ seats: 3, inUse: 5, free: 0, overBy: 2 });
  });

  it("treats a seat count it cannot read as no seats, never as unlimited", () => {
    for (const bad of [null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
      expect(seatSummary(bad, 0).seats).toBe(0);
      expect(hasFreeSeat(seatSummary(bad, 0))).toBe(false);
    }
  });

  it("has a free seat only while fewer are in use than are paid for", () => {
    expect(hasFreeSeat(seatSummary(1, 0))).toBe(true);
    expect(hasFreeSeat(seatSummary(1, 1))).toBe(false);
    expect(hasFreeSeat(seatSummary(0, 0))).toBe(false); // a clinic that has not paid has none
    expect(hasFreeSeat(seatSummary(2, 3))).toBe(false); // over the plan: nobody new
  });

  it("puts the count in words", () => {
    expect(seatCountWords(seatSummary(3, 2))).toBe("2 of 3 surgeon seats in use");
    expect(seatCountWords(seatSummary(1, 1))).toBe("1 of 1 surgeon seat in use");
  });

  it("tells an admin why nobody else can be given a seat, in plain words", () => {
    expect(seatsFullMessage(seatSummary(0, 0))).toContain("Choose a plan on the Billing page");
    expect(seatsFullMessage(seatSummary(3, 3))).toContain("All 3 surgeon seats are in use");
    expect(seatsFullMessage(seatSummary(1, 1))).toContain("All 1 surgeon seat is in use");
    expect(seatsFullMessage(seatSummary(3, 4))).toContain("4 people hold a surgeon seat and your plan pays for 3");
  });
});

describe("a Clerk user id", () => {
  it("is recognised, and anything else is not", () => {
    expect(isClerkUserId("user_2abcDEF123")).toBe(true);
    for (const bad of ["", "org_123", "user_", "user_has space", "user_a'; DROP", 42, null, undefined, `user_${"a".repeat(65)}`]) {
      expect(isClerkUserId(bad)).toBe(false);
    }
  });
});

describe("lowering the seats on a plan", () => {
  it("is allowed down to the number of people holding one, and no further", () => {
    expect(checkSeatReduction(3, 5)).toEqual({ ok: true });
    expect(checkSeatReduction(3, 3)).toEqual({ ok: true });
    expect(checkSeatReduction(0, 0)).toEqual({ ok: true });

    const refused = checkSeatReduction(3, 2);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.short).toBe(1);
      expect(refused.message).toContain("3 people hold a surgeon seat, so the plan needs at least 3 seats");
      expect(refused.message).toContain("Mark a surgeon as Staff");
    }
  });

  it("names how many surgeons have to be marked staff first", () => {
    const refused = checkSeatReduction(5, 2);
    expect(refused.ok === false && refused.message).toContain("Mark 3 surgeons as Staff");
  });

  it("has a sentence for the log only when the plan is below what is in use", () => {
    expect(overAllocatedWords(seatSummary(3, 3))).toBeNull();
    expect(overAllocatedWords(seatSummary(3, 5))).toContain("5 people hold a surgeon seat, 2 more than the 3 the plan now pays for");
    expect(overAllocatedWords(seatSummary(3, 5))).toContain("Nobody was relabelled and no charge was changed");
  });
});

describe("checking the seats against the clinic's people", () => {
  it("finds nothing to do when everyone who holds a seat is a surgeon and nobody is waiting", () => {
    const plan = planSeatCheck({ seats: 2, members: [member("user_a", "surgeon"), member("user_b", "staff")], rows: [row("user_a")], now: NOW });
    expect(seatCheckIsEmpty(plan)).toBe(true);
  });

  it("lets go of the seat of someone who has left the clinic", () => {
    const plan = planSeatCheck({ seats: 2, members: [member("user_a", "surgeon")], rows: [row("user_a"), row("user_gone")], now: NOW });
    expect(plan.release).toEqual([{ userId: "user_gone", reason: "left" }]);
  });

  it("lets go of a confirmed seat whose holder is now marked staff, or has no label", () => {
    const plan = planSeatCheck({
      seats: 3,
      members: [member("user_a", "staff"), member("user_b", null)],
      rows: [row("user_a"), row("user_b")],
      now: NOW,
    });
    expect(plan.release).toEqual([
      { userId: "user_a", reason: "not-surgeon" },
      { userId: "user_b", reason: "not-surgeon" },
    ]);
  });

  it("leaves a reservation alone while it may still be on its way to Clerk, and lets it go once it is stale", () => {
    const members = [member("user_a", null), member("user_b", null)];
    const plan = planSeatCheck({ seats: 3, members, rows: [row("user_a", "PENDING", YOUNG), row("user_b", "PENDING", OLD)], now: NOW });
    expect(plan.release).toEqual([{ userId: "user_b", reason: "stale" }]);
    expect(plan.confirm).toEqual([]);
  });

  it("confirms a reservation once Clerk says surgeon, however old it is", () => {
    const plan = planSeatCheck({ seats: 3, members: [member("user_a", "surgeon")], rows: [row("user_a", "PENDING", OLD)], now: NOW });
    expect(plan.confirm).toEqual(["user_a"]);
    expect(plan.release).toEqual([]);
  });

  it("gives free seats to surgeons who are waiting, oldest member first, and no more than are free", () => {
    const members = [member("user_new", "surgeon", 300), member("user_old", "surgeon", 100), member("user_mid", "surgeon", 200), member("user_seated", "surgeon", 50)];
    const plan = planSeatCheck({ seats: 3, members, rows: [row("user_seated")], now: NOW });
    expect(plan.adopt).toEqual(["user_old", "user_mid"]); // two free seats; user_new keeps waiting
  });

  it("counts a seat that is being let go as free for someone who is waiting", () => {
    const members = [member("user_waiting", "surgeon", 10), member("user_now_staff", "staff", 5)];
    const plan = planSeatCheck({ seats: 1, members, rows: [row("user_now_staff")], now: NOW });
    expect(plan.release).toEqual([{ userId: "user_now_staff", reason: "not-surgeon" }]);
    expect(plan.adopt).toEqual(["user_waiting"]);
  });

  it("counts a reservation that is still in flight as taken, so nobody is given its seat", () => {
    const members = [member("user_inflight", null, 5), member("user_waiting", "surgeon", 10)];
    const plan = planSeatCheck({ seats: 1, members, rows: [row("user_inflight", "PENDING", YOUNG)], now: NOW });
    expect(plan.adopt).toEqual([]);
  });

  it("gives nobody a seat at a clinic that has none, or is over its plan", () => {
    const surgeons = [member("user_a", "surgeon"), member("user_b", "surgeon")];
    expect(planSeatCheck({ seats: 0, members: surgeons, rows: [], now: NOW }).adopt).toEqual([]);
    expect(planSeatCheck({ seats: 1, members: [...surgeons, member("user_c", "surgeon")], rows: [row("user_a"), row("user_b")], now: NOW }).adopt).toEqual([]);
  });

  it("never lets go of a surgeon's seat because the plan is over: that is for people to settle", () => {
    const plan = planSeatCheck({ seats: 1, members: [member("user_a", "surgeon"), member("user_b", "surgeon")], rows: [row("user_a"), row("user_b")], now: NOW });
    expect(seatCheckIsEmpty(plan)).toBe(true);
  });

  it("changes nothing when Clerk returns no people at all, rather than letting every seat go", () => {
    const plan = planSeatCheck({ seats: 2, members: [], rows: [row("user_a"), row("user_b")], now: NOW });
    expect(seatCheckIsEmpty(plan)).toBe(true);
  });

  it("never suggests a change of label: staff stay staff and are never given a seat", () => {
    const plan = planSeatCheck({ seats: 5, members: [member("user_staff", "staff"), member("user_unasked", null)], rows: [], now: NOW });
    expect(seatCheckIsEmpty(plan)).toBe(true);
  });
});

describe("where one person stands", () => {
  it("is worked out from their label and whether they hold a seat", () => {
    const rows = [row("user_held"), row("user_pending", "PENDING")];
    expect(seatStateOf({ userId: "user_held", kind: "surgeon" }, rows)).toBe("held");
    expect(seatStateOf({ userId: "user_waiting", kind: "surgeon" }, rows)).toBe("waiting");
    expect(seatStateOf({ userId: "user_pending", kind: null }, rows)).toBe("pending");
    expect(seatStateOf({ userId: "user_staff", kind: "staff" }, rows)).toBe("none");
    expect(seatStateOf({ userId: "user_unasked", kind: null }, rows)).toBe("none");
  });
});
