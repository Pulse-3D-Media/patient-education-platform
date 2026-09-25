import { describe, expect, it } from "vitest";
import {
  PENDING_WINDOW_MS,
  checkSeatReduction,
  hasFreeSeat,
  holdIdFromMetadata,
  isClerkUserId,
  overAllocatedWords,
  planSeatCheck,
  seatCheckIsEmpty,
  seatCountWords,
  seatStateOf,
  seatSummary,
  seatsFullMessage,
  type HoldRow,
  type InvitationFacts,
  type SeatMember,
  type SeatRow,
} from "./seats";

/**
 * The seat rules, with plain values: no database, no Clerk. Every id here is
 * made up.
 */

const NOW = new Date("2026-09-24T12:00:00Z");
const YOUNG = new Date(NOW.getTime() - 10_000); // ten seconds ago
const OLD = new Date(NOW.getTime() - PENDING_WINDOW_MS - 1_000); // past the window

const OWNER = "user_owner";
const member = (userId: string, joinedAt = 1, seatHoldId: string | null = null): SeatMember => ({ userId, joinedAt, seatHoldId });
const row = (clerkUserId: string, syncState: SeatRow["syncState"] = "SYNCED"): SeatRow => ({ clerkUserId, syncState, reservedAt: YOUNG });
const hold = (id: string, clerkInvitationId: string | null = null, reservedAt = YOUNG): HoldRow => ({ id, clerkInvitationId, reservedAt });
const NO_INVITES: InvitationFacts = { pending: [], closed: [] };

/** planSeatCheck with the usual defaults. */
function plan(input: { seats: number; members: SeatMember[]; rows?: SeatRow[]; holds?: HoldRow[]; invitations?: InvitationFacts | null; owner?: string | null }) {
  return planSeatCheck({
    seats: input.seats,
    ownerUserId: input.owner === undefined ? OWNER : input.owner,
    members: input.members,
    rows: input.rows ?? [],
    holds: input.holds ?? [],
    invitations: input.invitations === undefined ? NO_INVITES : input.invitations,
    now: NOW,
  });
}

