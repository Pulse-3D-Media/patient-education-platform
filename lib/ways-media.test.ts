import { describe, expect, it } from "vitest";
import { isAllowedPictureUrl } from "./picture-hosts";
import { contentSecurityPolicy } from "./security-headers";
import { decorativeQrPath, WAYS_MEDIA } from "./ways-media";

/**
 * The landing page's "three ways" pictures come from the website's files on
 * the Webflow CDN. The content policy already allows that host for pictures
 * and video; this fails if a file ever points somewhere it does not, so the
 * policy is widened on purpose, never by surprise.
 */

/** One directive's sources, read from the policy as the browser would. */
function sources(policy: string, name: string): string[] {
  const directive = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

/** Does a source like "https://cdn.example" or "https://*.example" cover this address? */
function covers(source: string, address: string): boolean {
  const url = new URL(address);
  const host = source.replace(/^https:\/\//, "");
  if (!source.startsWith("https://") || url.protocol !== "https:") return false;
  return host.startsWith("*.") ? url.hostname.endsWith(host.slice(1)) : url.hostname === host;
}

describe("the three ways pictures", () => {
  const policy = contentSecurityPolicy({});
  const { video, ...pictures } = WAYS_MEDIA;

  it("every picture is on a host the policy and the picture list allow", () => {
    for (const address of Object.values(pictures)) {
      expect(isAllowedPictureUrl(address)).toBe(true);
      expect(sources(policy, "img-src").some((source) => covers(source, address))).toBe(true);
    }
  });

  it("the video is on a host media-src allows", () => {
    expect(sources(policy, "media-src").some((source) => covers(source, video))).toBe(true);
  });

  it("the stylesheet's one picture address is on the same allowed host", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("../components/landing/ways.css", import.meta.url), "utf8");
    const addresses = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((match) => match[1]);
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(isAllowedPictureUrl(address)).toBe(true);
  });

  it("the printed card's QR code is the website's fixed pattern, the same every time", () => {
    const path = decorativeQrPath();
    expect(path).toBe(decorativeQrPath());
    // The three corner squares are always there.
    expect(path).toContain("M0 0h1v1h-1z");
    expect(path).toContain("M24 0h1v1h-1z");
    expect(path).toContain("M0 24h1v1h-1z");
  });
});
