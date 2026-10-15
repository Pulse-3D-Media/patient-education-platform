import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { libraryStripName } from "@/lib/sender-name";
import { PlayerOverlay } from "./PlayerOverlay";
import type { PlayerControls } from "./usePlayerControls";
import { VideoPlayer } from "./VideoPlayer";

/**
 * The library's player as the server first draws it on the watch page, with
 * the Vimeo-style overlay both players share (PlayerOverlay, ClinicMark),
 * and what the watch page hands it (libraryStripName() decides the name,
 * from the signed-in person's seat). No database, no Clerk.
 *
 * The player opens PAUSED: before the first play there is one big Play
 * button and the clinic's mark. The controls that come after the first play
 * are drawn by PlayerOverlay, rendered here directly with the state a
 * playing video gives it. That the overlay lands on the picture, fades and
 * answers taps, and that nothing plays until Play is tapped, are browser
 * checks (screenshots in the pull request); the tap rule itself is
 * player-rules.test.ts.
 */

function render(props: Partial<Parameters<typeof VideoPlayer>[0]> = {}): string {
  return renderToStaticMarkup(<VideoPlayer source={{ kind: "file", src: "https://example.com/knee.mp4" }} title="Total Knee Replacement" clinicName="Summit Orthopedics" {...props} />);
}

/** The overlay as it is once the video is playing and the controls are up. */
function renderPlaying(overrides: Partial<PlayerControls> = {}): string {
  const noop = () => {};
  const controls = {
    playing: true,
    finished: false,
    time: 0,
    duration: 0,
    muted: false,
    fullscreen: false,
    showing: true,
    reveal: noop,
    hide: noop,
    togglePlay: noop,
    seekBy: noop,
    seekTo: noop,
    toggleMute: noop,
    toggleFullscreen: noop,
    onPictureTap: noop,
    onKey: noop,
    ...overrides,
  } as PlayerControls;
  return renderToStaticMarkup(
    <PlayerOverlay controls={controls} title="Total Knee Replacement" clinicName="Summit Orthopedics" logoUrl={null} senderName={null} showControls slow={false} />,
  );
}

