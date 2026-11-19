import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOUR_COPY,
  TOUR_OFFER_HREF,
  TOUR_SEEN_KEY,
  TOUR_START_HREF,
  joinNames,
  markTourSeen,
  readTourRequest,
  readTourSeen,
  tourStopHref,
  tourStops,
  withoutTourParams,
} from "./tour";

/** A stand-in for the browser's storage, as a plain map. */
function memoryStorage(start: Record<string, string> = {}) {
  const values = new Map(Object.entries(start));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

/** Storage that refuses every call, as some private windows do. */
const blocked = () => {
  throw new Error("SecurityError");
};

describe("the address the tour reads", () => {
  it("reads the offer and each stop", () => {
    expect(readTourRequest(new URLSearchParams("tour=offer"))).toEqual({ kind: "offer" });
    expect(readTourRequest(new URLSearchParams("tour=nav"))).toEqual({ kind: "stop", stop: "nav", videoId: null });
    expect(readTourRequest(new URLSearchParams("tour=video&tv=abc_123"))).toEqual({ kind: "stop", stop: "video", videoId: "abc_123" });
    expect(readTourRequest(new URLSearchParams("tour=admin&tv=abc"))).toEqual({ kind: "stop", stop: "admin", videoId: "abc" });
  });

  it("treats anything else as no tour at all", () => {
    for (const query of ["", "tour=", "tour=NAV", "tour=4", "tour=billing", "welcome=1", "tour=nav%00"]) {
      expect(readTourRequest(new URLSearchParams(query))).toBeNull();
    }
  });

  it("drops a video id that is not the shape a watch page accepts", () => {
    expect(readTourRequest(new URLSearchParams("tour=admin&tv=../x"))).toEqual({ kind: "stop", stop: "admin", videoId: null });
    expect(readTourRequest(new URLSearchParams(`tour=admin&tv=${"a".repeat(500)}`))).toEqual({ kind: "stop", stop: "admin", videoId: null });
  });
});

describe("which stops a person's tour has", () => {
  it("is three stops for an office admin when there is a video", () => {
    expect(tourStops({ hasVideo: true, isAdmin: true })).toEqual(["nav", "video", "admin"]);
  });

  it("is two stops for everyone else", () => {
    expect(tourStops({ hasVideo: true, isAdmin: false })).toEqual(["nav", "video"]);
  });

  it("skips the video stop when the clinic has no video it can open", () => {
    expect(tourStops({ hasVideo: false, isAdmin: true })).toEqual(["nav", "admin"]);
    expect(tourStops({ hasVideo: false, isAdmin: false })).toEqual(["nav"]);
  });
});

describe("the address of each stop", () => {
  it("starts on the library home", () => {
    expect(TOUR_START_HREF).toBe("/library?tour=nav");
    expect(tourStopHref("nav", "v1")).toBe(TOUR_START_HREF);
    expect(TOUR_OFFER_HREF).toBe("/library?tour=offer");
  });

  it("opens the video's own watch page, keeping the video for later stops", () => {
    expect(tourStopHref("video", "v1")).toBe("/library/watch/v1?tour=video&tv=v1");
    expect(tourStopHref("admin", "v1")).toBe("/admin?tour=admin&tv=v1");
    expect(tourStopHref("admin", null)).toBe("/admin?tour=admin");
  });

  it("never sends anyone to a watch page with no video", () => {
    expect(tourStopHref("video", null)).toBe(TOUR_START_HREF);
  });

  it("tidies the tour out of an address and keeps everything else", () => {
    expect(withoutTourParams("https://x.example/library?tour=nav")).toBe("/library");
    expect(withoutTourParams("https://x.example/admin?tour=admin&tv=v1&a=1#top")).toBe("/admin?a=1#top");
    expect(withoutTourParams("/library/watch/v1?tour=video&tv=v1")).toBe("/library/watch/v1");
  });
});

describe("whether this browser has seen the tour", () => {
  it("is false until it is marked, then true", () => {
    const storage = memoryStorage();
    expect(readTourSeen(() => storage)).toBe(false);
    markTourSeen(() => storage);
    expect(storage.values.get(TOUR_SEEN_KEY)).toBe("1");
    expect(readTourSeen(() => storage)).toBe(true);
  });

  it("is unknown, never an error, when storage is blocked, and marking it changes nothing", () => {
    expect(readTourSeen(blocked)).toBeNull();
    expect(() => markTourSeen(blocked)).not.toThrow();
  });
});

describe("the words", () => {
  it("are the mock-up's, with no em dashes", () => {
    expect(TOUR_COPY.nav.title).toBe("Navigate by specialty");
    expect(TOUR_COPY.nav.body).toBeNull();
    expect(TOUR_COPY.videoSend.title).toBe("Send it or save it");
    expect(TOUR_COPY.admin.title).toBe("Your admin pages");
    // An em dash, written as its code so this file holds none.
    expect(JSON.stringify(TOUR_COPY)).not.toContain(String.fromCharCode(0x2014));
  });

  it("say nothing about seats or plans to someone without a seat", () => {
    const words = `${TOUR_COPY.videoSave.title} ${TOUR_COPY.videoSave.body}`.toLowerCase();
    expect(words).not.toMatch(/seat|plan|send|qr/);
  });

  it("join highlighted names as a sentence does", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Search"])).toBe("Search");
    expect(joinNames(["Procedure categories", "Search"])).toBe("Procedure categories and Search");
    expect(joinNames(["Favorite", "Send to patient", "Show QR on screen"])).toBe("Favorite, Send to patient and Show QR on screen");
  });
});

describe("the speed rule: a normal page visit loads none of the tour", () => {
  /** Every source file in the app, outside node_modules and build output. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (name === "node_modules" || name.startsWith(".")) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("imports the tour's own file only lazily, from TourHost", () => {
    const root = join(__dirname, "..");
    const importers = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(join(root, dir)))
      .filter((path) => /from\s+["'](\.\/|@\/components\/tour\/)Tour["']|import\(\s*["'](\.\/|@\/components\/tour\/)Tour["']\s*\)/.test(readFileSync(path, "utf8")));
    expect(importers.map((path) => path.slice(root.length + 1).replace(/\\/g, "/"))).toEqual(["components/tour/TourHost.tsx"]);
    // And there it is a dynamic import, never a static one.
    const host = readFileSync(join(root, "components/tour/TourHost.tsx"), "utf8");
    expect(host).toMatch(/import\("\.\/Tour"\)/);
    expect(host).not.toMatch(/from\s+["']\.\/Tour["']/);
  });
});
