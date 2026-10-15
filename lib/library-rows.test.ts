import { describe, expect, it } from "vitest";
import { CATEGORY_ROW_LIMIT, FAVORITES_EMPTY, FAVORITES_HREF, MOST_WATCHED_LIMIT, MOST_WATCHED_MIN, showMostWatched } from "./library-rows";

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
    expect(FAVORITES_HREF).toBe("/library#favorites");
  });

  it("never says a number in the empty line", () => {
    expect(FAVORITES_EMPTY).not.toMatch(/\d/);
  });
});
