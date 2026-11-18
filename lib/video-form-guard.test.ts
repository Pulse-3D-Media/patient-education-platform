import { describe, expect, it } from "vitest";
import { GUARDED_VIDEO_FIELDS, keepUnchangedFields, readShownVideoValues, shownBoxesFor, shownText, type GuardedVideoValues } from "./video-form-guard";

/**
 * The rule that keeps a page left open from undoing a colleague's save on
 * /pulse/videos (lib/video-form-guard.ts). Pure: no database. The save that
 * applies it under a row lock is tested in lib/db/videos.test.ts and
 * lib/db/videos.race.test.ts.
 */

/** What the page showed when it was drawn. */
const SHOWN_ROW: GuardedVideoValues = {
  title: "Total Knee Replacement",
  category: "KNEE",
  posterUrl: "https://image.mux.com/old/thumbnail.jpg",
  notes: "Old note",
  isPublished: true,
  isPlaceholder: true,
};

/** What a colleague saved since: every guarded field different. */
const NOW_ROW: GuardedVideoValues = {
  title: "Total Knee Arthroplasty",
  category: "HIP",
  posterUrl: null,
  notes: "Colleague's note",
  isPublished: false,
  isPlaceholder: false,
};

function formWith(values: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  return data;
}

describe("the shown boxes", () => {
  it("write a tick as 'on' or empty, and text as itself, empty for nothing", () => {
    expect(shownText(true)).toBe("on");
    expect(shownText(false)).toBe("");
    expect(shownText(null)).toBe("");
    expect(shownText("Knee")).toBe("Knee");
  });

  it("are one hidden box per guarded field, named as the server reads them, and read back the same", () => {
    const boxes = shownBoxesFor(SHOWN_ROW);
    expect(Object.keys(boxes).sort()).toEqual(Object.values(GUARDED_VIDEO_FIELDS).sort());
    expect(readShownVideoValues(formWith(boxes))).toEqual({
      title: "Total Knee Replacement",
      category: "KNEE",
      posterUrl: "https://image.mux.com/old/thumbnail.jpg",
      notes: "Old note",
      isPublished: "on",
      isPlaceholder: "on",
    });
  });

  it("are missing, not empty, for a form drawn before the guard existed", () => {
    expect(readShownVideoValues(formWith({ title: "x" }))).toEqual({});
  });
});

describe("keepUnchangedFields", () => {
  const shown = readShownVideoValues(formWith(shownBoxesFor(SHOWN_ROW)));

  it("keeps the row's current value for every field the staff member left as the page showed it", () => {
    // The stale page sends back exactly what it showed: every one of the colleague's values stays.
    expect(keepUnchangedFields(SHOWN_ROW, shown, NOW_ROW)).toEqual(NOW_ROW);
  });

  it.each([
    ["title", { title: "Typed title" }],
    ["category", { category: "SHOULDER" }],
    ["posterUrl", { posterUrl: "https://image.mux.com/new/thumbnail.jpg" }],
    ["posterUrl cleared", { posterUrl: null }],
    ["notes", { notes: "Typed note" }],
    ["notes cleared", { notes: null }],
    ["Published unticked", { isPublished: false }],
    ["Placeholder unticked", { isPlaceholder: false }],
  ] as const)("lets a deliberate change win: %s", (_name, change) => {
    const sent = { ...SHOWN_ROW, ...change };
    const result = keepUnchangedFields(sent, shown, NOW_ROW);
    const [field] = Object.keys(change) as (keyof GuardedVideoValues)[];
    expect(result[field]).toEqual(sent[field]);
    // Everything else still keeps the colleague's values.
    expect({ ...result, [field]: NOW_ROW[field] }).toEqual(NOW_ROW);
  });

  it("lets a deliberate tick win too, over a row a colleague unpublished", () => {
    const shownUnpublished = readShownVideoValues(formWith(shownBoxesFor({ ...SHOWN_ROW, isPublished: false })));
    expect(keepUnchangedFields({ ...SHOWN_ROW, isPublished: true }, shownUnpublished, NOW_ROW).isPublished).toBe(true);
  });

  it("does what it always did when the form has no shown boxes: what was sent wins", () => {
    expect(keepUnchangedFields(SHOWN_ROW, {}, NOW_ROW)).toEqual(SHOWN_ROW);
  });
});
