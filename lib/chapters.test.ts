import { describe, expect, it } from "vitest";
import {
  CHAPTERS_MAX,
  CHAPTER_TITLE_MAX,
  chaptersKey,
  chaptersToLines,
  checkChapters,
  currentChapterIndex,
  parseChapterLines,
  readStoredChapters,
  type ChapterLine,
} from "./chapters";

/** The first real data, as Evan will type it after release (Total Knee Replacement, about 1:50 long). */
const KNEE: ChapterLine[] = [
  { start: "0:00", title: "Intro" },
  { start: "0:33", title: "Preparing the knee" },
  { start: "1:03", title: "The implant" },
  { start: "1:28", title: "The result" },
  { start: "1:37", title: "Outro" },
];

function error(result: ReturnType<typeof parseChapterLines>): string {
  if (!("error" in result)) throw new Error("expected a refusal");
  return result.error;
}

describe("parseChapterLines", () => {
  it("reads the knee's chapters as typed", () => {
    expect(parseChapterLines(KNEE, 110)).toEqual({
      chapters: [
        { startSeconds: 0, title: "Intro" },
        { startSeconds: 33, title: "Preparing the knee" },
        { startSeconds: 63, title: "The implant" },
        { startSeconds: 88, title: "The result" },
        { startSeconds: 97, title: "Outro" },
      ],
    });
  });

  it("takes lines in any order and keeps them sorted by time", () => {
    const shuffled = [KNEE[3], KNEE[0], KNEE[4], KNEE[2], KNEE[1]];
    expect(parseChapterLines(shuffled, 110)).toEqual(parseChapterLines(KNEE, 110));
  });

  it("trims spaces around the time and the title", () => {
    expect(parseChapterLines([{ start: " 0:00 ", title: "  Intro  " }], null)).toEqual({ chapters: [{ startSeconds: 0, title: "Intro" }] });
  });

  it("ignores a line left completely empty, and no lines at all is no chapters", () => {
    expect(parseChapterLines([...KNEE, { start: "", title: "  " }], 110)).toEqual(parseChapterLines(KNEE, 110));
    expect(parseChapterLines([], 110)).toEqual({ chapters: [] });
    expect(parseChapterLines([{ start: " ", title: "" }], 110)).toEqual({ chapters: [] });
  });

  it("refuses a list with no chapter at 0:00", () => {
    expect(error(parseChapterLines(KNEE.slice(1), 110))).toMatch(/first chapter has to start at 0:00/);
    expect(error(parseChapterLines([{ start: "0:01", title: "Intro" }], 110))).toMatch(/0:00/);
  });

  it("refuses two chapters at the same time, however it was typed", () => {
    expect(error(parseChapterLines([...KNEE, { start: "1:03", title: "Again" }], 110))).toBe("Two chapters start at 1:03. Give each one its own time.");
    expect(error(parseChapterLines([KNEE[0], { start: "0:33", title: "A" }, { start: "00:33", title: "B" }], 110))).toMatch(/Two chapters start at 0:33/);
  });

  it("refuses a time at or past the video's length, and allows one just before it", () => {
    expect(error(parseChapterLines([KNEE[0], { start: "1:50", title: "Too late" }], 110))).toMatch(/starts after the video ends \(1:50\)/);
    expect(error(parseChapterLines([KNEE[0], { start: "2:10", title: "Too late" }], 110))).toMatch(/starts after the video ends/);
    expect(parseChapterLines([KNEE[0], { start: "1:49", title: "Just in" }], 110)).toMatchObject({ chapters: [{ startSeconds: 0 }, { startSeconds: 109 }] });
  });

  it("does not check the length when the video has none yet", () => {
    expect(parseChapterLines([KNEE[0], { start: "59:00", title: "Late" }], null)).toMatchObject({ chapters: [{ startSeconds: 0 }, { startSeconds: 3540 }] });
  });

  it("takes a title of exactly 40 characters and refuses 41", () => {
    const forty = "x".repeat(CHAPTER_TITLE_MAX);
    expect(parseChapterLines([{ start: "0:00", title: forty }], 110)).toEqual({ chapters: [{ startSeconds: 0, title: forty }] });
    expect(error(parseChapterLines([{ start: "0:00", title: `${forty}y` }], 110))).toMatch(/to 40 characters\. ".*\.\.\." has 41\./);
  });

  it("refuses a title with a line break or another control character", () => {
    expect(error(parseChapterLines([{ start: "0:00", title: "Two\nlines" }], 110))).toMatch(/on one line/);
    expect(error(parseChapterLines([{ start: "0:00", title: "Tab\there" }], 110))).toMatch(/on one line/);
  });

  it("takes 20 chapters and refuses 21", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => ({ start: `0:${String(i).padStart(2, "0")}`, title: `Chapter ${i + 1}` }));
    expect(parseChapterLines(lines(CHAPTERS_MAX), 110)).toMatchObject({ chapters: expect.any(Array) });
    expect((parseChapterLines(lines(CHAPTERS_MAX), 110) as { chapters: unknown[] }).chapters).toHaveLength(CHAPTERS_MAX);
    expect(error(parseChapterLines(lines(CHAPTERS_MAX + 1), 110))).toBe("A video can have at most 20 chapters. Remove 1 to save.");
  });

  it("refuses junk for a time, and a plain number of seconds", () => {
    for (const start of ["soon", "1:3", "1:60", "1.03", "-0:10", "0:00:00:00", "33", "1:2:3"]) {
      expect(error(parseChapterLines([{ start: "0:00", title: "Intro" }, { start, title: "Next" }], null))).toMatch(/is not a time/);
    }
  });

  it("refuses a line with only one of its two boxes filled", () => {
    expect(error(parseChapterLines([{ start: "0:00", title: "" }], 110))).toBe("Give the chapter at 0:00 a title.");
    expect(error(parseChapterLines([{ start: "", title: "Intro" }], 110))).toBe('Give the chapter "Intro" a start time, like 1:03.');
  });

  it("takes hours for a long video", () => {
    expect(parseChapterLines([{ start: "0:00", title: "A" }, { start: "1:02:03", title: "B" }], null)).toMatchObject({ chapters: [{}, { startSeconds: 3723 }] });
  });
});

