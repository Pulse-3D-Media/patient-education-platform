import { describe, expect, it } from "vitest";
import {
  addDays,
  canClaimFirstPlay,
  DAY_MS,
  daysLeftText,
  expiryAfterFirstPlay,
  isExpired,
  resolveShareTerms,
  shareExpiryState,
  type ShareExpiryFacts,
} from "./expiry";

/**
 * The expiry rule with plain values: which links a play may move, where
 * the deadline goes, where the line between working and expired is drawn,
 * and how the settings and a clinic's override become the numbers a new
 * link carries. No database; lib/db/shares.expiry.test.ts proves the same
 * rule against real rows.
 */

/** A fixed moment, so every expectation is a number that can be checked by hand. */
const T = new Date("2026-09-14T15:00:00.000Z");

function facts(over: Partial<ShareExpiryFacts> = {}): ShareExpiryFacts {
  return { expiryPolicy: "FIRST_PLAY", expiresAt: addDays(T, 90), firstPlayedAt: null, daysAfterFirstPlay: 7, ...over };
}

describe("resolveShareTerms", () => {
  const platform = { unclaimedDays: 90, viewDays: 7 };

  it("uses the platform numbers when the clinic has no override: 90 and 7 by default", () => {
    expect(resolveShareTerms(platform, { viewDaysOverride: null })).toEqual({ unclaimedDays: 90, daysAfterFirstPlay: 7 });
  });

  it("lets the clinic's own number replace the days after the first play, and only that", () => {
    expect(resolveShareTerms(platform, { viewDaysOverride: 10 })).toEqual({ unclaimedDays: 90, daysAfterFirstPlay: 10 });
  });

  it("gives a later settings edit to links made after it, because the numbers are copied at creation", () => {
    const before = resolveShareTerms(platform, { viewDaysOverride: null });
    const after = resolveShareTerms({ unclaimedDays: 60, viewDays: 3 }, { viewDaysOverride: null });
    expect(before).toEqual({ unclaimedDays: 90, daysAfterFirstPlay: 7 });
    expect(after).toEqual({ unclaimedDays: 60, daysAfterFirstPlay: 3 });
  });
});

describe("addDays", () => {
  it("counts elapsed 24-hour days, not calendar days", () => {
    expect(DAY_MS).toBe(86_400_000);
    expect(addDays(T, 7).getTime()).toBe(T.getTime() + 7 * 86_400_000);
    expect(addDays(T, 0).getTime()).toBe(T.getTime());
    expect(addDays(T, -30).getTime()).toBe(T.getTime() - 30 * 86_400_000);
  });
});

describe("isExpired", () => {
  it("is false one millisecond before the deadline, true at the deadline itself, and true after", () => {
    const share = { expiresAt: T };
    expect(isExpired(share, new Date(T.getTime() - 1))).toBe(false);
    expect(isExpired(share, T)).toBe(true);
    expect(isExpired(share, new Date(T.getTime() + 1))).toBe(true);
  });
});

describe("canClaimFirstPlay", () => {
  it("is true only for a first-play link that has never been played and carries its number of days", () => {
    expect(canClaimFirstPlay(facts())).toBe(true);
  });

  it("is false for a legacy (FIXED) link, played or not: the policy decides, never the view count", () => {
    expect(canClaimFirstPlay(facts({ expiryPolicy: "FIXED", daysAfterFirstPlay: null }))).toBe(false);
    expect(canClaimFirstPlay(facts({ expiryPolicy: "FIXED", daysAfterFirstPlay: 7 }))).toBe(false);
  });

  it("is false once the link has been played", () => {
    expect(canClaimFirstPlay(facts({ firstPlayedAt: T }))).toBe(false);
  });

  it("is false for a first-play link with no number copied onto it, which then behaves as fixed", () => {
    expect(canClaimFirstPlay(facts({ daysAfterFirstPlay: null }))).toBe(false);
  });
});

describe("expiryAfterFirstPlay", () => {
  it("is the moment of the play plus the days copied onto the link, even past the unclaimed deadline", () => {
    const unclaimedUntil = addDays(T, 1);
    const playedAt = new Date(unclaimedUntil.getTime() - 1000);
    const moved = expiryAfterFirstPlay({ daysAfterFirstPlay: 7 }, playedAt);
    expect(moved.getTime()).toBe(playedAt.getTime() + 7 * DAY_MS);
    expect(moved.getTime()).toBeGreaterThan(unclaimedUntil.getTime());
  });
});

describe("shareExpiryState", () => {
  it("is expired at or past the deadline, whatever the policy", () => {
    expect(shareExpiryState(facts({ expiresAt: T }), T)).toEqual({ kind: "expired", expiresAt: T });
    expect(shareExpiryState(facts({ expiryPolicy: "FIXED", daysAfterFirstPlay: null, expiresAt: T }), addDays(T, 1))).toEqual({
      kind: "expired",
      expiresAt: T,
    });
  });

  it("is awaiting for a first-play link nobody has played: the unclaimed date and the days a play would give it", () => {
    expect(shareExpiryState(facts(), T)).toEqual({ kind: "awaiting", unclaimedUntil: addDays(T, 90), daysAfterFirstPlay: 7 });
  });

  it("is played once the deadline has moved: when it was first played and where the deadline now is", () => {
    const share = facts({ firstPlayedAt: T, expiresAt: addDays(T, 7) });
    expect(shareExpiryState(share, addDays(T, 1))).toEqual({ kind: "played", firstPlayedAt: T, expiresAt: addDays(T, 7) });
  });

  it("is fixed for a legacy link, played or not, and for a first-play link with no number on it", () => {
    const legacy = facts({ expiryPolicy: "FIXED", daysAfterFirstPlay: null, expiresAt: addDays(T, 60) });
    expect(shareExpiryState(legacy, T)).toEqual({ kind: "fixed", expiresAt: addDays(T, 60) });
    expect(shareExpiryState(facts({ daysAfterFirstPlay: null }), T)).toEqual({ kind: "fixed", expiresAt: addDays(T, 90) });
  });
});

describe("daysLeftText", () => {
  it("rounds to the nearest day and reads naturally", () => {
    expect(daysLeftText(addDays(T, 6), T)).toBe("6 days left");
    expect(daysLeftText(addDays(T, 6.6), T)).toBe("7 days left");
    expect(daysLeftText(addDays(T, 1), T)).toBe("1 day left");
    expect(daysLeftText(addDays(T, 0.4), T)).toBe("Less than a day left");
  });
});
