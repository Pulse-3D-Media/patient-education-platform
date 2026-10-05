import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VIDEO_STRIP_ALPHA } from "@/lib/branding";
import { ClinicMark, DEFAULT_PICTURE_RATIO, OnPicture, pictureRatio } from "./ClinicMark";

/**
 * The strip on the video (ClinicMark), as the server first sends it. No
 * database. What it holds in every case the two players ask for: a logo or
 * the clinic's name, who sent it or nobody, and the placeholder chip. That
 * white words stay readable on the band is in lib/branding.test.ts; that it
 * lands on the picture's top edge and does not cover a control is a browser
 * check (screenshots in the pull request).
 */

const LOGO = "https://example.com/summit-white.png";
const LONG_NAME = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";

/** The strip's own element: everything inside the outer div that carries data-video-strip. */
function strip(html: string): string {
  const start = html.indexOf("data-video-strip");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

describe("what is on the strip", () => {
  it("a logo and a sender: the logo straight on the band, then 'Sent by' and the name", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName="Dr. Jane Smith, DO" />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain(">Sent by Dr. Jane Smith, DO<");
    // The logo comes first, then the name.
    expect(html.indexOf(LOGO)).toBeLessThan(html.indexOf("Sent by"));
  });

  it("a logo with no sender recorded: the logo only, and no 'Sent by'", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName={null} />);

    expect(html).toContain(`src="${LOGO}"`);
    expect(html).not.toContain("Sent by");
  });

  it("no logo: the clinic's name in white text, then the sender", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" senderName="Jane Smith, PA-C" />);

    expect(html).not.toContain("<img");
    expect(html).toMatch(/<span class="[^"]*text-white[^"]*">Summit Orthopedics<\/span>/);
    expect(html).toContain(">Sent by Jane Smith, PA-C<");
  });

  it("no logo and no sender: just the clinic's name", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" />);

    expect(html).toContain(">Summit Orthopedics<");
    expect(html).not.toContain("Sent by");
    expect(html).not.toContain("Placeholder");
  });

  it("a logo that has not loaded (or never will) has the clinic's name standing in, in white, in a box of fixed size", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" />);

    expect(html).toContain("h-6 w-24");
    expect(html).toMatch(/<span class="truncate [^"]*text-white[^"]*">Summit Orthopedics<\/span>/);
    expect(html).toMatch(/<img[^>]*opacity-0/);
  });

  it("a placeholder: the amber chip rides on the same band, and a screen reader hears it", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" senderName="Dr. Jane Smith, DO" placeholder />);

    expect(html).toContain("Placeholder animation");
    expect(html).toContain("bg-[#f3b94d]");
    // The chip is not inside the part screen readers skip.
    expect(html).toMatch(/<\/span><span class="[^"]*bg-\[#f3b94d\][^"]*">Placeholder animation<\/span><\/div>$/);
  });

  it("never grows past its 32px: a very long clinic name is cut short on one line, and a long sender takes at most two lines", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name={LONG_NAME} senderName="Dr. Maria de los Angeles Fernandez-Castillo, DPM" />);

    expect(html).toMatch(/<span class="max-w-\[45%\] shrink-0 truncate [^"]*">The Intermountain/);
    expect(html).toMatch(/<span class="line-clamp-2 min-w-0 break-words leading-none [^"]*">Sent by Dr. Maria/);
    // Two lines of 15px with no extra spacing are 30px, inside the 32px band.
    expect(2 * 15).toBeLessThan(32);
    expect(html).toContain("h-8");
  });
});

describe("how the strip sits", () => {
  it("is a 32px band of black at the agreed opacity, laid across the top edge, and never takes a tap", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" />);

    expect(html).toMatch(/^<div data-video-strip="" class="pointer-events-none [^"]*h-8[^"]*absolute inset-x-0 top-0/);
    expect(html).toContain(`background-color:rgba(0, 0, 0, ${VIDEO_STRIP_ALPHA})`);
  });

  it("puts the logo on the band with no chip, box, border or shadow behind it", () => {
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

    expect(hidden).toContain("Sent by Dr. Jane Smith, DO");
    expect(hidden).toContain(LOGO);
  });

  it("becomes a row of its own where there is no picture to lay it over", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" senderName="Dr. Jane Smith, DO" inFlow />);

    expect(html).toContain("relative shrink-0");
    expect(html).not.toContain("absolute inset-x-0 top-0");
    expect(html).toContain("Sent by Dr. Jane Smith, DO");
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
