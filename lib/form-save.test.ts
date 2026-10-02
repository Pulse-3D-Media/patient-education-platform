import { describe, expect, it, vi } from "vitest";
import { SAVE_NOT_CONFIRMED, safeSave } from "./form-save";

/**
 * The rule every /pulse form shares for a save that fails outright: it is
 * answered with a plain sentence, never the failure itself, and Next.js's
 * own signals are let through.
 */

describe("safeSave", () => {
  it("passes the server's answer along untouched, a success or a refusal", async () => {
    expect(await safeSave(async () => ({ ok: "Details saved." }))).toEqual({ ok: "Details saved." });
    expect(await safeSave(async () => ({ error: "Keep the notice under 300 characters." }))).toEqual({ error: "Keep the notice under 300 characters." });
    expect(await safeSave(async () => null)).toBeNull();
  });

  it("turns a save that throws into a plain sentence, and never shows the failure", async () => {
    const outcome = await safeSave(async () => {
      throw new Error("Can't reach database server at postgresql://user:secret@host/db for share k7m2xq4v9p");
    });
    expect(outcome).toEqual({ error: SAVE_NOT_CONFIRMED });
    expect(JSON.stringify(outcome)).not.toMatch(/secret|postgresql|k7m2xq4v9p/);
  });

  it("does not claim nothing was written: the answer can be lost after the server saved", () => {
    expect(SAVE_NOT_CONFIRMED).toMatch(/could not confirm/i);
    expect(SAVE_NOT_CONFIRMED).toMatch(/still here/i);
  });

  it("hands a failure to passOn first, which may throw it again (a redirect after adding a video must still happen)", async () => {
    const signal = new Error("NEXT_REDIRECT");
    const passOn = vi.fn((error: unknown) => {
      throw error;
    });
    await expect(
      safeSave(async () => {
        throw signal;
      }, passOn),
    ).rejects.toBe(signal);
    expect(passOn).toHaveBeenCalledWith(signal);
  });

  it("a passOn that lets the failure by still ends in the sentence", async () => {
    const passOn = vi.fn();
    expect(
      await safeSave(async () => {
        throw new Error("network");
      }, passOn),
    ).toEqual({ error: SAVE_NOT_CONFIRMED });
    expect(passOn).toHaveBeenCalledTimes(1);
  });
});
