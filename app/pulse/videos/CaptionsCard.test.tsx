import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CAPTION_STATE_WORDS, canAskForCaptions, type CaptionState } from "@/lib/caption-state";
import { CaptionsCard } from "./CaptionsCard";

/**
 * The Captions card on a video's page on /pulse, as the server first draws
 * it, with the action as a stand-in: the line for each state, Add captions
 * only when there is something to ask for, and once captions are ready the
 * review link and how to correct them. Pressing the button is a browser
 * check; the action is app/pulse/actions.test.ts, the flow
 * lib/mux-captions.test.ts.
 */

vi.mock("../actions", () => ({ addCaptionsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const render = (state: CaptionState) => renderToStaticMarkup(<CaptionsCard videoId="clz0000000000000000000000" state={state} />);

describe("CaptionsCard", () => {
  it("offers Add captions only when there are none or they failed", () => {
    expect(render({ kind: "none" })).toContain(">Add captions<");
    expect(render({ kind: "failed" })).toContain(">Add captions<");
    for (const kind of ["checking", "not-mux", "not-configured", "no-asset-id", "unreachable", "video-not-ready", "no-sound", "being-made"] as const) {
      const html = render({ kind });
      expect(html, kind).not.toContain("Add captions");
      expect(html, kind).toContain(CAPTION_STATE_WORDS[kind].replace(/'/g, "&#x27;"));
    }
    expect(canAskForCaptions({ kind: "ready", reviewUrl: null, name: "English" })).toBe(false);
  });

  it("offers Check again only when Mux could not be asked just now, and says it is checking while the page waits for Mux", () => {
    expect(render({ kind: "unreachable" })).toContain(">Check again<");
    expect(render({ kind: "unreachable" })).toContain("Could not check just now");
    for (const kind of ["checking", "none", "being-made", "not-mux"] as const) expect(render({ kind }), kind).not.toContain("Check again");
    expect(render({ kind: "checking" })).toContain("Checking with Mux...");
  });

  it("once ready, links to the caption text in a new tab and says to read it through and how to correct it", () => {
    const html = render({ kind: "ready", reviewUrl: "https://stream.mux.com/PlayKnee0001/text/Txt0001.vtt?token=made-up", name: "English" });
    expect(html).toContain('href="https://stream.mux.com/PlayKnee0001/text/Txt0001.vtt?token=made-up"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Open the caption text (English)");
    expect(html).toContain("Read them through.");
    expect(html).toContain("Mux dashboard");
    expect(html).not.toContain("Add captions");
    // No link at all when the key could not sign one.
    expect(render({ kind: "ready", reviewUrl: null, name: "English" })).not.toContain("href=");
  });
});