describe("counting seats", () => {
  it("counts people and open invitations together against the plan", () => {
    expect(seatSummary(3, 2)).toEqual({ seats: 3, seated: 2, invited: 0, inUse: 2, free: 1, overBy: 0 });
    expect(seatSummary(3, 2, 1)).toEqual({ seats: 3, seated: 2, invited: 1, inUse: 3, free: 0, overBy: 0 });
    expect(seatSummary(3, 4, 1)).toEqual({ seats: 3, seated: 4, invited: 1, inUse: 5, free: 0, overBy: 2 });
  });

  it("treats a seat count it cannot read as no seats, never as unlimited", () => {
    for (const bad of [null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
      expect(seatSummary(bad, 0).seats).toBe(0);
      expect(hasFreeSeat(seatSummary(bad, 0))).toBe(false);
    }
  });

  it("has a free seat only while fewer are taken than are paid for, and an invitation takes one", () => {
    expect(hasFreeSeat(seatSummary(1, 0))).toBe(true);
    expect(hasFreeSeat(seatSummary(1, 1))).toBe(false);
    expect(hasFreeSeat(seatSummary(1, 0, 1))).toBe(false); // the one seat is held by an invitation
    expect(hasFreeSeat(seatSummary(0, 0))).toBe(false); // a clinic that has not paid has none
    expect(hasFreeSeat(seatSummary(2, 3))).toBe(false); // over the plan: nobody new
  });

  it("puts the count in words", () => {
    expect(seatCountWords(seatSummary(3, 2))).toBe("2 of 3 seats in use");
    expect(seatCountWords(seatSummary(1, 1))).toBe("1 of 1 seat in use");
    expect(seatCountWords(seatSummary(3, 1, 1))).toBe("2 of 3 seats in use (1 by an invitation)");
    expect(seatCountWords(seatSummary(5, 1, 2))).toBe("3 of 5 seats in use (2 by invitations)");
  });

  it("tells an admin why nobody else can be given a seat, in plain words", () => {
    expect(seatsFullMessage(seatSummary(0, 0))).toContain("Choose a plan on the Billing page");
    expect(seatsFullMessage(seatSummary(3, 3))).toContain("All 3 seats are taken");
    expect(seatsFullMessage(seatSummary(1, 1))).toContain("All 1 seat is taken");
    expect(seatsFullMessage(seatSummary(3, 3))).toContain("Revoke an invitation or remove someone");
    expect(seatsFullMessage(seatSummary(3, 4))).toContain("4 seats are taken and your plan pays for 3");
  });
});

describe("ids", () => {
  it("a Clerk user id is recognised, and anything else is not", () => {
    expect(isClerkUserId("user_2abcDEF123")).toBe(true);
    for (const bad of ["", "org_123", "user_", "user_has space", "user_a'; DROP", 42, null, undefined, `user_${"a".repeat(65)}`]) {
      expect(isClerkUserId(bad)).toBe(false);
    }
  });

  it("a hold id is only read out of metadata when it looks like one of ours", () => {
    expect(holdIdFromMetadata({ seatHold: "clz1abc2def3ghi4jkl5mno6p" })).toBe("clz1abc2def3ghi4jkl5mno6p");
    for (const bad of [null, undefined, {}, { seatHold: 42 }, { seatHold: "" }, { seatHold: "has space in it" }, { seatHold: "DROP TABLE;" }, { kind: "surgeon" }]) {
      expect(holdIdFromMetadata(bad as Record<string, unknown> | null)).toBeNull();
    }
  });
});

describe("lowering the seats on a plan", () => {
  it("is allowed down to the number of seats taken, and no further", () => {
    expect(checkSeatReduction(3, 5)).toEqual({ ok: true });
    expect(checkSeatReduction(3, 3)).toEqual({ ok: true });
    expect(checkSeatReduction(0, 0)).toEqual({ ok: true });

    const refused = checkSeatReduction(3, 2);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.short).toBe(1);
      expect(refused.message).toContain("3 seats are taken, so the plan needs at least 3 seats");
      expect(refused.message).toContain("Remove someone or revoke an invitation");
    }
  });

  it("names how many have to go first", () => {
    const refused = checkSeatReduction(5, 2);
    expect(refused.ok === false && refused.message).toContain("Remove 3 people or revoke invitations");
  });

  it("has a sentence for the log only when the plan is below what is taken", () => {
    expect(overAllocatedWords(seatSummary(3, 3))).toBeNull();
    expect(overAllocatedWords(seatSummary(3, 5))).toContain("5 seats are taken, 2 more than the 3 the plan now pays for");
    expect(overAllocatedWords(seatSummary(3, 5))).toContain("Nobody was removed and no charge was changed");
  });
});

