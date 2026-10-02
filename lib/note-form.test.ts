import { describe, expect, it, vi } from "vitest";
import { NOTE_MAX_LENGTH, NOTE_NOT_SAVED, cleanNote, draftAfterSave, saveNoteDraft } from "./note-form";

/**
 * The rules of the "add a note" box, with plain values: what is typed is
 * only ever emptied by a save the server confirmed, and a note is measured
 * the same way in the box and on the server.
 */

describe("cleanNote", () => {
  it("counts a line break as one character, however the browser sent it", () => {
    expect(cleanNote("one\r\ntwo\r\nthree")).toBe("one\ntwo\nthree");
    expect(cleanNote("one\rtwo")).toBe("one\ntwo");
    expect(cleanNote("one\ntwo")).toBe("one\ntwo");
  });

  it("drops blank space at either end and keeps it inside", () => {
    expect(cleanNote("  \r\n spoke to the  office manager \r\n ")).toBe("spoke to the  office manager");
    expect(cleanNote("   ")).toBe("");
  });

  it("a note the box showed as exactly at the limit is at the limit here too", () => {
    // A thousand one-letter lines as typed: 2,000 characters in the box, nearly 3,000 as a browser sends them.
    const typed = Array.from({ length: 1000 }, () => "a").join("\n") + "b";
    const sent = typed.replace(/\n/g, "\r\n");
    expect(typed.length).toBe(NOTE_MAX_LENGTH);
    expect(sent.length).toBeGreaterThan(NOTE_MAX_LENGTH);
    expect(cleanNote(sent).length).toBe(NOTE_MAX_LENGTH);
  });
});

describe("draftAfterSave", () => {
  const typed = "Called about the invoice. They will pay by the 14th.";

  it("empties the box only when the server confirmed the save", () => {
    expect(draftAfterSave(typed, { ok: "Note added." })).toBe("");
  });

  it("keeps every character when the note was refused, or nothing came back", () => {
    expect(draftAfterSave(typed, { error: "Keep a note to 2000 characters or fewer." })).toBe(typed);
    expect(draftAfterSave(typed, { error: "That clinic no longer exists." })).toBe(typed);
    expect(draftAfterSave(typed, null)).toBe(typed);
    expect(draftAfterSave(typed, {})).toBe(typed);
  });
});

describe("saveNoteDraft", () => {
  const typed = "x".repeat(NOTE_MAX_LENGTH + 1);

  it("a confirmed save empties the box and passes the server's words along", async () => {
    expect(await saveNoteDraft("A short note.", async () => ({ ok: "Note added." }))).toEqual({ outcome: { ok: "Note added." }, draft: "" });
  });

  it("a refusal keeps the draft, all 2,001 characters of it", async () => {
    const refused = { error: "Keep a note to 2000 characters or fewer." };
    expect(await saveNoteDraft(typed, async () => refused)).toEqual({ outcome: refused, draft: typed });
  });

  it("a save that fails outright keeps the draft and answers in plain words, never with the failure itself", async () => {
    const failure = new Error("fetch failed: postgresql://user:secret@host/db");
    const result = await saveNoteDraft(typed, async () => {
      throw failure;
    });
    expect(result).toEqual({ outcome: { error: NOTE_NOT_SAVED }, draft: typed });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("hands a failure to passOn first, which may throw it again (a redirect to sign-in must still happen)", async () => {
    const signal = new Error("NEXT_REDIRECT");
    const passOn = vi.fn((error: unknown) => {
      throw error;
    });
    await expect(
      saveNoteDraft(
        typed,
        async () => {
          throw signal;
        },
        passOn,
      ),
    ).rejects.toBe(signal);
    expect(passOn).toHaveBeenCalledWith(signal);
  });
});
