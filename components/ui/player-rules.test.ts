import { describe, expect, it } from "vitest";
import { HIDE_AFTER_MS, SKIP_SECONDS, clinicInitials, keyFirstPressWhileHidden, pictureTapAction, seekValueText, spokenTime } from "./player-rules";

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

describe("a key pressed while the controls have faded over a playing video", () => {
  it("the first press of a key that would act only brings the controls back, as the first tap on a faded picture does", () => {
    for (const key of ["Enter", " ", "k", "m", "f", "ArrowLeft", "ArrowRight", "ArrowUp", "a"]) {
      expect(keyFirstPressWhileHidden(key)).toBe("show-only");
    }
  });

  it("keys that move the focus, leave full screen or are only held do what they always do", () => {
    for (const key of ["Tab", "Shift", "Control", "Alt", "Meta", "Escape", "CapsLock", "Insert"]) {
      expect(keyFirstPressWhileHidden(key)).toBe("pass");
    }
  });

  it("never eats a browser's or a screen reader's shortcut: any key with Ctrl, Cmd or Alt held passes", () => {
    // Zoom, the address bar, find, back, reload with Cmd, a screen reader's own combinations.
    expect(keyFirstPressWhileHidden("+", { ctrlKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden("=", { metaKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden("l", { ctrlKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden("f", { ctrlKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden("ArrowLeft", { altKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden("r", { metaKey: true })).toBe("pass");
    expect(keyFirstPressWhileHidden(" ", { ctrlKey: true, altKey: true })).toBe("pass");
    // The same keys with nothing held are the player's own (F is full screen, the arrows seek).
    expect(keyFirstPressWhileHidden("f", { ctrlKey: false, metaKey: false, altKey: false })).toBe("show-only");
    expect(keyFirstPressWhileHidden("ArrowLeft", {})).toBe("show-only");
  });

  it("the function keys pass (F5 reloads, F6 goes to the address bar)", () => {
    for (const key of ["F1", "F5", "F6", "F11", "F12", "F24"]) {
      expect(keyFirstPressWhileHidden(key)).toBe("pass");
    }
    // A lone "f" is not a function key.
    expect(keyFirstPressWhileHidden("f")).toBe("show-only");
    expect(keyFirstPressWhileHidden("F")).toBe("show-only");
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

describe("the progress bar's words for a screen reader", () => {
  it("reads a time as words, never a bare number of seconds", () => {
    expect(spokenTime(0)).toBe("0 seconds");
    expect(spokenTime(1)).toBe("1 second");
    expect(spokenTime(45.9)).toBe("45 seconds");
    expect(spokenTime(60)).toBe("1 minute");
    expect(spokenTime(65)).toBe("1 minute 5 seconds");
    expect(spokenTime(252)).toBe("4 minutes 12 seconds");
    expect(spokenTime(3723)).toBe("1 hour 2 minutes 3 seconds");
    expect(spokenTime(Number.NaN)).toBe("0 seconds");
    expect(spokenTime(-4)).toBe("0 seconds");
  });

  it("says where the video is out of how long it is, or just where it is before the length is known", () => {
    expect(seekValueText(65, 252)).toBe("1 minute 5 seconds of 4 minutes 12 seconds");
    expect(seekValueText(0, 110)).toBe("0 seconds of 1 minute 50 seconds");
    expect(seekValueText(12, 0)).toBe("12 seconds");
    expect(seekValueText(12, Number.NaN)).toBe("12 seconds");
  });
});
