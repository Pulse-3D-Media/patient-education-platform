import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VIDEO_STRIP_ALPHA, VIDEO_STRIP_MIN_TEXT_PX } from "@/lib/branding";
import { ClinicMark, DEFAULT_PICTURE_RATIO, LONG_NAME, OnPicture, pictureRatio } from "./ClinicMark";

/**
 * The strip on the video (ClinicMark), as the server first sends it, and the
 * CSS that lays it out (app/globals.css, .video-strip). No database. What it
 * holds in every case the two players ask for: a logo or the clinic's name,
 * who sent it or nobody, the placeholder chip, and the patient player's
 * full-screen button. That white words stay readable on the wash is in
 * lib/branding.test.ts; that it lands on the picture's top edge, how tall it
 * comes out and that it does not cover a control are browser checks
 * (screenshots in the pull request).
 */

const LOGO = "https://example.com/summit-white.png";
const LONG_CLINIC = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";
/** 48 characters: the longest name the rules file promises to show in full on a phone. */
const LONGEST_PROMISED = "Dr. Maria de los Angeles Fernandez-Castillo, DPM";

/** The strip's own element: everything inside the outer div that carries data-video-strip. */
function strip(html: string): string {
  const start = html.indexOf("data-video-strip");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

/** The rules for one class in app/globals.css, the first block that starts with it (outside any @container rule unless asked). */
const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
function rule(selector: string, from = 0): string {
  const at = CSS.indexOf(`\n${selector} {`, from);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}", at));
}
/** The block of growing sizes: only a browser that can measure a box reads it (a plain size outside it serves the rest). */
function growingSizes(): string {
  const at = CSS.indexOf("@supports (width: 1cqw) {\n  .video-strip-logo {");
  expect(at, "no @supports block for the strip's sizes").toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}\n", at));
}
function containerBlock(minWidth: string): string {
  const at = CSS.indexOf(`@container (min-width: ${minWidth}) {`);
  expect(at, `no @container rule at ${minWidth}`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}\n", at));
}

describe("what is on the strip", () => {
  it("a logo and a sender: the logo straight on the wash, then the doctor's name alone", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName="Dr. Jane Smith, DO" />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toMatch(/<span aria-hidden="true" class="video-strip-sender">Dr. Jane Smith, DO<\/span>/);
    // Just the name, no "Sent by" (decided by Evan on 2026-10-05).
    expect(html).not.toContain("Sent by");
    // The logo comes first, then the name.
    expect(html.indexOf(LOGO)).toBeLessThan(html.indexOf("Dr. Jane Smith"));
  });

  it("a logo with no sender recorded: the logo only, and no name", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName={null} />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).not.toContain("video-strip-sender");
  });

  it("no logo: the clinic's name in the strip's own words, then the sender", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" senderName="Jane Smith, PA-C" />);

    expect(html).not.toContain("<img");
    expect(html).toContain('<span class="video-strip-clinic block truncate">Summit Orthopedics</span>');
    expect(html).toContain(">Jane Smith, PA-C<");
  });

  it("no logo and no sender: just the clinic's name", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" />);

    expect(html).toContain(">Summit Orthopedics<");
    expect(html).not.toContain("video-strip-sender");
    expect(html).not.toContain("Placeholder");
    expect(html).not.toContain("video-strip-end");
  });

  it("a logo that has not loaded (or never will) has the clinic's name standing in, in a box of fixed size", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" />);

    expect(html).toContain("video-strip-logo shrink-0");
    expect(html).toMatch(/<span class="truncate video-strip-clinic">Summit Orthopedics<\/span>/);
    expect(html).toMatch(/<img[^>]*opacity-0/);
  });

  it("a placeholder: the amber chip rides at the right end, and a screen reader hears it", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" placeholder />);

    expect(html).toContain("Placeholder animation");
    expect(html).toContain("bg-[#f3b94d]");
    // The chip is in the right-hand end, not inside the part screen readers skip.
    expect(html).toMatch(/<span class="video-strip-end"><span class="[^"]*bg-\[#f3b94d\][^"]*">Placeholder animation<\/span><\/span><\/div><\/div>$/);
  });

  it("marks a name longer than LONG_NAME characters, so it is drawn a step smaller; an ordinary one is not", () => {
    expect(LONG_NAME).toBe(28);
    const long = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" senderName={LONGEST_PROMISED} />);
    const short = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" senderName="Dr. Jane Smith, DO" />);
    const edge = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" senderName={"x".repeat(LONG_NAME)} />);

    expect(LONGEST_PROMISED).toHaveLength(48);
    expect(long).toContain('data-long="true"');
    expect(short).not.toContain("data-long");
    expect(edge).not.toContain("data-long");
  });

  it("a very long clinic name is cut short on one line rather than pushing anything", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name={LONG_CLINIC} senderName={LONGEST_PROMISED} />);

    expect(html).toMatch(/<span class="video-strip-clinic block truncate">The Intermountain/);
  });
});

