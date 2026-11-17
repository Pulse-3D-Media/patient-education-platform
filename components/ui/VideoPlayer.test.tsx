import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Chapter } from "@/lib/chapters";
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
function renderPlaying(overrides: Partial<PlayerControls> = {}, chapters: Chapter[] = [], extra: { loading?: boolean; slow?: boolean; placeholder?: boolean } = {}): string {
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
    onFocusIn: noop,
    onFocusOut: noop,
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
    <PlayerOverlay controls={controls} title="Total Knee Replacement" clinicName="Summit Orthopedics" logoUrl={null} senderName={null} showControls slow={false} chapters={chapters} {...extra} />,
  );
}

/** The labels of the buttons, in the page's order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map(([, label]) => label);
}

describe("the clinic's mark on the library's player", () => {
  it("someone holding a seat: the clinic's logo and their name as patients see it (the watch page writes the title under the player)", () => {
    const senderName = libraryStripName({ displayName: "Dr. Jane Smith, DO" }, "Dr. Jane Smith");
    const html = render({ logoUrl: "https://example.com/summit-square.png", senderName });

    expect(html).toContain("data-video-strip");
    expect(html).toContain('src="https://example.com/summit-square.png"');
    expect(html).toMatch(/class="video-chip [^"]*">Dr\. Jane Smith, DO</);
    expect(html).not.toMatch(/class="video-chip [^"]*">Total Knee Replacement</);
  });

  it("puts the title back on the picture in full screen, where the page's own title is out of sight", () => {
    expect(renderPlaying({ fullscreen: true })).toMatch(/class="video-chip [^"]*">Total Knee Replacement</);
    expect(renderPlaying({ fullscreen: false })).not.toMatch(/class="video-chip [^"]*">Total Knee Replacement</);
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
    // The short word on a narrow player, the full words on a wide one (both in the page; the width decides which shows).
    expect(html).toMatch(
      /<div class="flex shrink-0 items-center gap-2"><span class="[^"]*bg-\[#f3b94d\][^"]*"><span class="@xl:hidden">Placeholder<\/span><span class="hidden @xl:inline">Placeholder animation<\/span><\/span>/,
    );
  });

  it("lays the overlay over the picture inside the video's box, and fills whatever box the page gives it", () => {
    const html = render();

    expect(html).toMatch(/^<div tabindex="0" role="group" aria-label="Total Knee Replacement, video player" class="relative flex h-full min-h-0 w-full flex-1 /);
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

  it("makes the big Play button one white pill, at least 48px tall, with a round play button and the word Play", () => {
    const html = render();
    expect(html).toMatch(/<span data-play-pill="" class="flex h-14 items-center [^"]*rounded-full bg-white/);
    expect(html).toMatch(/<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-\[#12333f\] text-white/);
    expect(html).toMatch(/text-\[16px\] font-semibold[^"]*">Play<\/span>/);
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

    expect(html).toMatch(/<div class="[^"]*flex items-center justify-center gap-7 [^"]*computer:hidden[^"]*"><button[^>]*aria-label="Back 10 seconds"/);
    expect(html).toMatch(/<span class="hidden computer:flex"><button[^>]*aria-label="Pause"/);
  });

  it("lets taps through the dark fade behind the bottom controls, which on a phone or a tablet reaches up over the middle buttons", () => {
    // Found on 2026-10-29: the fade took taps of its own and sat on top of Pause and the ten-second buttons, so a tap
    // on any of them only hid the controls. Only the fade's buttons and the progress bar may take a tap.
    const html = renderPlaying();
    const fade = html.match(/<div class="(video-scrim[^"]*)"/)?.[1] ?? "";

    expect(fade).toMatch(/\bpointer-events-none\b/);
    expect(html).toMatch(/<input[^>]*aria-label="Seek"[^>]*class="pointer-events-auto /);
    expect(renderPlaying({ showing: false })).toMatch(/<input[^>]*aria-label="Seek"[^>]*class="pointer-events-none /);
  });

  it("makes every control at least 44px to tap", () => {
    const html = renderPlaying();
    const sizes = [...html.matchAll(/<button type="button" aria-label="([^"]+)" title="[^"]+" class="([^"]+)"/g)].map(([, label, cls]) => ({ label, cls }));

    expect(sizes.length).toBe(6);
    for (const { label, cls } of sizes) {
      expect(cls, label).toMatch(/\bh-(11|12|13|14|16) w-(11|12|13|14|16)\b/);
    }
  });

  it("keeps the middle buttons small on a phone (44px, the play button 52px) and the fade behind the bottom row short", () => {
    const html = renderPlaying();
    expect(html).toMatch(/aria-label="Back 10 seconds"[^>]*class="[^"]*\bh-11 w-11 bg-black\/45\b/);
    expect(html).toMatch(/aria-label="Pause"[^>]*class="[^"]*\bh-13 w-13 bg-black\/50\b/);
    expect(html).toMatch(/aria-label="Forward 10 seconds"[^>]*class="[^"]*\bh-11 w-11 bg-black\/45\b/);
    // The old fade reached 40px above the row (pt-10) and was 75% black; now 12px (pt-3), on .video-scrim.
    expect(html).toMatch(/<div class="video-scrim pointer-events-none absolute inset-x-0 bottom-0 [^"]*\bpt-3\b/);
    expect(html).not.toContain("from-black/75");
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

describe("chapters on the progress bar (the library's watch page)", () => {
  const KNEE: Chapter[] = [
    { startSeconds: 0, title: "Intro" },
    { startSeconds: 33, title: "Preparing the knee" },
    { startSeconds: 63, title: "The implant" },
    { startSeconds: 88, title: "The result" },
    { startSeconds: 97, title: "Outro" },
  ];
  const marks = (html: string) => [...html.matchAll(/data-chapter-mark=""[^>]*style="left:([\d.]+)%"/g)].map(([, left]) => Math.round(Number(left)));

  it("marks where each chapter after the first starts, and names the one playing beside the time", () => {
    const html = renderPlaying({ time: 70, duration: 110 }, KNEE);
    expect(marks(html)).toEqual([30, 57, 80, 88]);
    expect(html).toMatch(/data-current-chapter=""[^>]*>.*The implant<\/span>/);
    expect(renderPlaying({ time: 0, duration: 110 }, KNEE)).toMatch(/data-current-chapter=""[^>]*>.*Intro<\/span>/);
    expect(renderPlaying({ time: 105, duration: 110 }, KNEE)).toMatch(/data-current-chapter=""[^>]*>.*Outro<\/span>/);
  });

  it("marks nothing before the length is known, and nothing past the end", () => {
    expect(marks(renderPlaying({ time: 0, duration: 0 }, KNEE))).toEqual([]);
    // A 1:30 video: 0:33, 1:03 and 1:28 are marked, 1:37 is past the end.
    expect(marks(renderPlaying({ time: 0, duration: 90 }, KNEE))).toEqual([37, 70, 98]);
  });

  it("draws no marks and no chapter name for a video without chapters", () => {
    const html = renderPlaying({ time: 70, duration: 110 });
    expect(html).not.toContain("data-chapter-mark");
    expect(html).not.toContain("data-current-chapter");
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

describe("the loading spinner (patient player)", () => {
  it("is drawn in the middle while the video waits for data, in place of the middle buttons, hidden from screen readers", () => {
    const html = renderPlaying({}, [], { loading: true });
    expect(html).toContain("data-spinner");
    expect(html).toMatch(/<span data-spinner="" aria-hidden="true"/);
    expect(html).toContain("motion-safe:animate-spin");
    expect(buttons(html)).not.toContain("Back 10 seconds");
    expect(buttons(html)).toContain("Full screen");
  });

  it("is not drawn otherwise, and gives way to the 'still loading' sentence after a while", () => {
    expect(renderPlaying()).not.toContain("data-spinner");
    const slow = renderPlaying({}, [], { loading: true, slow: true });
    expect(slow).not.toContain("data-spinner");
    expect(slow).toContain("Still loading.");
  });

  it("keeps the placeholder chip short on a narrow player and in full words on a wide one", () => {
    const html = renderPlaying({}, [], { placeholder: true });
    expect(html).toContain('<span class="@xl:hidden">Placeholder</span>');
    expect(html).toContain('<span class="hidden @xl:inline">Placeholder animation</span>');
  });
});

describe("the controls for the keyboard and a screen reader (2026-11-16)", () => {
  it("reads the progress bar as words, out of the video's length", () => {
    const html = renderPlaying({ time: 65, duration: 252 });
    expect(html).toMatch(/<input[^>]*aria-label="Seek"[^>]*aria-valuetext="1 minute 5 seconds of 4 minutes 12 seconds"/);
  });

  it("draws a focus ring on every round button and around the progress bar, white with a dark band so it shows over any frame", () => {
    const html = renderPlaying();
    const buttonClasses = [...html.matchAll(/<button[^>]*class="([^"]+)"/g)].map(([, c]) => c);
    expect(buttonClasses.length).toBeGreaterThan(0);
    for (const c of buttonClasses) {
      expect(c).toContain("focus-visible:outline-white");
      expect(c).toContain("focus-visible:shadow-[0_0_0_6px_#12202a]");
    }
    // The bar's input is invisible, so the bar around it carries the ring when the keyboard is on it.
    expect(html).toMatch(/class="[^"]*has-\[input:focus-visible\]:outline-white[^"]*"/);
  });

  it("gives the library's player a visible focus ring of its own, and hears focus arriving and leaving", () => {
    const html = render();
    expect(html).toMatch(/role="group"[^>]*class="[^"]*focus-visible:outline-white[^"]*"/);
  });
});
