import { describe, expect, it } from "vitest";
import {
  addDays,
  canClaimFirstPlay,
  DAY_MS,
  daysLeftText,
  expiryAfterFirstPlay,
  isExpired,
  isValidLinkDays,
  MAX_LINK_DAYS,
  MIN_LINK_DAYS,
  resolveShareTerms,
  shareExpiryState,
  ShareTermsError,
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

  it("accepts the limits themselves: one day and one year, for both numbers and for the override", () => {
    expect(resolveShareTerms({ unclaimedDays: MIN_LINK_DAYS, viewDays: MIN_LINK_DAYS }, { viewDaysOverride: null })).toEqual({ unclaimedDays: 1, daysAfterFirstPlay: 1 });
    expect(resolveShareTerms({ unclaimedDays: MAX_LINK_DAYS, viewDays: MAX_LINK_DAYS }, { viewDaysOverride: null })).toEqual({ unclaimedDays: 365, daysAfterFirstPlay: 365 });
    expect(resolveShareTerms(platform, { viewDaysOverride: MAX_LINK_DAYS })).toEqual({ unclaimedDays: 90, daysAfterFirstPlay: 365 });
    expect(resolveShareTerms(platform, { viewDaysOverride: MIN_LINK_DAYS })).toEqual({ unclaimedDays: 90, daysAfterFirstPlay: 1 });
  });

  it("refuses a number just past either limit, or not a whole number of days, before it can become a date", () => {
    /** The call must throw a ShareTermsError whose message names the setting at fault and the limits. */
    const refused = (settings: { unclaimedDays: number; viewDays: number }, clinic: { viewDaysOverride: number | null }, setting: string) => {
      expect(() => resolveShareTerms(settings, clinic)).toThrow(ShareTermsError);
      expect(() => resolveShareTerms(settings, clinic)).toThrow(setting);
      expect(() => resolveShareTerms(settings, clinic)).toThrow(/from 1 to 365/);
    };
    refused({ unclaimedDays: MAX_LINK_DAYS + 1, viewDays: 7 }, { viewDaysOverride: null }, "Unclaimed link days");
    refused({ unclaimedDays: MIN_LINK_DAYS - 1, viewDays: 7 }, { viewDaysOverride: null }, "Unclaimed link days");
    refused({ unclaimedDays: 90, viewDays: MAX_LINK_DAYS + 1 }, { viewDaysOverride: null }, "Days after first play");
    refused({ unclaimedDays: 90, viewDays: 0 }, { viewDaysOverride: null }, "Days after first play");
    refused({ unclaimedDays: 90, viewDays: 7 }, { viewDaysOverride: MAX_LINK_DAYS + 1 }, "this clinic");
    refused({ unclaimedDays: 90, viewDays: 7 }, { viewDaysOverride: 0 }, "this clinic");
    refused({ unclaimedDays: 90.5, viewDays: 7 }, { viewDaysOverride: null }, "Unclaimed link days");
    refused({ unclaimedDays: 90, viewDays: Number.NaN }, { viewDaysOverride: null }, "Days after first play");
    refused({ unclaimedDays: Number.POSITIVE_INFINITY, viewDays: 7 }, { viewDaysOverride: null }, "Unclaimed link days");
    // A bad platform number is not rescued by a good clinic number: both must hold.
    refused({ unclaimedDays: MAX_LINK_DAYS + 1, viewDays: 7 }, { viewDaysOverride: 10 }, "Unclaimed link days");
    // The message is the plain sentence for the person who tried, not a technical one.
    expect(() => resolveShareTerms({ unclaimedDays: 400, viewDays: 7 }, { viewDaysOverride: null })).toThrow(/Ask Pulse 3D/);
  });
});

describe("isValidLinkDays", () => {
  it("is true only for a whole number of days from one to a year", () => {
    expect(MIN_LINK_DAYS).toBe(1);
    expect(MAX_LINK_DAYS).toBe(365);
    for (const good of [1, 2, 7, 90, 364, 365]) expect(isValidLinkDays(good)).toBe(true);
    for (const bad of [0, -1, 366, 1000, 1.5, 364.999, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined, "7"]) {
      expect(isValidLinkDays(bad)).toBe(false);
    }
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

  it("is false for a stored number outside the limits, so a bad number never becomes a deadline, and true at the limits", () => {
    for (const bad of [0, MAX_LINK_DAYS + 1, 1.5, -7]) expect(canClaimFirstPlay(facts({ daysAfterFirstPlay: bad }))).toBe(false);
    expect(canClaimFirstPlay(facts({ daysAfterFirstPlay: MIN_LINK_DAYS }))).toBe(true);
    expect(canClaimFirstPlay(facts({ daysAfterFirstPlay: MAX_LINK_DAYS }))).toBe(true);
    // And the state such a link shows is "fixed", not "awaiting".
    expect(shareExpiryState(facts({ daysAfterFirstPlay: MAX_LINK_DAYS + 1 }), T).kind).toBe("fixed");
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
