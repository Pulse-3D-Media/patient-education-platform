import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NOTE_MAX_LENGTH } from "@/lib/note-form";
import { pageInfo } from "@/lib/paging";
import { SETTINGS_DEFAULTS } from "@/lib/settings-defaults";
import { NoteForm } from "./clinics/[id]/forms";
import { SettingsForm } from "./settings/SettingsForm";
import { Pager } from "./ui";

/**
 * Three dashboard pieces as the server first draws them, with the Server
 * Actions as stand-ins (no Clerk, no database): the settings form says which
 * number is not active yet, the note box has its limit and its counter, and
 * the pager draws the right links. Typing and saving are checked in a
 * browser; the rules behind the note box are in lib/note-form.test.ts.
 */

vi.mock("./actions", () => ({
  saveSettingsAction: vi.fn(),
  addNoteAction: vi.fn(),
  saveDetailsAction: vi.fn(),
  setManagedAction: vi.fn(),
  setOwnerAction: vi.fn(),
  setPlanAction: vi.fn(),
  setPracticeTypeAction: vi.fn(),
  setStatusAction: vi.fn(),
}));

describe("SettingsForm", () => {
  const html = renderToStaticMarkup(<SettingsForm settings={SETTINGS_DEFAULTS} />);

  it("marks the QR flag as not active yet, and only the QR flag", () => {
    expect(html.match(/not active yet/gi)).toHaveLength(1);
    // The line sits in the QR row: after its label, and that row is the last one.
    expect(html.indexOf("not active yet")).toBeGreaterThan(html.indexOf("QR scans per day to flag"));
    expect(html.indexOf("QR scans per day to flag")).toBeGreaterThan(html.indexOf("Grace days"));
  });

  it("still draws all five settings with their defaults", () => {
    for (const label of ["Unclaimed link days", "Days after first play", "Maximum renewals", "Grace days", "QR scans per day to flag"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Default 90.");
    expect(html).toContain("Default 200.");
  });
});

describe("NoteForm", () => {
  const html = renderToStaticMarkup(<NoteForm clinicId="clinic_1" />);

  it("stops the box at the note limit and counts down beside the button", () => {
    expect(html).toContain(`maxLength="${NOTE_MAX_LENGTH}"`);
    expect(html).toContain("2,000 of 2,000 characters left");
  });

  it("carries the clinic id and starts empty", () => {
    expect(html).toContain('name="clinicId" value="clinic_1"');
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });
});

describe("Pager", () => {
  const hrefFor = (page: number) => `/pulse?page=${page}`;

  it("draws nothing when the whole list fits on one page", () => {
    expect(renderToStaticMarkup(<Pager info={pageInfo(1, 7, 50)} hrefFor={hrefFor} />)).toBe("");
  });

  it("offers only Next on the first page, both in the middle, only Previous on the last", () => {
    const first = renderToStaticMarkup(<Pager info={pageInfo(1, 132, 50)} hrefFor={hrefFor} />);
    expect(first).toContain("Page 1 of 3");
    expect(first).toContain('href="/pulse?page=2"');
    expect(first).not.toContain("Previous");

    const middle = renderToStaticMarkup(<Pager info={pageInfo(2, 132, 50)} hrefFor={hrefFor} />);
    expect(middle).toContain('href="/pulse?page=1"');
    expect(middle).toContain('href="/pulse?page=3"');

    const last = renderToStaticMarkup(<Pager info={pageInfo(3, 132, 50)} hrefFor={hrefFor} />);
    expect(last).toContain("Previous");
    expect(last).not.toContain("Next");
  });

  it("uses the caller's words for a log: Newer and Older", () => {
    const html = renderToStaticMarkup(<Pager info={pageInfo(2, 132, 50)} hrefFor={hrefFor} previousLabel="Newer" nextLabel="Older" />);
    expect(html).toContain("Newer");
    expect(html).toContain("Older");
  });
});