describe("checkChapters", () => {
  it("refuses a time that is not a whole number of seconds", () => {
    expect(checkChapters([{ startSeconds: 0, title: "A" }, { startSeconds: 1.5, title: "B" }], null)).toEqual({ error: "Chapter times are whole seconds, typed like 1:03." });
    expect(checkChapters([{ startSeconds: -1, title: "A" }], null)).toMatchObject({ error: expect.any(String) });
  });

  it("catches kept chapters that a shorter length would cut off", () => {
    const chapters = [{ startSeconds: 0, title: "A" }, { startSeconds: 97, title: "B" }];
    expect(checkChapters(chapters, 110)).toMatchObject({ chapters });
    expect(checkChapters(chapters, 90)).toMatchObject({ error: expect.stringMatching(/starts after the video ends \(1:30\)/) });
  });
});

describe("readStoredChapters", () => {
  it("reads a good list back, sorted", () => {
    expect(readStoredChapters([{ startSeconds: 33, title: "B" }, { startSeconds: 0, title: "A" }])).toEqual([
      { startSeconds: 0, title: "A" },
      { startSeconds: 33, title: "B" },
    ]);
  });

  it("reads anything damaged as no chapters, never a broken page", () => {
    for (const stored of [null, undefined, "[]", 5, {}, [null], [{ startSeconds: "0", title: "A" }], [{ startSeconds: 5, title: "No zero" }], [{ startSeconds: 0, title: "" }], [{ startSeconds: 0, title: "x".repeat(41) }]]) {
      expect(readStoredChapters(stored)).toEqual([]);
    }
    expect(readStoredChapters([])).toEqual([]);
  });
});

describe("chaptersKey and chaptersToLines", () => {
  it("gives the same key whatever the order, and a different one for any change", () => {
    const a = [{ startSeconds: 0, title: "A" }, { startSeconds: 33, title: "B" }];
    expect(chaptersKey([a[1], a[0]])).toBe(chaptersKey(a));
    expect(chaptersKey([a[0], { startSeconds: 34, title: "B" }])).not.toBe(chaptersKey(a));
    expect(chaptersKey([a[0], { startSeconds: 33, title: "b" }])).not.toBe(chaptersKey(a));
    expect(chaptersKey([])).toBe("[]");
  });

  it("writes chapters back as the lines they were typed as", () => {
    const parsed = parseChapterLines(KNEE, 110);
    if (!("chapters" in parsed)) throw new Error("expected chapters");
    expect(chaptersToLines(parsed.chapters)).toEqual(KNEE);
  });
});

describe("currentChapterIndex", () => {
  const chapters = [
    { startSeconds: 0, title: "Intro" },
    { startSeconds: 33, title: "Preparing the knee" },
    { startSeconds: 63, title: "The implant" },
  ];

  it("is the last chapter that has started", () => {
    expect(currentChapterIndex(chapters, 0)).toBe(0);
    expect(currentChapterIndex(chapters, 32.9)).toBe(0);
    expect(currentChapterIndex(chapters, 33)).toBe(1);
    expect(currentChapterIndex(chapters, 62.99)).toBe(1);
    expect(currentChapterIndex(chapters, 63)).toBe(2);
    expect(currentChapterIndex(chapters, 5000)).toBe(2);
  });

  it("is the first chapter before anything is known, and -1 with no chapters", () => {
    expect(currentChapterIndex(chapters, Number.NaN)).toBe(0);
    expect(currentChapterIndex([], 10)).toBe(-1);
  });
});
