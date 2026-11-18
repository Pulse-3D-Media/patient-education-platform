import { describe, expect, it } from "vitest";
import { demoSiteUrl } from "./demo-site";

/** The "Open demo site" address. Made-up addresses only; nothing here connects to anything. */
describe("demoSiteUrl", () => {
  it("gives back a plain https address", () => {
    expect(demoSiteUrl({ DEMO_SITE_URL: "https://demo.example.com" })).toBe("https://demo.example.com/");
    expect(demoSiteUrl({ DEMO_SITE_URL: "  https://demo.example.com/pulse  " })).toBe("https://demo.example.com/pulse");
  });

  it("treats empty, missing or unreadable values as not set", () => {
    expect(demoSiteUrl({})).toBeNull();
    expect(demoSiteUrl({ DEMO_SITE_URL: "" })).toBeNull();
    expect(demoSiteUrl({ DEMO_SITE_URL: "   " })).toBeNull();
    expect(demoSiteUrl({ DEMO_SITE_URL: "demo.example.com" })).toBeNull();
    expect(demoSiteUrl({ DEMO_SITE_URL: "not an address" })).toBeNull();
  });

  it("refuses anything that is not https", () => {
    for (const value of ["http://demo.example.com", "javascript:alert(1)", "ftp://demo.example.com", "data:text/html,hi", "file:///etc/passwd"]) {
      expect(demoSiteUrl({ DEMO_SITE_URL: value }), value).toBeNull();
    }
  });

  it("refuses an address with a user name or password in it", () => {
    expect(demoSiteUrl({ DEMO_SITE_URL: "https://someone:secret@demo.example.com" })).toBeNull();
    expect(demoSiteUrl({ DEMO_SITE_URL: "https://someone@demo.example.com" })).toBeNull();
  });
});