describe("our own control on the strip", () => {
  it("sits at the right end, after the words, and is the only part that takes a tap", () => {
    const html = renderToStaticMarkup(
      <ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" action={<button type="button">Full screen</button>} />,
    );

    expect(html).toMatch(/^<div data-video-strip="" class="video-strip pointer-events-none /);
    expect(html).toMatch(/<span class="video-strip-end"><span class="pointer-events-auto"><button type="button">Full screen<\/button><\/span><\/span><\/div><\/div>$/);
    // It is laid out beside the words (its own grid area), never on top of them.
    expect(html.indexOf("Dr. Jane Smith")).toBeLessThan(html.indexOf("Full screen"));
    expect(html.match(/pointer-events-auto/g)).toHaveLength(1);
  });

  it("is not there when none is asked for (before the first play, in the library)", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" action={null} />);

    expect(html).not.toContain("pointer-events-auto");
    expect(html).not.toContain("video-strip-end");
  });
});

describe("how the strip sits", () => {
  it("is laid across the top edge, carries the agreed darkness for the wash, and never takes a tap", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" />);

    expect(html).toMatch(/^<div data-video-strip="" class="video-strip pointer-events-none z-10 w-full select-none absolute inset-x-0 top-0"/);
    expect(html).toContain(`style="--strip-alpha:${VIDEO_STRIP_ALPHA}"`);
  });

  it("puts the logo on the wash with no chip, box, border or shadow behind it", () => {
    const html = strip(renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" />));
    const beforeChip = html.split("Placeholder")[0];

    expect(beforeChip).not.toMatch(/bg-white(?!\/)/);
    expect(beforeChip).not.toContain("shadow");
    expect(beforeChip).not.toContain("border");
    expect(beforeChip).not.toContain("rounded");
  });

  it("hides the logo and names from screen readers (they are on the page already), keeping the chip readable", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" placeholder />);
    const hidden = html.slice(html.indexOf('aria-hidden="true"'), html.indexOf("Placeholder animation"));

    expect(hidden).toContain("Dr. Jane Smith, DO");
    expect(hidden).toContain(LOGO);
    expect(html).toMatch(/<span aria-hidden="true" class="video-strip-sender">/);
  });

  it("becomes a row of its own where there is no picture to lay it over", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" senderName="Dr. Jane Smith, DO" inFlow />);

    expect(html).toContain("relative shrink-0");
    expect(html).not.toContain("absolute inset-x-0 top-0");
    expect(html).toContain("Dr. Jane Smith, DO");
  });
});

