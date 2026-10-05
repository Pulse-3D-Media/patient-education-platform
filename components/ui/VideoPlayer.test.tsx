import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { libraryStripName } from "@/lib/sender-name";
import { VideoPlayer } from "./VideoPlayer";

/**
 * The library's player as the server would first draw it, for the strip on
 * the picture. The player only opens after a tap in the browser, so the
 * category page's own render never contains it; this renders it directly,
 * with what the category page hands it (libraryStripName() decides the
 * name, from the signed-in person's seat). No database, no Clerk.
 *
 * That the strip lands on the picture's top edge, that the title row sits
 * under it, and that nothing covers a control are browser checks.
 */

function render(props: Partial<Parameters<typeof VideoPlayer>[0]> = {}): string {
  return renderToStaticMarkup(
    <VideoPlayer src="https://example.com/knee.mp4" title="Total Knee Replacement" subtitle="Knee" clinicName="Summit Orthopedics" onClose={() => {}} {...props} />,
  );
}

describe("the strip on the library's player", () => {
  it("someone holding a seat: the clinic's logo and their name as patients see it", () => {
    const senderName = libraryStripName({ displayName: "Dr. Jane Smith, DO" }, "Dr. Jane Smith");
    const html = render({ logoUrl: "https://example.com/summit-white.png", senderName });

    expect(html).toContain("data-video-strip");
    expect(html).toContain('src="https://example.com/summit-white.png"');
    expect(html).toContain(">Sent by Dr. Jane Smith, DO<");
  });

  it("someone holding a seat that nobody named: 'Dr. First Last' from Clerk", () => {
    const html = render({ senderName: libraryStripName({ displayName: null }, "Dr. Jane Smith") });

    expect(html).toContain(">Sent by Dr. Jane Smith<");
  });

  it("someone without a seat: only the clinic, because they send no links", () => {
    const senderName = libraryStripName(null, "Dr. Jane Smith");
    const html = render({ logoUrl: null, senderName });

    expect(senderName).toBeNull();
    expect(html).toContain(">Summit Orthopedics<");
    expect(html).not.toContain("Sent by");
  });

  it("a placeholder: the amber chip is on the same strip, on the picture", () => {
    const html = render({ placeholder: true, senderName: "Dr. Jane Smith, DO" });
    const stripPart = html.slice(html.indexOf("data-video-strip"));

    expect(stripPart).toContain("Placeholder animation");
    expect(html.match(/Placeholder animation/g)).toHaveLength(1);
  });

  it("lays the strip over the picture inside the video's box, not in a row above it", () => {
    const html = render();

    // The video's box is measured (picture-area) and carries the video's shape, 16:9 until the file says.
    expect(html).toMatch(/<div class="picture-area relative min-h-0 flex-1" style="--picture-ratio:1.777/);
    // The strip is inside that box, in the box over the picture, before the video's controls.
    const area = html.slice(html.indexOf("picture-area"));
    expect(area.indexOf('class="picture-fit pointer-events-none"')).toBeGreaterThan(-1);
    expect(area.indexOf("data-video-strip")).toBeGreaterThan(area.indexOf("picture-fit"));
    // Nothing is drawn above the video's box any more.
    expect(html.indexOf("data-video-strip")).toBeGreaterThan(html.indexOf("picture-area"));
  });

  it("starts the title row, with Close, under the strip, so the two never overlap", () => {
    const html = render();

    expect(html).toMatch(/class="below-picture-top absolute inset-x-0 top-10 [^"]*"><div class="min-w-0"><h2[^>]*>Total Knee Replacement</);
    expect(html.indexOf("data-video-strip")).toBeLessThan(html.indexOf('aria-label="Close the video and go back to the library"'));
  });
});

describe("libraryStripName", () => {
  it("is the chosen name, else the default, for someone with a seat, and nothing without one", () => {
    expect(libraryStripName({ displayName: "Jane Smith, NP" }, "Dr. Jane Smith")).toBe("Jane Smith, NP");
    expect(libraryStripName({ displayName: null }, "Dr. Jane Smith")).toBe("Dr. Jane Smith");
    expect(libraryStripName({ displayName: null }, null)).toBeNull();
    expect(libraryStripName(null, "Dr. Jane Smith")).toBeNull();
    expect(libraryStripName(null, null)).toBeNull();
  });
});
