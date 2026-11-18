import { describe, expect, it } from "vitest";
import { HIDE_AFTER_MS, SKIP_SECONDS, clinicInitials, pictureTapAction } from "./player-rules";

/**
 * The rules both players share (player-rules.ts), with plain values. That a
 * real tap in a real browser does this, and that the controls fade on time,
 * are browser checks (screenshots in the pull request).
 */

describe("what a tap or click on the picture does", () => {
  it("a mouse click plays or pauses, whatever is showing", () => {
    expect(pictureTapAction("mouse", true, true)).toBe("toggle-play");
    expect(pictureTapAction("mouse", false, true)).toBe("toggle-play");
    expect(pictureTapAction("mouse", true, false)).toBe("toggle-play");
  });

  it("a finger tap hides the controls over a playing video, and shows them otherwise", () => {
    expect(pictureTapAction("touch", true, true)).toBe("hide");
    expect(pictureTapAction("touch", false, true)).toBe("show");
    // Paused: the controls stay up; a tap never hides them.
    expect(pictureTapAction("touch", true, false)).toBe("show");
    expect(pictureTapAction("touch", false, false)).toBe("show");
    // A pen behaves like a finger.
    expect(pictureTapAction("pen", true, true)).toBe("hide");
  });
});

describe("the clinic's initials, for a round frame with no logo", () => {
  it("takes the first letter of the first two real words", () => {
    expect(clinicInitials("Summit Orthopedics")).toBe("SO");
    expect(clinicInitials("The Knee Clinic of Utah")).toBe("KC");
    expect(clinicInitials("Zed Summit Orthopedics")).toBe("ZS");
    expect(clinicInitials("St. Mark's Spine & Joint")).toBe("SM");
  });

  it("copes with one word, small words only, odd spacing, accents and no letters at all", () => {
    expect(clinicInitials("Orthopedics")).toBe("O");
    expect(clinicInitials("The A")).toBe("TA");
    expect(clinicInitials("  élan   sports  ")).toBe("ÉS");
    expect(clinicInitials("&&&")).toBe("?");
    expect(clinicInitials("")).toBe("?");
  });
});

describe("the timings", () => {
  it("fades the controls a little over two and a half seconds after the last touch, and skips ten seconds", () => {
    expect(HIDE_AFTER_MS).toBe(2600);
    expect(SKIP_SECONDS).toBe(10);
  });
});
