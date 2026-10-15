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
    <VideoPlayer source={{ kind: "file", src: "https://example.com/knee.mp4" }} title="Total Knee Replacement" subtitle="Knee" clinicName="Summit Orthopedics" onClose={() => {}} {...props} />,
  );
}

describe("the strip on the library's player", () => {
  it("someone holding a seat: the clinic's logo and their name as patients see it", () => {
    const senderName = libraryStripName({ displayName: "Dr. Jane Smith, DO" }, "Dr. Jane Smith");
    const html = render({ logoUrl: "https://example.com/summit-white.png", senderName });

    expect(html).toContain("data-video-strip");
    expect(html).toContain('src="https://example.com/summit-white.png"');
    expect(html).toContain(">Dr. Jane Smith, DO<");
  });

  it("someone holding a seat that nobody named: 'Dr. First Last' from Clerk", () => {
    const html = render({ senderName: libraryStripName({ displayName: null }, "Dr. Jane Smith") });

    expect(html).toContain(">Dr. Jane Smith<");
  });

  it("someone without a seat: only the clinic, because they send no links", () => {
    const senderName = libraryStripName(null, "Dr. Jane Smith");
    const html = render({ logoUrl: null, senderName });

    expect(senderName).toBeNull();
    expect(html).toContain(">Summit Orthopedics<");
    expect(html).not.toContain("Dr. Jane Smith");
  });

  it("a placeholder: the amber chip is on the same strip, on the picture", () => {
    const html = render({ placeholder: true, senderName: "Dr. Jane Smith, DO" });
    const stripPart = html.slice(html.indexOf("data-video-strip"));

    expect(stripPart).toContain("Placeholder animation");
    expect(html.match(/Placeholder animation/g)).toHaveLength(1);
  });

  it("puts the strip right on top of the picture, as one unit with it, never over it", () => {
    const html = render();

    // The space for the picture is measured (picture-area) and carries the video's shape, 16:9 until the file says.
    expect(html).toMatch(/<div class="picture-area relative min-h-0 flex-1" style="--picture-ratio:1.777/);
    // Inside it, one unit: the strip first, then the picture with the video in it.
    const unit = html.slice(html.indexOf('<div class="picture-unit">'));
    expect(unit).toMatch(/^<div class="picture-unit"><div data-video-strip="" class="video-strip w-full shrink-0 select-none">/);
    expect(unit.indexOf("data-video-strip")).toBeLessThan(unit.indexOf("<video"));
  });

  it("keeps Close in the strip, where it never fades, at the right end", () => {
    const html = render({ placeholder: true });
    const strip = html.slice(html.indexOf("data-video-strip"), html.indexOf("<video"));

    expect(strip).toMatch(/Placeholder animation<\/span><button type="button" aria-label="Close the video and go back to the library"/);
    expect(strip).not.toContain("opacity-0");
  });

  it("lays out the controls the way a phone's player does: back 10, play, forward 10 in the middle; time, sound and full screen along the bottom", () => {
    const html = render();
    const picture = html.slice(html.indexOf("<video"));

    for (const label of ["Back 10 seconds", "Play", "Forward 10 seconds", "Mute", "Full screen", "Seek"]) {
      expect(picture).toContain(`aria-label="${label}"`);
    }
    expect(picture.indexOf('aria-label="Back 10 seconds"')).toBeLessThan(picture.indexOf('aria-label="Play"'));
    expect(picture.indexOf('aria-label="Play"')).toBeLessThan(picture.indexOf('aria-label="Forward 10 seconds"'));
    expect(picture).toContain("0:00 <span");
    // The title is small now, and fades with the controls; no volume slider and no separate "Start over".
    expect(picture).toContain('<h2 class="truncate text-base font-semibold text-white">Total Knee Replacement</h2>');
    expect(picture).not.toContain('aria-label="Volume"');
    expect(picture).not.toContain('aria-label="Start over"');
  });

  it("makes every control at least 44px to tap", () => {
    const html = render();
    const sizes = [...html.matchAll(/<button type="button" aria-label="([^"]+)" title="[^"]+" class="([^"]+)"/g)].map(([, label, cls]) => ({ label, cls }));

    expect(sizes.length).toBeGreaterThanOrEqual(5);
    for (const { label, cls } of sizes) {
      expect(cls, label).toMatch(/\bh-(11|12|14|16) w-(11|12|14|16)\b/);
    }
  });
});

describe("what the player is handed", () => {
  it("writes a plain file on the element in the page's own HTML, so the browser starts fetching at once", () => {
    const html = render();
    expect(html).toMatch(/<video[^>]*\ssrc="https:\/\/example\.com\/knee\.mp4"/);
  });

  it("writes no address for a stream (the hook puts it on once awake) and never the CDN file; the strip, the title row and the controls are all still there", () => {
    const html = render({
      source: { kind: "stream", src: "https://stream.mux.com/abc.m3u8?token=t", poster: "https://image.mux.com/abc/thumbnail.jpg?token=p", expiresAt: Date.now() + 3_600_000 },
      poster: "https://image.mux.com/abc/thumbnail.jpg?token=p",
      senderName: "Dr. Jane Smith, DO",
      placeholder: true,
    });
    expect(html).not.toMatch(/<video[^>]*\ssrc=/);
    expect(html).not.toContain("stream.mux.com");
    expect(html).toContain('poster="https://image.mux.com/abc/thumbnail.jpg?token=p"');
    expect(html).toContain("data-video-strip");
    expect(html).toContain(">Dr. Jane Smith, DO<");
    expect(html).toContain("Placeholder animation");
    expect(html).toContain('aria-label="Close the video and go back to the library"');
    expect(html).toContain('aria-label="Seek"');
    expect(html).toContain('aria-label="Full screen"');
  });

  it("draws the picture, not a panel, for an unavailable source: the hook shows the panel once the player is awake", () => {
    const html = render({ source: { kind: "unavailable" } });
    expect(html).not.toMatch(/<video[^>]*\ssrc=/);
    expect(html).not.toContain("did not load");
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
