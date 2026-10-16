import { describe, expect, it } from "vitest";
import {
  CATEGORY_ROW_LIMIT,
  FAVORITES_EMPTY,
  MORE_IN_CATEGORY_LIMIT,
  MOST_WATCHED_LIMIT,
  MOST_WATCHED_MIN,
  SEARCH_MAX_LENGTH,
  SEARCH_PATH,
  VIDEO_ID_MAX_LENGTH,
  WATCH_PATH,
  readSearchQuery,
  readWatchVideoId,
  showMostWatched,
  watchPageHref,
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

describe("the watch page's address", () => {
  it("is /library/watch/<id>, and carries nothing but the id", () => {
    expect(WATCH_PATH).toBe("/library/watch");
    expect(watchPageHref("cmtne63om0000hvi8fnm0su5v")).toBe("/library/watch/cmtne63om0000hvi8fnm0su5v");
    expect(watchPageHref("a/b?c")).toBe("/library/watch/a%2Fb%3Fc");
  });

  it("reads a video id of the right shape, and nothing else", () => {
    expect(readWatchVideoId("cmtne63om0000hvi8fnm0su5v")).toBe("cmtne63om0000hvi8fnm0su5v");
    expect(readWatchVideoId("a".repeat(VIDEO_ID_MAX_LENGTH))).toHaveLength(VIDEO_ID_MAX_LENGTH);
    expect(readWatchVideoId("a".repeat(VIDEO_ID_MAX_LENGTH + 1))).toBeNull();
    for (const junk of ["", "../admin", "id with spaces", "id%27", "<script>", undefined]) expect(readWatchVideoId(junk)).toBeNull();
  });

  it("bounds the More in list", () => {
    expect(MORE_IN_CATEGORY_LIMIT).toBe(30);
  });
});
