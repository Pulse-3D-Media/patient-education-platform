"use client";

import { useRef } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { INPUT, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CHAPTERS_MAX, CHAPTER_TITLE_MAX, type ChapterLine } from "@/lib/chapters";

/** One line of the editor: what was typed, and a number that stays with the line so React keeps each box with its own line. */
export type EditorLine = ChapterLine & { id: number };

/** The shared text-box look without its full width, so the two boxes of a line can share the row. */
const LINE_INPUT = INPUT.replace("w-full ", "");

/**
 * The Chapters section of a video's form on /pulse/videos: one line per
 * chapter, a start time ("0:33") and a title, with Add chapter and Remove.
 * Lines may be typed in any order; the server keeps them sorted by time.
 * Saving with every line removed clears the chapters. The checks are
 * lib/chapters.ts, the same ones the server runs (the form asks them before
 * it is sent, the server asks again); `problem` is what they said.
 *
 * The lines live in VideoForm's state, so they survive a refused save like
 * every other box (useKeptForm).
 */
export function ChaptersEditor({
  lines,
  onChange,
  problem,
}: {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  problem: string | null;
}) {
  // New lines get numbers past any the form started with.
  const nextId = useRef(lines.reduce((highest, line) => Math.max(highest, line.id), 0) + 1);

  const add = () => {
    const id = nextId.current;
    nextId.current += 1;
    // The first line of a video with none starts at 0:00, since that is where the first chapter has to be.
    onChange([...lines, { id, start: lines.length === 0 ? "0:00" : "", title: "" }]);
  };
  const change = (id: number, field: "start" | "title", value: string) => onChange(lines.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  const remove = (id: number) => onChange(lines.filter((line) => line.id !== id));

  return (
    <fieldset className="md:col-span-2">
      <legend className="mb-1 block text-sm font-medium text-ink-soft">Chapters (optional)</legend>
      <p className="mb-3 text-xs text-[#667085]">
        Shown to surgeons on the library&apos;s watch page only, never to patients. The first chapter starts at 0:00; times are minutes and
        seconds, like 1:03, each different and before the end of the video. Titles up to {CHAPTER_TITLE_MAX} characters, at most{" "}
        {CHAPTERS_MAX} chapters. Type them in any order: they are saved in order of time. Remove every line to clear them.
      </p>

      {lines.length > 0 && (
        <ol className="mb-3 flex flex-col gap-2">
          {lines.map((line, index) => (
            <li key={line.id} className="flex items-center gap-2">
              <input
                name="chapterStart"
                value={line.start}
                onChange={(event) => change(line.id, "start", event.target.value)}
                aria-label={`Start of chapter ${index + 1}`}
                placeholder="0:33"
                maxLength={9}
                autoComplete="off"
                className={`${LINE_INPUT} w-24 shrink-0 tabular-nums`}
              />
              <input
                name="chapterTitle"
                value={line.title}
                onChange={(event) => change(line.id, "title", event.target.value)}
                aria-label={`Title of chapter ${index + 1}`}
                placeholder="Preparing the knee"
                maxLength={CHAPTER_TITLE_MAX}
                autoComplete="off"
                className={`${LINE_INPUT} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => remove(line.id)}
                aria-label={`Remove chapter ${index + 1}`}
                title="Remove"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-strong text-ink-soft transition hover:border-brand hover:text-ink"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} disabled={lines.length >= CHAPTERS_MAX} className={`${SECONDARY_BUTTON} h-11 disabled:opacity-50`}>
          Add chapter
        </button>
        {lines.length === 0 && <span className="text-sm text-[#bfbfbf]">No chapters.</span>}
        {lines.length >= CHAPTERS_MAX && <span className="text-sm text-[#bfbfbf]">That is the most a video can have.</span>}
      </div>

      {problem && (
        <p role="alert" className="mt-2 text-sm text-[#f3b94d]">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
