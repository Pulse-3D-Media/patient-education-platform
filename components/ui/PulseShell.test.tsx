import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PulseShell } from "./PulseShell";

/**
 * The /pulse banner as the server first draws it, with Clerk's user button
 * and the current path as stand-ins. The address is made up.
 */

vi.mock("@clerk/nextjs", () => ({ UserButton: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pulse" }));

describe("PulseShell's Open demo site link", () => {
  it("is drawn with the address it is given, in a new tab, with no opener or referrer", () => {
    const html = renderToStaticMarkup(<PulseShell demoSiteUrl="https://demo.example.com/">page</PulseShell>);
    expect(html).toContain('href="https://demo.example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Open demo site");
    expect(html).toContain("(opens in a new tab)");
  });

  it("is not drawn at all without an address", () => {
    const html = renderToStaticMarkup(<PulseShell demoSiteUrl={null}>page</PulseShell>);
    expect(html).not.toContain("Open demo site");
    expect(html).not.toContain('target="_blank"');
  });
});