describe("the strip's CSS (app/globals.css)", () => {
  it("is a soft wash, not a solid bar: darkest at the top, the agreed darkness under the words, then nothing", () => {
    const css = rule(".video-strip");

    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("rgb(0 0 0 / calc(var(--strip-alpha, 0.5) + 0.1)) 0");
    expect(css).toContain("rgb(0 0 0 / var(--strip-alpha, 0.5)) calc(100% - 0.875rem)");
    expect(css).toContain("rgb(0 0 0 / 0) 100%");
    // The fade happens in the strip's own padding, below the words, so the words always sit on the agreed darkness.
    expect(css).toContain("padding-bottom: 0.875rem");
    expect(css).toContain("text-shadow");
    expect(String(VIDEO_STRIP_ALPHA)).toBe("0.5");
  });

  it("draws the doctor's name about twice the old 15px, growing with the picture, two lines at most", () => {
    const css = rule(".video-strip-sender");

    // A plain size for a browser that cannot measure a box, and the one that grows (26px on a phone, 32px at most) only
    // where it can: the build's minifier keeps just the last of two sizes in one rule, so they are kept apart.
    expect(css).toContain("font-size: 26px;");
    expect(css).not.toContain("cqw");
    expect(growingSizes()).toContain(".video-strip-sender {\n    font-size: clamp(26px, 1rem + 3cqw, 32px);");
    expect(css).toContain("font-weight: 700");
    expect(css).toContain("-webkit-line-clamp: 2");
    expect(26 / 15).toBeGreaterThan(1.7);
    expect(32 / 15).toBeGreaterThan(2);
  });

  it("draws a long name a step smaller, never below the large-text size the contrast sums rely on", () => {
    const long = rule(".video-strip-sender[data-long]");
    const clinic = rule(".video-strip-clinic");

    expect(growingSizes()).toContain(`.video-strip-sender[data-long] {\n    font-size: clamp(${VIDEO_STRIP_MIN_TEXT_PX.sender}px, 0.75rem + 2.4cqw, 26px);`);
    expect(growingSizes()).toContain(`.video-strip-clinic {\n    font-size: clamp(${VIDEO_STRIP_MIN_TEXT_PX.clinic}px, 0.75rem + 2cqw, 24px);`);
    // The plain sizes for an older browser are not below those floors either.
    expect(long).toContain("font-size: 22px;");
    expect(clinic).toContain("font-size: 20px;");
    expect(clinic).toContain("font-weight: 700");
    // WCAG's large text: at least 18.66px when bold.
    expect(VIDEO_STRIP_MIN_TEXT_PX.sender).toBeGreaterThanOrEqual(18.66);
    expect(VIDEO_STRIP_MIN_TEXT_PX.clinic).toBeGreaterThanOrEqual(18.66);
  });

  it("puts the name on a line of its own on a narrow picture, and everything on one line from 44rem", () => {
    expect(rule(".video-strip-row")).toContain('"brand end"\n    "sender sender"');
    expect(containerBlock("44rem")).toContain('grid-template-areas: "brand sender end"');
    // The word beside the full-screen icon only where there is room for it.
    expect(rule(".video-strip-wide-only")).toContain("display: none");
    expect(containerBlock("30rem")).toContain(".video-strip-wide-only {\n    display: inline;");
  });

  it("takes Chromium's own full-screen button out of the patient player's bar, leaving ours the only one", () => {
    expect(CSS).toContain(".patient-video::-webkit-media-controls-fullscreen-button {\n  display: none;\n}");
  });
});

describe("the box over the picture", () => {
  it("measures the video's box and carries the video's shape, and never takes a tap", () => {
    const html = renderToStaticMarkup(
      <OnPicture ratio={4 / 3}>
        <ClinicMark logoUrl={null} name="Summit" />
      </OnPicture>,
    );

    expect(html).toMatch(/^<div class="picture-area pointer-events-none absolute inset-0 z-10" style="--picture-ratio:1.333/);
    expect(html).toContain('<div class="picture-fit">');
  });

  it("takes the shape from the file, and 16:9 until the file says or when it says something useless", () => {
    expect(pictureRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(pictureRatio(1440, 1080)).toBeCloseTo(4 / 3);
    expect(pictureRatio(undefined, undefined)).toBe(DEFAULT_PICTURE_RATIO);
    expect(pictureRatio(0, 0)).toBe(DEFAULT_PICTURE_RATIO);
    expect(pictureRatio(1920, 0)).toBe(DEFAULT_PICTURE_RATIO);
    expect(DEFAULT_PICTURE_RATIO).toBeCloseTo(16 / 9);
  });
});