describe("checking the seats against the clinic's people", () => {
  it("changes nothing when everyone who needs a seat has one", () => {
    const result = plan({ seats: 2, members: [member(OWNER), member("user_a"), member("user_b")], rows: [row("user_a"), row("user_b")] });
    expect(seatCheckIsEmpty(result)).toBe(true);
  });

  it("never gives the account owner a seat: the owner takes one only by choice", () => {
    const result = plan({ seats: 3, members: [member(OWNER, 0), member("user_a", 1)] });
    expect(result.adopt).toEqual(["user_a"]);
  });

  it("gives free seats to the people waiting, oldest member first, and never more than are free", () => {
    const result = plan({ seats: 2, members: [member(OWNER), member("user_late", 30), member("user_first", 10), member("user_second", 20)] });
    expect(result.adopt).toEqual(["user_first", "user_second"]);
  });

  it("gives nobody a seat while the clinic has none (it has not paid)", () => {
    expect(plan({ seats: 0, members: [member(OWNER), member("user_a")] }).adopt).toEqual([]);
  });

  it("lets go the seat of someone who has left", () => {
    const result = plan({ seats: 2, members: [member(OWNER), member("user_here")], rows: [row("user_here"), row("user_gone")] });
    expect(result.release).toEqual(["user_gone"]);
  });

  it("treats an empty member list as Clerk not answering, and changes nothing at all", () => {
    const result = plan({ seats: 2, members: [], rows: [row("user_a")], holds: [hold("holdone00001", null, OLD)] });
    expect(seatCheckIsEmpty(result)).toBe(true);
  });

  it("confirms seats the earlier model left unconfirmed, as housekeeping only", () => {
    expect(plan({ seats: 1, members: [member(OWNER), member("user_a")], rows: [row("user_a", "PENDING")] }).confirm).toEqual(["user_a"]);
  });

  it("turns an accepted invitation into its person's seat, without counting it twice", () => {
    const result = plan({
      seats: 2,
      members: [member(OWNER), member("user_old", 1), member("user_new", 99, "holdnew00001")],
      holds: [hold("holdnew00001", "orginv_1")],
    });
    expect(result.convert).toEqual([{ holdId: "holdnew00001", userId: "user_new" }]);
    // The newcomer's seat came from their invitation, so the one seat left goes to the older person waiting.
    expect(result.adopt).toEqual(["user_old"]);
  });

  it("does not hand an invitation's seat to someone else who is waiting", () => {
    // One seat, held by an open invitation. An older member waiting for a seat does not get it.
    const result = plan({ seats: 1, members: [member(OWNER), member("user_waiting", 1)], holds: [hold("holdopen0001", "orginv_1")], invitations: { pending: [{ id: "orginv_1", seatHoldId: "holdopen0001" }], closed: [] } });
    expect(result.adopt).toEqual([]);
    expect(result.dropHolds).toEqual([]);
  });

  it("lets a hold go when Clerk says its invitation was revoked or expired, and only then", () => {
    const facts = { pending: [{ id: "orginv_open", seatHoldId: "holdopen0001" }], closed: ["orginv_closed"] };
    const result = plan({ seats: 3, members: [member(OWNER)], holds: [hold("holdopen0001", "orginv_open"), hold("holdclosed01", "orginv_closed")], invitations: facts });
    expect(result.dropHolds).toEqual([{ holdId: "holdclosed01", reason: "closed" }]);
  });

  it("keeps every hold when the invitations could not be read", () => {
    const result = plan({ seats: 3, members: [member(OWNER)], holds: [hold("holdclosed01", "orginv_closed"), hold("holdnever001", null, OLD)], invitations: null });
    expect(result.dropHolds).toEqual([]);
  });

  it("records the invitation a hold belongs to, found by the hold id it carries", () => {
    const result = plan({ seats: 2, members: [member(OWNER)], holds: [hold("holdlink0001", null, OLD)], invitations: { pending: [{ id: "orginv_9", seatHoldId: "holdlink0001" }], closed: [] } });
    expect(result.link).toEqual([{ holdId: "holdlink0001", invitationId: "orginv_9" }]);
    expect(result.dropHolds).toEqual([]);
  });

  it("lets go a hold Clerk never made an invitation for, but only after the window", () => {
    expect(plan({ seats: 2, members: [member(OWNER)], holds: [hold("holdyoung001", null, YOUNG)] }).dropHolds).toEqual([]);
    expect(plan({ seats: 2, members: [member(OWNER)], holds: [hold("holdold00001", null, OLD)] }).dropHolds).toEqual([{ holdId: "holdold00001", reason: "never-made" }]);
  });

  it("lets a hold go, rather than giving a second seat, when its person already holds one", () => {
    const result = plan({ seats: 3, members: [member(OWNER), member("user_a", 1, "holddupe0001")], rows: [row("user_a")], holds: [hold("holddupe0001", "orginv_1")] });
    expect(result.dropHolds).toEqual([{ holdId: "holddupe0001", reason: "already-seated" }]);
    expect(result.convert).toEqual([]);
  });

  it("says when the account owner is no longer in the clinic", () => {
    expect(plan({ seats: 1, members: [member("user_a")] }).ownerLeft).toBe(true);
    expect(plan({ seats: 1, members: [member(OWNER)] }).ownerLeft).toBe(false);
    expect(plan({ seats: 1, members: [member("user_a")], owner: null }).ownerLeft).toBe(false); // no owner on record: nothing to clear
  });

  it("with no owner on record, everyone needs a seat", () => {
    expect(plan({ seats: 5, members: [member("user_creator", 0), member("user_a", 1)], owner: null }).adopt).toEqual(["user_creator", "user_a"]);
  });
});

describe("where one person stands", () => {
  it("holds a seat, waits for one, or is the owner without one", () => {
    const rows = [row("user_held"), row(OWNER)];
    expect(seatStateOf("user_held", rows, OWNER)).toBe("held");
    expect(seatStateOf("user_waiting", rows, OWNER)).toBe("waiting");
    expect(seatStateOf(OWNER, rows, OWNER)).toBe("held"); // an owner who took a seat
    expect(seatStateOf(OWNER, [], OWNER)).toBe("none");
    expect(seatStateOf("user_creator", [], null)).toBe("waiting"); // no owner on record
  });
});
