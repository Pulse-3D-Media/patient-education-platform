import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareMessage, shareOrCopy, showShareButton, type ShareTools } from "./share-link";

/**
 * "Save or share this link" (decided on 2026-11-16), with the browser's
 * share sheet and clipboard stood in for. That the real sheet opens on a
 * real iPhone and Android phone, and the address really lands on a
 * computer's clipboard, are the browser and device checks.
 */

const LINK = { url: "https://learn.example.com/watch/abcdefghij", title: "Total Knee Replacement" };

afterEach(() => vi.restoreAllMocks());

describe("pressing the button", () => {
  it("opens the phone's share sheet with the page's address and the procedure's name, and nothing else", async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    expect(await shareOrCopy({ share, clipboard: { writeText } }, LINK)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Total Knee Replacement", url: LINK.url });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says nothing more when the patient closes the sheet, and does not copy behind their back", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    });
    const writeText = vi.fn(async () => {});
    expect(await shareOrCopy({ share, clipboard: { writeText } }, LINK)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
    expect(shareMessage("cancelled")).toBe("");
  });

  it("copies the address and says 'Link copied.' where there is no share sheet (most computers)", async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareOrCopy({ clipboard: { writeText } }, LINK)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(LINK.url);
    expect(shareMessage("copied")).toBe("Link copied.");
  });

  it("copies instead when a browser has a share sheet but refuses to open it here", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("no"), { name: "NotAllowedError" });
    });
    const writeText = vi.fn(async () => {});
    expect(await shareOrCopy({ share, clipboard: { writeText } }, LINK)).toBe("copied");
  });

  it("tells the patient how to save it by hand when neither can be done, in plain words", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    expect(await shareOrCopy({ clipboard: { writeText } }, LINK)).toBe("unable");
    expect(await shareOrCopy({}, LINK)).toBe("unable");
    expect(shareMessage("unable")).toBe("To save this link, copy the address at the top of your browser.");
    expect(shareMessage("unable")).not.toMatch(/error|invalid|fail/i);
  });

  it("sends nothing to our server, by any path, whatever happens", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const tools: ShareTools[] = [
      { share: async () => {} },
      { share: async () => Promise.reject(Object.assign(new Error(), { name: "AbortError" })) },
      { clipboard: { writeText: async () => {} } },
      { clipboard: { writeText: async () => Promise.reject(new Error()) } },
      {},
    ];
    for (const t of tools) await shareOrCopy(t, LINK);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("has no way to reach our server or keep anything in the browser written into it at all", () => {
    for (const file of ["app/watch/share-link.ts", "app/watch/ShareLinkButton.tsx"]) {
      const source = readFileSync(file, "utf8")
        // Comments may say what it never does; only the code is checked.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(source).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie|patient-calls|"use server"/);
      // It never asks for anything: no box to type into.
      expect(source).not.toMatch(/<input|<textarea|<form/);
    }
  });
});

describe("when the button shows", () => {
  it("on a patient link's page, from the start", () => {
    expect(showShareButton("now", "/watch/abcdefghij")).toBe(true);
    expect(showShareButton("now", null)).toBe(true);
  });

  it("on a printed code's page, only once the address has become the visit's own /watch/ link", () => {
    expect(showShareButton("once-own-link", "/q/abcdefghijklmnopqrstuvwxy")).toBe(false);
    expect(showShareButton("once-own-link", null)).toBe(false);
    expect(showShareButton("once-own-link", "/watch/abcdefghijklmnop")).toBe(true);
  });
});
