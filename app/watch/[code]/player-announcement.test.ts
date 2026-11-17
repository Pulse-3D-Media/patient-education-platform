import { describe, expect, it } from "vitest";
import { playerAnnouncement, type PlayerState } from "./player-announcement";

/**
 * What the patient player's one status region says (player-announcement.ts),
 * with plain values. That a real screen reader speaks it once, at the right
 * moment, is the VoiceOver and TalkBack check (docs/player-overlay-device-checks.md).
 */

const START: PlayerState = {
  ticked: false,
  ready: false,
  started: false,
  loading: false,
  everPlayed: false,
  failed: false,
  ended: false,
  unavailable: false,
  acceptTrouble: false,
  clinicName: "Summit Orthopedics",
};
const say = (over: Partial<PlayerState>) => playerAnnouncement({ ...START, ...over });

describe("the player's status region", () => {
  it("says nothing before the tick, and nothing while the video is on its way (Play's own description says that)", () => {
    expect(say({})).toBe("");
    expect(say({ ticked: true })).toBe("");
  });

  it("says when Play is ready", () => {
    expect(say({ ticked: true, ready: true })).toBe("The video is ready. Tap Play to start.");
  });

  it("says 'Loading the video.' for the first wait after Play only, and then nothing while it plays: never the time", () => {
    expect(say({ ticked: true, ready: true, started: true, loading: true })).toBe("Loading the video.");
    expect(say({ ticked: true, ready: true, started: true })).toBe("");
    // A later wait (buffering) is drawn, not said again; a long one gets the overlay's own "still loading" sentence.
    expect(say({ ticked: true, ready: true, started: true, loading: true, everPlayed: true })).toBe("");
  });

  it("says when the tick's answer did not get through, the video did not load, the link ended, or a printed code cannot hand one out", () => {
    expect(say({ ticked: true, acceptTrouble: true })).toBe("We couldn't get the video ready. Check your connection, then try again.");
    expect(say({ started: true, failed: true })).toBe("The video did not load. Check your connection, then try again.");
    expect(say({ started: true, ended: true })).toBe("This link has expired. Summit Orthopedics can send you a fresh one.");
    expect(say({ started: true, unavailable: true })).toBe("This video isn't available right now. Please ask Summit Orthopedics about it.");
  });

  it("never uses the words 'error' or 'invalid'", () => {
    const all = [
      say({ ticked: true, ready: true }),
      say({ started: true, loading: true }),
      say({ acceptTrouble: true }),
      say({ failed: true }),
      say({ ended: true }),
      say({ unavailable: true }),
    ];
    for (const words of all) expect(words).not.toMatch(/error|invalid|403|404/i);
  });
});
