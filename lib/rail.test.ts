import { describe, expect, it } from "vitest";
import { aVideoIsPlaying, nextRailMode, RAIL_CLOSE_DELAY_MS, RAIL_OPEN_DELAY_MS, type RailEvent, type RailMode } from "./rail";

/** The side rail's rules (lib/rail.ts): how it opens and how it closes, for the mouse, touch, the keyboard and the tour. */

const run = (start: RailMode | null, ...events: RailEvent["kind"][]) => events.reduce<RailMode | null>((now, kind) => nextRailMode(now, { kind } as RailEvent), start);

describe("the side rail with a mouse", () => {
  it("opens when the pointer rests on it and closes when it leaves", () => {
    expect(run(null, "pointer-rested")).toBe("hover");
    expect(run(null, "pointer-rested", "pointer-left")).toBeNull();
  });

  it("waits a moment before opening and a little longer before closing, so a pointer passing across does not make it flap", () => {
    expect(RAIL_OPEN_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(RAIL_CLOSE_DELAY_MS).toBeGreaterThan(RAIL_OPEN_DELAY_MS);
    expect(RAIL_CLOSE_DELAY_MS).toBeLessThanOrEqual(500);
  });

  it("closes when the three lines are pressed while it is open on hover", () => {
    expect(run("hover", "menu-pressed")).toBeNull();
  });

  it("never closes a rail opened by a tap, the keyboard or the tour just because the pointer left", () => {
    expect(run("pinned", "pointer-left")).toBe("pinned");
    expect(run("focus", "pointer-left")).toBe("focus");
    expect(run("tour", "pointer-left")).toBe("tour");
  });

  it("does not take over a rail opened another way when the pointer rests on it", () => {
    expect(run("pinned", "pointer-rested")).toBe("pinned");
    expect(run("tour", "pointer-rested")).toBe("tour");
  });
});

describe("the side rail with touch", () => {
  it("opens and closes from the three lines", () => {
    expect(run(null, "menu-pressed")).toBe("pinned");
    expect(run(null, "menu-pressed", "menu-pressed")).toBeNull();
  });

  it("closes on a tap outside (dismissed)", () => {
    expect(run("pinned", "dismissed")).toBeNull();
  });

  it("opens from the Library icon, and pressing it again keeps it open", () => {
    expect(run(null, "library-pressed")).toBe("pinned");
    expect(run(null, "library-pressed", "library-pressed")).toBe("pinned");
    // Opened on hover, a press on Library keeps it open after the pointer leaves.
    expect(run("hover", "library-pressed", "pointer-left")).toBe("pinned");
  });
});

describe("the side rail with the keyboard", () => {
  it("opens when the focus moves in and closes when it moves out", () => {
    expect(run(null, "keyboard-focus-in")).toBe("focus");
    expect(run(null, "keyboard-focus-in", "focus-left")).toBeNull();
  });

  it("closes a rail opened by the three lines when the focus moves out to the page", () => {
    expect(run("pinned", "focus-left")).toBeNull();
  });

  it("closes on Escape, however it was opened", () => {
    for (const mode of ["hover", "focus", "pinned", "tour"] as const) expect(run(mode, "dismissed")).toBeNull();
  });
});

describe("the side rail and the tour", () => {
  it("opens for the tour and stays open while the tour's caption takes the focus or the pointer wanders", () => {
    expect(run(null, "tour-asked")).toBe("tour");
    expect(run(null, "tour-asked", "focus-left", "pointer-left")).toBe("tour");
  });
});

describe("aVideoIsPlaying", () => {
  it("is true only while a video is playing (not paused and not at its end)", () => {
    expect(aVideoIsPlaying([])).toBe(false);
    expect(aVideoIsPlaying([{ paused: true, ended: false }])).toBe(false);
    expect(aVideoIsPlaying([{ paused: false, ended: true }])).toBe(false);
    expect(aVideoIsPlaying([{ paused: true, ended: false }, { paused: false, ended: false }])).toBe(true);
  });
});