/** The labels of the buttons, in the page's order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(([, label]) => label);
}

describe("the clinic's mark on the library's player", () => {
  it("someone holding a seat: the clinic's logo, the title, and their name as patients see it", () => {
    const senderName = libraryStripName({ displayName: "Dr. Jane Smith, DO" }, "Dr. Jane Smith");
    const html = render({ logoUrl: "https://example.com/summit-square.png", senderName });

    expect(html).toContain("data-video-strip");
    expect(html).toContain('src="https://example.com/summit-square.png"');
    expect(html).toMatch(/class="video-chip [^"]*">Total Knee Replacement</);
    expect(html).toMatch(/class="video-chip [^"]*">Dr\. Jane Smith, DO</);
  });

  it("someone holding a seat that nobody named: 'Dr. First Last' from Clerk", () => {
    const html = render({ senderName: libraryStripName({ displayName: null }, "Dr. Jane Smith") });

    expect(html).toMatch(/class="video-chip [^"]*">Dr\. Jane Smith</);
  });

  it("someone without a seat: the clinic's name in place of a doctor's, because they send no links", () => {
    const senderName = libraryStripName(null, "Dr. Jane Smith");
    const html = render({ logoUrl: null, senderName });

    expect(senderName).toBeNull();
    expect(html).toMatch(/class="video-chip [^"]*">Summit Orthopedics</);
    expect(html).not.toContain("Dr. Jane Smith");
    // The clinic's initials stand in for the missing logo.
    expect(html).toContain(">SO</span>");
  });

  it("a placeholder: the amber chip once, top right, outside the part that fades", () => {
    const html = render({ placeholder: true, senderName: "Dr. Jane Smith, DO" });

    expect(html.match(/Placeholder animation/g)).toHaveLength(1);
    expect(html).toMatch(/<div class="flex shrink-0 items-center gap-2"><span class="[^"]*bg-\[#f3b94d\][^"]*">Placeholder animation<\/span>/);
  });

  it("lays the overlay over the picture inside the video's box, and fills whatever box the page gives it", () => {
    const html = render();

    expect(html).toMatch(/^<div tabindex="0" role="group" aria-label="Total Knee Replacement, video player" class="flex h-full min-h-0 w-full flex-1 /);
    // The video's box is measured (picture-area) and carries the video's shape, 16:9 until the file says.
    expect(html).toMatch(/<div class="picture-area relative min-h-0 flex-1" style="--picture-ratio:1.777/);
    const area = html.slice(html.indexOf("picture-area"));
    expect(area.indexOf("<video")).toBeLessThan(area.indexOf("picture-fit @container z-10"));
    expect(area.indexOf("data-video-strip")).toBeGreaterThan(area.indexOf("picture-fit"));
  });
});

describe("opening paused (decided by Evan on 2026-10-15)", () => {
  it("never starts by itself: no autoplay, no focus taken, but it starts fetching so the Play tap is quick", () => {
    const html = render();

    expect(html).not.toMatch(/autoplay/i);
    expect(html).not.toMatch(/autofocus/i);
    expect(html).toMatch(/<video[^>]*preload="auto"/);
  });

  it("before the first play: one big Play button and the clinic's mark, and none of the controls", () => {
    const html = render();

    expect(buttons(html)).toEqual(["Play Total Knee Replacement"]);
    expect(html).toContain(">Play</span>");
    expect(html).toContain("data-video-strip");
    expect(html).not.toContain('aria-label="Seek"');
    // The overlay takes no taps until then, so the Play button gets them.
    expect(html).toContain('class="picture-fit @container z-10 pointer-events-none"');
  });

  it("has no Close and no heart of its own any more: the watch page has a back arrow and its own Favorite", () => {
    const html = render();

    expect(html).not.toContain("Close");
    expect(html).not.toContain("my favorites");
  });

  it("makes the big Play button at least 48px to tap", () => {
    const html = render();
    expect(html).toMatch(/<span class="flex h-16 w-16 items-center justify-center rounded-full bg-white/);
  });
});

describe("the controls once it plays, laid out the way Vimeo does it", () => {
  it("back 10, pause, forward 10 in the middle (touch screens), and pause, sound, full screen and the progress bar along the bottom", () => {
    const html = renderPlaying();

    expect(buttons(html)).toEqual(["Back 10 seconds", "Pause", "Forward 10 seconds", "Pause", "Mute", "Full screen"]);
    expect(html).toContain('aria-label="Seek"');
    expect(html).toContain("0:00 <span");
  });

  it("shows the middle buttons only on a screen with no mouse, and the bottom play button only with one", () => {
    const html = renderPlaying();

    expect(html).toMatch(/<div class="[^"]*flex items-center justify-center gap-5 [^"]*computer:hidden[^"]*"><button[^>]*aria-label="Back 10 seconds"/);
    expect(html).toMatch(/<span class="hidden computer:flex"><button[^>]*aria-label="Pause"/);
  });

  it("makes every control at least 44px to tap", () => {
    const html = renderPlaying();
    const sizes = [...html.matchAll(/<button type="button" aria-label="([^"]+)" title="[^"]+" class="([^"]+)"/g)].map(([, label, cls]) => ({ label, cls }));

    expect(sizes.length).toBe(6);
    for (const { label, cls } of sizes) {
      expect(cls, label).toMatch(/\bh-(11|12|14|16) w-(11|12|14|16)\b/);
    }
  });

  it("has no volume slider, no separate 'Start over' and no title band of its own", () => {
    const html = renderPlaying();

    expect(html).not.toContain('aria-label="Volume"');
    expect(html).not.toContain('aria-label="Start over"');
    expect(html).not.toContain("<h2");
  });

  it("offers Play again at the end", () => {
    expect(buttons(renderPlaying({ playing: false, finished: true }))).toContain("Play again");
  });
});

describe("what the player is handed", () => {
  it("writes a plain file on the element in the page's own HTML, so the browser starts fetching at once", () => {
    const html = render();
    expect(html).toMatch(/<video[^>]*\ssrc="https:\/\/example\.com\/knee\.mp4"/);
  });

  it("writes no address for a stream (the hook puts it on once awake) and never the CDN file; the mark and Play are still there", () => {
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
    expect(html).toContain('aria-label="Play Total Knee Replacement"');
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
