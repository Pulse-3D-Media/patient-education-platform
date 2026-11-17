import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VIDEO_CHIP_ALPHA } from "@/lib/branding";
import { ClinicMark, DEFAULT_PICTURE_RATIO, pictureRatio } from "./ClinicMark";

/**
 * The clinic and the doctor on the video (ClinicMark), as the server first
 * sends it: since the November 2026 refresh, the logo (round until it has
 * loaded and said its shape) and one slim chip with the doctor's name, the
 * title only in full screen. No database. Which shape a loaded logo takes is
 * logoShape() (player-rules.test.ts); that it fades with the controls is
 * PlayerOverlay's (VideoPlayer.test.tsx renders it); that the chips' words
 * are readable is lib/branding.test.ts; how a wide wordmark looks is a
 * browser check (screenshots in the pull request).
 */

const LOGO = "https://example.com/summit-square.png";
const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");

describe("what is in the mark", () => {
  it("the logo in its round frame until it has loaded, then the doctor's name alone on one slim chip", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" senderName="Dr. Jane Smith, DO" />);

    expect(html).toContain('data-logo-shape="round"');
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/summit-square\.png"[^>]*class="[^"]*object-cover[^"]*object-center/);
    expect(html).toContain("h-10 w-10 rounded-full");
    expect(html.match(/class="video-chip /g)).toHaveLength(1);
    expect(html).toMatch(/class="video-chip [^"]*rounded-full[^"]*">Dr\. Jane Smith, DO<\/span>/);
    expect(html).not.toContain("Sent by");
    expect(html.indexOf(LOGO)).toBeLessThan(html.indexOf("Dr. Jane Smith"));
  });

  it("the title only when it is asked for (full screen), on its own chip above the doctor's", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" title="Total Knee Replacement" senderName="Dr. Jane Smith, DO" />);

    expect(html).toMatch(/class="video-chip [^"]*">Total Knee Replacement<\/span>/);
    expect(html.indexOf("Total Knee Replacement")).toBeLessThan(html.indexOf("Dr. Jane Smith"));
    expect(renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" title={null} senderName="Dr. Jane Smith, DO" />)).not.toContain("Total Knee");
  });

  it("the logo gets a white backing only once it has loaded, so the initials show until then (and if it never loads)", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit Orthopedics" />);

    expect(html).toMatch(/<img[^>]*class="[^"]*opacity-0 bg-white/);
    expect(html).toContain(">SO</span>");
  });

  it("no logo: the clinic's initials in the round frame", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" senderName="Jane Smith, PA-C" />);

    expect(html).toContain('data-logo-shape="initials"');
    expect(html).not.toContain("<img");
    expect(html).toContain(">SO</span>");
    expect(html).toContain(">Jane Smith, PA-C<");
  });

  it("no doctor recorded: the clinic's name on the chip", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit Orthopedics" senderName={null} />);

    expect(html).toMatch(/class="video-chip [^"]*">Summit Orthopedics<\/span>/);
  });

  it("keeps each chip to one line: a long title or name ends in ... (the page writes both in full)", () => {
    // Both chips, as in full screen.
    const html = renderToStaticMarkup(
      <ClinicMark logoUrl={null} name="Summit" title="Total Knee Replacement With a Very Long Name Indeed" senderName="Dr. Maria de los Angeles Fernandez-Castillo, DPM" />,
    );

    expect(html.match(/class="video-chip max-w-full truncate /g)).toHaveLength(2);
  });

  it("is hidden from screen readers, because the page already says all of it in words", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={LOGO} name="Summit" title="Total Knee Replacement" senderName="Dr. Jane Smith, DO" />);

    expect(html).toMatch(/^<div data-video-strip="" aria-hidden="true"/);
  });

  it("keeps the patient page's smallest text at 15px or more", () => {
    const html = renderToStaticMarkup(<ClinicMark logoUrl={null} name="Summit" title="Total Knee Replacement" senderName="Dr. Jane Smith, DO" />);
    const sizes = [...html.matchAll(/text-\[(\d+)px\]/g)].map(([, px]) => Number(px));

    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(15);
  });
});

describe("the CSS it relies on (app/globals.css)", () => {
  it("draws the chips black at the agreed darkness", () => {
    expect(CSS).toContain(`.video-chip {\n  background: rgb(0 0 0 / ${VIDEO_CHIP_ALPHA});\n}`);
  });

  it("shows a wide logo whole on a small white tag, sized by the logo's own shape and never wider than 112px on a phone", () => {
    expect(CSS).toContain(".mark-wide {\n  height: 32px;\n  width: min(112px, calc(24px * var(--logo-ratio, 3) + 14px));\n}");
    expect(CSS).toContain("@container (min-width: 36rem) {\n  .mark-wide {\n    height: 40px;\n    width: min(160px, calc(32px * var(--logo-ratio, 3) + 14px));");
  });

  it("finds the picture inside the video's box, so the mark sits on the picture, not on black bars", () => {
    expect(CSS).toContain(".picture-fit {\n  position: absolute;\n  inset: 0;\n}");
    expect(CSS).toContain("width: min(100cqw, 100cqh * var(--picture-ratio, 1.7778));");
    expect(CSS).toContain("height: min(100cqh, 100cqw / var(--picture-ratio, 1.7778));");
  });

  it("no longer has the strip above the picture, or anything taking the browser's own full-screen button away", () => {
    expect(CSS).not.toContain(".video-strip");
    expect(CSS).not.toContain(".picture-unit");
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
