import { describe, expect, it } from "vitest";
import { CATEGORY_DEFAULTS } from "./categories";
import { LOGO_URL } from "./brand";
import { PICTURE_SOURCES, isAllowedPictureHost, isAllowedPictureUrl, pictureHostRefusal } from "./picture-hosts";

/** The list of sites pictures may come from (lib/picture-hosts.ts), with plain values. */

describe("isAllowedPictureUrl", () => {
  it("takes https addresses on the Webflow CDN, Clerk's image host and Mux's stills", () => {
    for (const ok of [
      "https://cdn.prod.website-files.com/abc/logo.png",
      "https://assets.website-files.com/a.png",
      "https://uploads-ssl.webflow.com/a.png",
      "https://img.clerk.com/eyJ0eXBlIjoicHJveHkifQ",
      "https://image.mux.com/made-up/thumbnail.jpg?token=x",
      "https://IMG.CLERK.COM/a",
    ]) {
      expect(isAllowedPictureUrl(ok), ok).toBe(true);
    }
  });

  it("refuses any other site, look-alikes, http, other ports and junk", () => {
    for (const bad of [
      "https://example.com/a.png",
      "https://img.clerk.com.example.org/a.png",
      "https://website-files.com/a.png",
      "https://website-files.com.evil.test/a.png",
      "https://evilwebsite-files.com/a.png",
      "http://cdn.prod.website-files.com/a.png",
      "https://cdn.prod.website-files.com:8443/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "not an address",
      "",
    ]) {
      expect(isAllowedPictureUrl(bad), bad).toBe(false);
    }
  });

  it("covers every picture the code itself ships: the Pulse logo and the starting category pictures", () => {
    expect(isAllowedPictureUrl(LOGO_URL)).toBe(true);
    for (const category of CATEGORY_DEFAULTS) expect(isAllowedPictureUrl(category.image), category.value).toBe(true);
  });

  it("matches a wildcard only below the name, never the name itself", () => {
    expect(isAllowedPictureHost("a.website-files.com")).toBe(true);
    expect(isAllowedPictureHost("website-files.com")).toBe(false);
  });

  it("writes the same list for the content policy, and says where a picture may live", () => {
    expect(PICTURE_SOURCES).toContain("https://img.clerk.com");
    expect(pictureHostRefusal("logo")).toContain("The logo has to be on the Webflow CDN");
  });
});
