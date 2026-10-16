/**
 * The rows on the library home, as plain rules. Pure, safe for the browser.
 *
 * The home page is a column of rows, Netflix-style (decided by Evan on
 * 2026-10-15), top to bottom:
 *
 *   1. Category tabs: "All" and the categories on the clinic's plan,
 *      centered at the top of every library page, under the top bar (whose
 *      search box, at its right, searches the whole library, SEARCH_PATH).
 *   2. My favorites: the videos this person hearted, newest heart first,
 *      as bigger cards. With none, one quiet line (FAVORITES_EMPTY).
 *   3. Most watched: this person's own most-played videos across every
 *      category, up to MOST_WATCHED_LIMIT, shown only once they have played
 *      at least MOST_WATCHED_MIN different videos (showMostWatched()).
 *   4. One row per category on the plan: its newest CATEGORY_ROW_LIMIT
 *      videos and a "View category" link.
 *   5. The closed "More categories" section for the locked ones, as before.
 *
 * Favorites and plays are PER PERSON (PersonalVideo in the schema): nobody
 * sees anyone else's, and no number (a play count, a heart count) is ever
 * shown on the clinic side. The counts only decide the ORDER of "Most
 * watched". Every row is read through the clinic's access rule in the
 * query (lib/db/personal-videos.ts and lib/db/videos.ts), so a favorite
 * whose category left the plan is simply not shown, and is back if the
 * category returns.
 */

/** Cards in one category's row on the home page. The rest are a tap away on "View category". */
export const CATEGORY_ROW_LIMIT = 5;

/** The most favorites the home page reads. A bound, not a promise: nobody is expected to heart this many. */
export const FAVORITES_LIMIT = 50;

/** The most cards in "Most watched". */
export const MOST_WATCHED_LIMIT = 10;

/** "Most watched" appears once this many different videos have been played. Fewer would just repeat the favorites. */
export const MOST_WATCHED_MIN = 3;

/** What "My favorites" says when there are none. */
export const FAVORITES_EMPTY = "Tap the heart on any video to keep it here.";

/** Whether "Most watched" is shown, given the videos it would hold (already filtered by access, most played first). */
export function showMostWatched(videos: readonly unknown[]): boolean {
  return videos.length >= MOST_WATCHED_MIN;
}

/** The library's search results page. The search box in the top bar opens it with ?q=... */
export const SEARCH_PATH = "/library/search";

/** The longest search the box takes and the page reads. A procedure name is far shorter. */
export const SEARCH_MAX_LENGTH = 80;

/** The most results a search shows. A bound, not a promise: the whole library is far smaller. */
export const SEARCH_LIMIT = 60;

/**
 * What a search asked for, from the address: trimmed, inner spaces folded to
 * one, cut to SEARCH_MAX_LENGTH. Null for nothing usable (empty, missing, or
 * sent twice, which a person typing never does).
 */
export function readSearchQuery(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const query = value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();
  return query.length > 0 ? query : null;
}

/**
 * The watch page, YouTube-style (decided by Evan on 2026-10-15): tapping a
 * card anywhere in the library opens /library/watch/<videoId>, with the
 * video PAUSED until the surgeon taps Play (they may open it while still
 * talking to the patient). Its address carries the video's id and nothing
 * else; the server decides whether this clinic may use it.
 */
export const WATCH_PATH = "/library/watch";

/** The watch page's address for one video. */
export function watchPageHref(videoId: string): string {
  return `${WATCH_PATH}/${encodeURIComponent(videoId)}`;
}

/** The longest video id the watch page will look up. Ids are cuids (25 characters); anything far longer is junk. */
export const VIDEO_ID_MAX_LENGTH = 64;

/** A video id from the watch page's address, checked for shape only: letters, digits, "_" and "-". Null for anything else. */
export function readWatchVideoId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 && value.length <= VIDEO_ID_MAX_LENGTH && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

/** The most videos in the watch page's "More in <category>" list. A bound, not a promise. */
export const MORE_IN_CATEGORY_LIMIT = 30;
