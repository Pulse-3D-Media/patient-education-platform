import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chaptersKey } from "@/lib/chapters";
import { VideoForm, type VideoValues } from "./VideoForm";

/**
 * The video form as the server first draws it, with the Server Actions as
 * stand-ins: the Chapters section on a video's page, one line per saved
 * chapter, and the hidden note of what the form was showing that keeps a
 * stale form from wiping someone else's chapters. Typing, Add chapter,
 * Remove and the refusals are a browser check; the rules are
 * lib/chapters.test.ts, the save is app/pulse/actions.test.ts.
 */

vi.mock("../actions", () => ({
  saveVideoAction: vi.fn(),
  startMuxUploadAction: vi.fn(),
  checkMuxUploadAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  unstable_rethrow: () => {},
}));

const KNEE = [
  { startSeconds: 0, title: "Intro" },
  { startSeconds: 33, title: "Preparing the knee" },
  { startSeconds: 63, title: "The implant" },
];

function video(chapters = KNEE): VideoValues {
  return {
    id: "clvideo000000000000000001",
    title: "Total Knee Replacement",
    category: "KNEE",
    videoUrl: null,
    durationSeconds: 110,
    posterUrl: null,
    isPlaceholder: false,
    isPublished: true,
    notes: null,
    muxPlaybackId: null,
    muxAssetId: null,
    chapters,
    shareCount: 0,
  };
}

/** The value of every box with this name, in the page's order. */
const values = (html: string, name: string) => [...html.matchAll(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, "g"))].map(([, value]) => value);

describe("the Chapters section", () => {
  it("draws one line per saved chapter, time then title, with Remove on each", () => {
    const html = renderToStaticMarkup(<VideoForm video={video()} />);
    expect(values(html, "chapterStart")).toEqual(["0:00", "0:33", "1:03"]);
    expect(values(html, "chapterTitle")).toEqual(["Intro", "Preparing the knee", "The implant"]);
    expect(html.match(/aria-label="Remove chapter \d"/g)).toHaveLength(3);
    expect(html).toContain("Add chapter");
    expect(html).toMatch(/name="chapterTitle"[^>]*maxLength="40"|maxLength="40"[^>]*name="chapterTitle"/);
  });

  it("sends what it was showing, so a save that leaves the chapters alone keeps the row's", () => {
    const html = renderToStaticMarkup(<VideoForm video={video()} />);
    const shown = html.match(/name="shownChapters" value="([^"]*)"/)?.[1].replaceAll("&quot;", '"');
    expect(shown).toBe(chaptersKey(KNEE));
  });

  it("says there are none for a video without chapters, still with Add chapter", () => {
    const html = renderToStaticMarkup(<VideoForm video={video([])} />);
    expect(values(html, "chapterStart")).toEqual([]);
    expect(html).toContain("No chapters.");
    expect(html).toMatch(/name="shownChapters" value="\[\]"/);
  });

  it("is not on the add form", () => {
    const html = renderToStaticMarkup(<VideoForm />);
    expect(html).not.toContain("Chapters");
    expect(html).not.toContain("shownChapters");
  });
});
