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

describe("PulseShell's look", () => {
  it("is always dark, said on its own outermost element, so it never depends on the staff screens' default (light)", () => {
    const html = renderToStaticMarkup(<PulseShell demoSiteUrl={null}>page</PulseShell>).replace(/^(<link [^>]*>)+/, ""); // React puts the logo's preload hint first
    expect(html).toMatch(/^<div data-theme="dark"/);
    expect(html).not.toContain('data-theme="light"');
    // The staff fonts' headings, and no clinic's colours.
    expect(html).toMatch(/^<div [^>]*class="[^"]*staff-headings/);
    expect(html).not.toContain("--brand-accent");
  });

  it("lists the six sections on the rail and in the phone's row of pills, with the current one marked, and the way to the library", () => {
    const html = renderToStaticMarkup(<PulseShell demoSiteUrl={null}>page</PulseShell>);
    expect(html.match(/<nav aria-label="Dashboard"/g)).toHaveLength(2);
    for (const label of ["Clinics", "Videos", "Pricing", "Settings", "Billing", "Reports"]) expect(html.match(new RegExp(`>${label}<`, "g"))).toHaveLength(2);
    expect(html.match(/aria-current="page"[^>]*href="\/pulse"/g)).toHaveLength(2);
    expect(html).toContain('href="/library"');
  });
});
