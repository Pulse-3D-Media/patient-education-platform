import type { Category } from "./categories";

/**
 * Keeping a page left open from undoing someone else's save, for the video
 * form on /pulse/videos. Pure and safe for the browser: no database here.
 *
 * The problem: a staff member opens a video's page, leaves it open, and
 * saves it an hour later to fix a typo in the notes. Every box on that page
 * still shows what the video was an hour ago. Without a guard, the save
 * would write all of it back, so a colleague's unpublish (or publish, or
 * placeholder change, or new title) in that hour would be silently undone.
 *
 * The fix, the same one the Mux boxes, the length and the chapters already
 * use: the form also sends what it was SHOWING for each field (a hidden
 * `shown...` box beside it). On the server, for each field:
 *
 *   - sent equals shown: the staff member did not touch it, so the row's
 *     CURRENT value is kept (whatever a colleague saved since stays);
 *   - sent differs from shown: a deliberate change, which wins.
 *
 * A form with no `shown...` box for a field (a page drawn before this guard
 * existed) behaves as before: what it sent wins.
 *
 * The decision depends on the row as it is at the moment of the save, so it
 * is made inside the save's own transaction with the row locked
 * (updateVideoKeepingOthers() in lib/db/videos.ts).
 */

/** The fields this guard covers, with the name of the hidden box that says what the form showed. */
export const GUARDED_VIDEO_FIELDS = {
  title: "shownTitle",
  category: "shownCategory",
  posterUrl: "shownPosterUrl",
  notes: "shownNotes",
  isPublished: "shownIsPublished",
  isPlaceholder: "shownIsPlaceholder",
} as const;

export type GuardedVideoField = keyof typeof GUARDED_VIDEO_FIELDS;

/** The values of the guarded fields, as the database holds them. */
export type GuardedVideoValues = {
  title: string;
  category: Category;
  posterUrl: string | null;
  notes: string | null;
  isPublished: boolean;
  isPlaceholder: boolean;
};

/** What the form showed, field by field, as text. A field missing here had no `shown...` box. */
export type ShownVideoValues = Partial<Record<GuardedVideoField, string>>;

const FIELD_NAMES = Object.keys(GUARDED_VIDEO_FIELDS) as GuardedVideoField[];

/**
 * One value as the form writes it in its `shown...` box: a tick box is "on"
 * or empty (what a ticked or unticked box sends), anything else is its text,
 * empty for nothing. The form and the server both use this, so the two
 * sides always compare like with like.
 */
export function shownText(value: string | boolean | null): string {
  if (typeof value === "boolean") return value ? "on" : "";
  return value ?? "";
}

/** The `shown...` boxes the form should carry for a video as it is drawn. */
export function shownBoxesFor(video: GuardedVideoValues): Record<string, string> {
  const boxes: Record<string, string> = {};
  for (const field of FIELD_NAMES) boxes[GUARDED_VIDEO_FIELDS[field]] = shownText(video[field]);
  return boxes;
}

/** What the form said it showed, read from what it sent. Only text values count; anything else is treated as missing. */
export function readShownVideoValues(formData: FormData): ShownVideoValues {
  const shown: ShownVideoValues = {};
  for (const field of FIELD_NAMES) {
    const value = formData.get(GUARDED_VIDEO_FIELDS[field]);
    if (typeof value === "string") shown[field] = value.trim();
  }
  return shown;
}

/**
 * The values to save: for each guarded field, the row's current value when
 * the staff member left it as the form showed it, and what they sent when
 * they changed it. See the top of this file.
 */
export function keepUnchangedFields(sent: GuardedVideoValues, shown: ShownVideoValues, current: GuardedVideoValues): GuardedVideoValues {
  const result = { ...sent };
  for (const field of FIELD_NAMES) {
    const wasShown = shown[field];
    if (wasShown !== undefined && shownText(sent[field]) === wasShown) {
      // Left as it was shown: keep what the row says now.
      (result as Record<GuardedVideoField, unknown>)[field] = current[field];
    }
  }
  return result;
}
