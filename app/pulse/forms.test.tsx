import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NOTE_MAX_LENGTH } from "@/lib/note-form";
import { pageInfo } from "@/lib/paging";
import { SETTINGS_DEFAULTS } from "@/lib/settings-defaults";
import { DetailsForm, NoteForm, StatusForm } from "./clinics/[id]/forms";
import { SettingsForm } from "./settings/SettingsForm";
import { Pager } from "./ui";

/**
 * Dashboard pieces as the server first draws them, with the Server Actions
 * as stand-ins (no Clerk, no database): the settings form says which number
 * is not active yet, the note box has its limit and its counter, every form
 * with something to lose keeps what was typed, and the pager draws the right
 * links. Typing and saving are checked in a browser; the rules behind them
 * are in lib/note-form.test.ts and lib/form-save.test.ts.
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

/**
 * Every form on /pulse keeps what was typed (useKeptForm in FormBits.tsx).
 * Whether a browser really keeps the boxes is a browser check; what can be
 * checked here is that no form with something to lose was left on React's
 * plain useActionState, which empties the boxes after every send.
 */
describe("forms that keep what was typed", () => {
  /** Every browser file under app/pulse (no tests). */
  function clientFiles(dir: string): { path: string; text: string }[] {
    const found: { path: string; text: string }[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) found.push(...clientFiles(path));
      else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
        const text = readFileSync(path, "utf8");
        if (/^\s*"use client"/.test(text)) found.push({ path: path.replace(/\\/g, "/"), text });
      }
    }
    return found;
  }

  it("every /pulse form whose boxes start from saved values goes through useKeptForm", () => {
    // "defaultValue" and "defaultChecked" mark a box React would put back to its starting value.
    const withSomethingToLose = clientFiles("app/pulse").filter(({ text }) => /defaultValue=|defaultChecked=/.test(text));
    expect(withSomethingToLose.map(({ path }) => path).sort()).toEqual([
      "app/pulse/clinics/[id]/forms.tsx",
      "app/pulse/settings/SettingsForm.tsx",
      "app/pulse/videos/CategoryConfigForm.tsx",
      "app/pulse/videos/VideoForm.tsx",
    ]);
    for (const { path, text } of withSomethingToLose) {
      expect(text, path).toContain("useKeptForm(");
      // A Server Action handed straight to useActionState is the pattern that loses the draft.
      expect(text, path).not.toMatch(/useActionState\(\w+Action,/);
    }
  });

  it("the hook declines the reset React asks for, and answers a thrown save in plain words", () => {
    const text = readFileSync("app/pulse/FormBits.tsx", "utf8");
    expect(text).toContain("onReset: declineReset");
    expect(text).toContain("event.preventDefault()");
    expect(text).toContain("safeSave(");
    expect(text).toContain("unstable_rethrow");
  });

  it("the forms still draw their saved values to start from", () => {
    const details = renderToStaticMarkup(
      <DetailsForm clinicId="clinic_1" values={{ name: "Summit Orthopedics", noticeText: "Welcome", showPlaceholders: true, viewDaysOverride: 10, platformViewDays: 7 }} />,
    );
    expect(details).toContain('value="Summit Orthopedics"');
    expect(details).toContain('value="Welcome"');
    expect(details).toContain('value="10"');

    const status = renderToStaticMarkup(<StatusForm clinicId="clinic_1" staffAccess="PAUSED" />);
    // The reason starts empty, and the choice starts on what is set.
    expect(status).toMatch(/<input[^>]*name="reason"[^>]*value=""/);
    expect(status).toMatch(/<input[^>]*value="PAUSED"[^>]*checked=""|<input[^>]*checked=""[^>]*value="PAUSED"/);
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
