import { formatDuration, parseDuration } from "./format";

/**
 * A video's chapters (decided by Evan on 2026-10-15, the third part of the
 * library redesign): named points in a video, like YouTube's, that a surgeon
 * can jump to on the library's watch page. Pulse staff type them on the
 * video's page at /pulse/videos; they are stored on the Video row as a JSON
 * list (`Video.chapters`). The patient page never shows them.
 *
 * Pure and safe for the browser: the edit form and the server use the SAME
 * checks, so the form can say what is wrong before it is sent, and the
 * server refuses anything that slipped past (rule 8: the server decides).
 *
 * The rules for a list of chapters:
 *   - at most CHAPTERS_MAX (20);
 *   - the first starts at 0:00;
 *   - times are whole seconds, typed as "0:33" or "1:03", all different,
 *     and before the video's length when the length is known;
 *   - each title is 1 to CHAPTER_TITLE_MAX (40) characters, on one line.
 * Lines may be typed in any order; they are kept sorted by time. No chapters
 * at all is allowed, and means the video has none.
 */

/** One chapter: where it starts, in whole seconds from the beginning, and its name. */
export type Chapter = { startSeconds: number; title: string };

/** One line of the edit form, as typed: the start time ("1:03") and the title. */
export type ChapterLine = { start: string; title: string };

/** The most chapters one video may have. */
export const CHAPTERS_MAX = 20;

/** The longest a chapter's title may be. */
export const CHAPTER_TITLE_MAX = 40;

/** Control characters (a line break, a tab and the like): a title is one plain line. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Check the lines typed in the form and turn them into chapters, sorted by
 * time. A line left completely empty is ignored (an Add chapter pressed and
 * never filled in); a line with only one of its two boxes filled is a
 * mistake and is refused. `durationSeconds` is the video's length when it
 * is known, else null. Answers the chapters, or one plain sentence saying
 * what to fix.
 */
export function parseChapterLines(lines: ChapterLine[], durationSeconds: number | null): { chapters: Chapter[] } | { error: string } {
  const chapters: Chapter[] = [];
  for (const line of lines) {
    const start = line.start.trim();
    const title = line.title.trim();
    if (!start && !title) continue;
    if (!start) return { error: `Give the chapter "${shorten(title)}" a start time, like 1:03.` };
    if (!title) return { error: `Give the chapter at ${start} a title.` };

    // parseDuration also takes a plain number of seconds; a chapter wants minutes and seconds, so "33" is not taken.
    const seconds = /:/.test(start) ? parseDuration(start) : undefined;
    if (seconds === undefined || seconds === null) return { error: `"${shorten(start)}" is not a time. Type it as minutes and seconds, like 0:33 or 1:03.` };
    chapters.push({ startSeconds: seconds, title });
  }
  return checkChapters(chapters, durationSeconds);
}

/**
 * The rules, applied to chapters that are already numbers: the form's lines
 * once read, and the chapters on a row when a save keeps them (so a length
 * typed shorter than a chapter is still caught). Answers them sorted by time.
 */
export function checkChapters(input: Chapter[], durationSeconds: number | null): { chapters: Chapter[] } | { error: string } {
  if (input.length > CHAPTERS_MAX) return { error: `A video can have at most ${CHAPTERS_MAX} chapters. Remove ${input.length - CHAPTERS_MAX} to save.` };
  const chapters = [...input].sort((a, b) => a.startSeconds - b.startSeconds);

  for (const chapter of chapters) {
    if (!Number.isInteger(chapter.startSeconds) || chapter.startSeconds < 0) return { error: "Chapter times are whole seconds, typed like 1:03." };
    if (chapter.title.length < 1) return { error: `Give the chapter at ${formatDuration(chapter.startSeconds)} a title.` };
    if (chapter.title.length > CHAPTER_TITLE_MAX) {
      return { error: `Keep each chapter title to ${CHAPTER_TITLE_MAX} characters. "${shorten(chapter.title)}" has ${chapter.title.length}.` };
    }
    if (CONTROL_CHARACTERS.test(chapter.title)) return { error: `Keep the chapter title "${shorten(chapter.title)}" on one line.` };
    if (durationSeconds !== null && chapter.startSeconds >= durationSeconds) {
      return { error: `The chapter at ${formatDuration(chapter.startSeconds)} starts after the video ends (${formatDuration(durationSeconds)}). Every chapter has to start before the end.` };
    }
  }
  if (chapters.length > 0 && chapters[0].startSeconds !== 0) return { error: "The first chapter has to start at 0:00, so every moment of the video is in a chapter." };
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].startSeconds === chapters[i - 1].startSeconds) return { error: `Two chapters start at ${formatDuration(chapters[i].startSeconds)}. Give each one its own time.` };
  }
  return { chapters };
}

/**
 * The chapters as the database holds them, read back for a page. The column
 * is JSON, so anything could in principle be in it (a hand edit in Neon):
 * only a list that passes every rule above is used, and anything else reads
 * as no chapters, never as a broken page. The length is not checked here (a
 * video whose length was corrected later still shows its chapters); the
 * player ignores a chapter past the end.
 */
export function readStoredChapters(stored: unknown): Chapter[] {
  if (!Array.isArray(stored)) return [];
  const chapters: Chapter[] = [];
  for (const item of stored) {
    if (typeof item !== "object" || item === null) return [];
    const { startSeconds, title } = item as Record<string, unknown>;
    if (typeof startSeconds !== "number" || typeof title !== "string") return [];
    chapters.push({ startSeconds, title });
  }
  const checked = checkChapters(chapters, null);
  return "chapters" in checked ? checked.chapters : [];
}

/**
 * One fixed piece of text for a list of chapters, so two lists can be
 * compared: the form sends what it was showing in this form, and the server
 * keeps the row's chapters when the staff member left them as they were.
 */
export function chaptersKey(chapters: Chapter[]): string {
  return JSON.stringify([...chapters].sort((a, b) => a.startSeconds - b.startSeconds).map((c) => [c.startSeconds, c.title]));
}

/** The chapters as the form's lines, for the form to start from. */
export function chaptersToLines(chapters: Chapter[]): ChapterLine[] {
  return chapters.map((chapter) => ({ start: formatDuration(chapter.startSeconds), title: chapter.title }));
}

/**
 * Which chapter is playing at this moment: the last one that has started.
 * The list must be sorted (as everything above hands it out). -1 when there
 * are no chapters.
 */
export function currentChapterIndex(chapters: Chapter[], seconds: number): number {
  let current = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startSeconds <= seconds) current = i;
    else break;
  }
  // The first chapter starts at 0, so anything before it (a time not known yet) is still the first.
  return chapters.length > 0 ? Math.max(current, 0) : -1;
}

/** A long piece of typing, cut short for a sentence. */
function shorten(text: string): string {
  return text.length > 30 ? `${text.slice(0, 30)}...` : text;
}
