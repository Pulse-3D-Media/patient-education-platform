import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClinicLogo } from "./ClinicLogo";

/**
 * The clinic's logo in its box, as the server first sends it:
 * before the browser knows whether the picture will load. That first state
 * is the one that matters for "a slow or broken logo moves nothing",
 * because it is what is on screen while the picture is slow, and what stays
 * on screen if it never arrives. No database.
 *
 * The switch to the picture once it has loaded, and staying on the name
 * when it fails, happen in the browser and are checked there.
 */

const LONG_NAME = "The Intermountain Center for Advanced Orthopedic, Spine and Sports Medicine Surgery of Greater Salt Lake";

describe("ClinicLogo", () => {
  it("starts with the clinic's name showing and the picture invisible, inside a box of the size it was given", () => {
    const html = renderToStaticMarkup(<ClinicLogo src="https://example.com/logo.png" name="Summit Orthopedics" boxClassName="h-6 w-[116px]" />);

    expect(html).toContain("h-6 w-[116px]");
    expect(html).toContain(">Summit Orthopedics<");
    expect(html).toMatch(/<img[^>]*opacity-0/);
  });

  it("asks for the picture quietly: low priority, decoded off the main path, and without sending the page's address along", () => {
    const html = renderToStaticMarkup(<ClinicLogo src="https://example.com/logo.png" name="Summit" boxClassName="h-6 w-24" />);

    expect(html).toContain('fetchPriority="low"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("shows no name where the caller says it is already written beside it, but keeps the box", () => {
    const html = renderToStaticMarkup(<ClinicLogo src="https://example.com/logo.png" name="Summit Orthopedics" boxClassName="h-11 w-[220px]" fallback="blank" />);

    expect(html).toContain("h-11 w-[220px]");
    expect(html).not.toContain("Summit Orthopedics<");
  });

  it("is just the name when the clinic has no logo, with no picture requested at all", () => {
    const html = renderToStaticMarkup(<ClinicLogo src={null} name="Summit Orthopedics" boxClassName="h-6 w-24" />);

    expect(html).toContain("Summit Orthopedics");
    expect(html).not.toContain("<img");
  });

  it("cuts a very long name short inside the box instead of growing", () => {
    const html = renderToStaticMarkup(<ClinicLogo src={null} name={LONG_NAME} boxClassName="h-6 w-24" />);

    expect(html).toContain("overflow-hidden");
    expect(html).toContain("truncate");
  });

  it("is skipped by screen readers: the name is always on the page as text or a label already", () => {
    const html = renderToStaticMarkup(<ClinicLogo src="https://example.com/logo.png" name="Summit" boxClassName="h-6 w-24" />);

    expect(html).toMatch(/^<span aria-hidden="true"/);
    expect(html).toContain('alt=""');
  });
});

