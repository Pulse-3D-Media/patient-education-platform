import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VIDEO_STRIP_GROUND, VIDEO_STRIP_INK } from "@/lib/branding";
import { ClinicMark, DEFAULT_PICTURE_RATIO, pictureRatio } from "./ClinicMark";

/**
 * The strip on the video (ClinicMark), as the server first sends it, and the
 * CSS that lays it out (app/globals.css, .video-strip and .picture-unit). No
 * database. Since option C (Evan, 2026-10-15) it is a slim row ABOVE the
 * picture: what it holds in every case the two players ask for (a logo or
 * the clinic's name, who sent it or nobody, the placeholder chip, the
 * library's Close). That its words are readable is in lib/branding.test.ts;
 * how it looks at each width is a browser check (screenshots in the pull
 * request).
 */

const LOGO = "https://example.com/summit-white.png";
const LONG_CLINIC = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";
const LONG_SENDER = "Dr. Maria de los Angeles Fernandez-Castillo, DPM";

/** The rules for one selector in app/globals.css, the first block that starts with it. */
const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}", at));
}
/** An @supports (width: 1cqw) block that starts with this selector: only a browser that can measure a box reads it. */
function supportsBlock(firstSelector: string): string {
  const at = CSS.indexOf(`@supports (width: 1cqw) {\n  ${firstSelector} {`);
  expect(at, `no @supports block starting with ${firstSelector}`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("\n}\n", at));
}

describe("what is on the strip", () => {
  it("a logo and a sender: the logo first, then the doctor's name alone", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName="Dr. Jane Smith, DO" />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('<span aria-hidden="true" class="video-strip-sender">Dr. Jane Smith, DO</span>');
    // Just the name, no "Sent by" (decided by Evan on 2026-10-05).
    expect(html).not.toContain("Sent by");
    expect(html.indexOf(LOGO)).toBeLessThan(html.indexOf("Dr. Jane Smith"));
  });

  it("a logo with no sender recorded: the logo only, and no name", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName={null} />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).not.toContain("video-strip-sender");
  });

  it("no logo: the clinic's name in its place, then the sender", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" senderName="Jane Smith, PA-C" />);

    expect(html).not.toContain("<img");
    expect(html).toContain('<span class="video-strip-clinic block truncate">Summit Orthopedics</span>');
    expect(html).toContain(">Jane Smith, PA-C<");
  });

  it("no logo and no sender: just the clinic's name, nothing at the right end", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" />);

    expect(html).toContain(">Summit Orthopedics<");
    expect(html).not.toContain("video-strip-sender");
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

    expect(html).toMatch(/<span class="video-strip-end"><span class="[^"]*bg-\[#f3b94d\][^"]*">Placeholder animation<\/span><\/span><\/div>$/);
  });

  it("the library's Close at the right end, after the chip", () => {
    const html = renderToStaticMarkup(
      <ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" placeholder action={<button type="button">Close</button>} />,
    );

    expect(html).toMatch(/Placeholder animation<\/span><button type="button">Close<\/button><\/span><\/div>$/);
  });

  it("long names are kept to the one line: the clinic's cut short, the doctor's ends in ... (the page writes both in full)", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name={LONG_CLINIC} senderName={LONG_SENDER} />);

    expect(html).toContain('<span class="video-strip-clinic block truncate">The Intermountain');
    expect(rule(".video-strip-sender")).toContain("white-space: nowrap");
    expect(rule(".video-strip-sender")).toContain("text-overflow: ellipsis");
    expect(rule(".video-strip-brand")).toContain("max-width: 45%");
  });
});

describe("how the strip sits", () => {
  it("is a row of its own, in the page's flow, never laid over the picture and never taking taps away from it", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" />);

    expect(html).toBe('<div data-video-strip="" class="video-strip w-full shrink-0 select-none"><span aria-hidden="true" class="video-strip-brand"><span class="video-strip-clinic block truncate">Summit</span></span></div>');
    expect(html).not.toContain("absolute");
  });

  it("puts the logo on the row with no chip, box, border or shadow behind it", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" />);

    expect(html).not.toMatch(/bg-white(?!\/)/);
    expect(html).not.toContain("shadow");
    expect(html).not.toContain("border");
    expect(html).not.toContain("rounded");
  });

  it("hides the logo and names from screen readers (they are on the page already), keeping the chip readable", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" placeholder />);

    expect(html).toMatch(/<span aria-hidden="true" class="video-strip-brand">.*summit-white\.png/);
    expect(html).toContain('<span aria-hidden="true" class="video-strip-sender">');
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>Placeholder/);
  });
});

describe("the strip's CSS (app/globals.css)", () => {
  it("is one slim line, a fixed --strip-h tall, on the player's black, in light grey", () => {
    const css = rule(".video-strip");

    expect(CSS).toContain(":root {\n  --strip-h: 2.75rem;\n}");
    expect(css).toContain("height: var(--strip-h)");
    expect(css).toContain(`background: ${VIDEO_STRIP_GROUND}`);
    expect(css).toContain(`color: ${VIDEO_STRIP_INK}`);
    expect(css).toContain("container-type: inline-size");
    // Subtle: no wash over the picture, no shadow on the words.
    expect(css).not.toContain("gradient");
    expect(css).not.toContain("text-shadow");
  });

  it("draws the doctor's name small (Evan, 2026-10-15: the twice-as-big name was too big on a phone): 15px, growing to 18px", () => {
    // A plain size for a browser that cannot measure a box, and the one that grows only where it can (the build's
    // minifier keeps just the last of two sizes in one rule, so they are kept apart).
    expect(rule(".video-strip-sender")).toContain("font-size: 15px;");
    expect(rule(".video-strip-sender")).not.toContain("cqw");
    expect(supportsBlock(".video-strip-logo")).toContain(".video-strip-clinic,\n  .video-strip-sender {\n    font-size: clamp(15px, 0.75rem + 0.6cqw, 18px);");
    expect(supportsBlock(".video-strip-logo")).toContain(".video-strip-logo {\n    height: clamp(20px, 0.75rem + 1.2cqw, 26px);");
  });

  it("keeps the library's strip and picture together as one unit, the strip right on top of the picture", () => {
    const unit = supportsBlock(".picture-area");

    expect(unit).toContain("--unit-w: min(100cqw, (100cqh - var(--strip-h)) * var(--picture-ratio, 1.7778));");
    expect(unit).toContain("height: calc(var(--unit-w) / var(--picture-ratio, 1.7778) + var(--strip-h));");
    // Without box measuring: the unit is the whole space, a column with the strip on top.
    expect(rule(".picture-unit")).toContain("flex-direction: column");
  });

  it("no longer takes the browser's own full-screen button away (the patient player uses it)", () => {
    expect(CSS).not.toContain("-webkit-media-controls-fullscreen-button");
  });
});

describe("the picture's shape", () => {
  it("takes the shape from the file, and 16:9 until the file says or when it says something useless", () => {
    expect(pictureRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(pictureRatio(1440, 1080)).toBeCloseTo(4 / 3);
    expect(pictureRatio(undefined, undefined)).toBe(DEFAULT_PICTURE_RATIO);
    expect(pictureRatio(0, 0)).toBe(DEFAULT_PICTURE_RATIO);
    expect(pictureRatio(1920, 0)).toBe(DEFAULT_PICTURE_RATIO);
    expect(DEFAULT_PICTURE_RATIO).toBeCloseTo(16 / 9);
  });
});
