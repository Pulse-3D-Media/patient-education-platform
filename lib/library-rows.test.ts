import { describe, expect, it } from "vitest";
import {
  CATEGORY_ROW_LIMIT,
  FAVORITES_EMPTY,
  MOST_WATCHED_LIMIT,
  MOST_WATCHED_MIN,
  SEARCH_MAX_LENGTH,
  SEARCH_PATH,
  readSearchQuery,
  showMostWatched,
} from "./library-rows";

/** The library home's row rules, with plain values. */
describe("the library home's rows", () => {
  it("shows Most watched only once at least three different videos have been played", () => {
    expect(MOST_WATCHED_MIN).toBe(3);
    expect(showMostWatched([])).toBe(false);
    expect(showMostWatched(["a"])).toBe(false);
    expect(showMostWatched(["a", "b"])).toBe(false);
    expect(showMostWatched(["a", "b", "c"])).toBe(true);
    expect(showMostWatched(Array.from({ length: MOST_WATCHED_LIMIT }, (_, i) => i))).toBe(true);
  });

  it("keeps the agreed limits and words", () => {
    expect(CATEGORY_ROW_LIMIT).toBe(5);
    expect(MOST_WATCHED_LIMIT).toBe(10);
    expect(FAVORITES_EMPTY).toBe("Tap the heart on any video to keep it here.");
    expect(SEARCH_PATH).toBe("/library/search");
  });

  it("never says a number in the empty line", () => {
    expect(FAVORITES_EMPTY).not.toMatch(/\d/);
  });
});

describe("reading a search from the address", () => {
  it("trims, folds spaces and cuts to the limit", () => {
    expect(readSearchQuery("  total   knee ")).toBe("total knee");
    expect(readSearchQuery("x".repeat(SEARCH_MAX_LENGTH + 20))).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("gives nothing for empty, missing or repeated values", () => {
    expect(readSearchQuery("")).toBeNull();
    expect(readSearchQuery("   ")).toBeNull();
    expect(readSearchQuery(undefined)).toBeNull();
    expect(readSearchQuery(["knee", "hip"])).toBeNull();
  });
});
