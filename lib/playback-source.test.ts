import { describe, expect, it } from "vitest";
import {
  MIN_REFRESH_DELAY_MS,
  REFRESH_LEAD_MS,
  TOKEN_LIFETIME_MS,
  isPlaybackIdShape,
  refreshDelayMs,
  tokenExpiry,
  tokenHasExpired,
  windowCoversVideo,
} from "./playback-source";

/**
 * The rules about how long a signed address lives, with plain values. What
 * these prove: a token never outlives a patient link, is never shorter than
 * the video where the link allows it, is not made at all once the link has
 * run out, and the player asks for a fresh one a little before the old one
 * runs out and never in a tight loop.
 */

const NOW = new Date("2026-10-05T12:00:00Z");
const minutes = (n: number) => n * 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("tokenExpiry", () => {
  it("is the usual lifetime when nothing shorter or longer applies", () => {
    expect(tokenExpiry(NOW, null)).toEqual(at(TOKEN_LIFETIME_MS));
    expect(tokenExpiry(NOW, at(minutes(60 * 24 * 7)))).toEqual(at(TOKEN_LIFETIME_MS));
  });

  it("is cut to the link's deadline when that comes first: a token never outlives the link", () => {
    expect(tokenExpiry(NOW, at(minutes(10)))).toEqual(at(minutes(10)));
    expect(tokenExpiry(NOW, at(1_000))).toEqual(at(1_000));
  });

  it("is nothing at all once the link's deadline has passed, or is this very moment", () => {
    expect(tokenExpiry(NOW, NOW)).toBeNull();
    expect(tokenExpiry(NOW, at(-1))).toBeNull();
  });

  it("is stretched to cover a video longer than the usual lifetime, as Mux asks, but still never past the link", () => {
    const twoHours = minutes(120);
    expect(tokenExpiry(NOW, null, twoHours)).toEqual(at(twoHours));
    expect(tokenExpiry(NOW, at(minutes(30)), twoHours)).toEqual(at(minutes(30)));
    // A short video changes nothing; a length that is not a number is ignored.
    expect(tokenExpiry(NOW, null, minutes(3))).toEqual(at(TOKEN_LIFETIME_MS));
    expect(tokenExpiry(NOW, null, Number.NaN)).toEqual(at(TOKEN_LIFETIME_MS));
    expect(tokenExpiry(NOW, null, -5)).toEqual(at(TOKEN_LIFETIME_MS));
  });
});

describe("windowCoversVideo", () => {
  it("is true when the time left holds one whole viewing, and false when it does not", () => {
    expect(windowCoversVideo(NOW, at(minutes(10)), 110)).toBe(true);
    expect(windowCoversVideo(NOW, at(110_000), 110)).toBe(true);
    expect(windowCoversVideo(NOW, at(109_999), 110)).toBe(false);
  });

  it("has nothing honest to say without a deadline or a length, so it is true", () => {
    expect(windowCoversVideo(NOW, null, 110)).toBe(true);
    expect(windowCoversVideo(NOW, at(1_000), null)).toBe(true);
    expect(windowCoversVideo(NOW, at(1_000), Number.NaN)).toBe(true);
  });
});

describe("refreshDelayMs and tokenHasExpired", () => {
  it("asks a little before the token runs out, and never sooner than the minimum", () => {
    const expiresAt = NOW.getTime() + TOKEN_LIFETIME_MS;
    expect(refreshDelayMs(expiresAt, NOW.getTime())).toBe(TOKEN_LIFETIME_MS - REFRESH_LEAD_MS);
    // A token that is nearly out, or already out, is asked about after the minimum, not at once in a loop.
    expect(refreshDelayMs(NOW.getTime() + 1_000, NOW.getTime())).toBe(MIN_REFRESH_DELAY_MS);
    expect(refreshDelayMs(NOW.getTime() - 1_000, NOW.getTime())).toBe(MIN_REFRESH_DELAY_MS);
  });

  it("a token has expired at its moment and after, not before", () => {
    expect(tokenHasExpired(NOW.getTime(), NOW.getTime())).toBe(true);
    expect(tokenHasExpired(NOW.getTime() + 1, NOW.getTime())).toBe(false);
  });
});

describe("isPlaybackIdShape", () => {
  it("accepts what Mux hands out and refuses anything that could be an address or a trick", () => {
    expect(isPlaybackIdShape("Abc123xyz_-00Qq")).toBe(true);
    expect(isPlaybackIdShape("a".repeat(128))).toBe(true);
    expect(isPlaybackIdShape("short")).toBe(false);
    expect(isPlaybackIdShape("a".repeat(129))).toBe(false);
    expect(isPlaybackIdShape("has/slash00")).toBe(false);
    expect(isPlaybackIdShape("has space00")).toBe(false);
    expect(isPlaybackIdShape("id?token=abc")).toBe(false);
    expect(isPlaybackIdShape("")).toBe(false);
  });
});
