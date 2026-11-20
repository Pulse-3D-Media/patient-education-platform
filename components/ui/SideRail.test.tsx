import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

/**
 * The side rail as the server first draws it (closed, the narrow strip),
 * inside the shell the library and the admin pages share. Clerk's user
 * button and the address are stand-ins; the clinic is made up.
 */

let path = "/library";
vi.mock("@clerk/nextjs", () => ({ UserButton: Object.assign(() => <span data-avatar />, { MenuItems: () => null, Link: () => null }) }));
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams() }));

const brand = { style: {}, fontClass: "", theme: "light" as const, clinicName: "Example Clinic", logoUrl: null };
const categories = [{ value: "SPINE" as never, label: "Orthopedic Spine", slug: "spine" }];

function draw(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return renderToStaticMarkup(
    <AppShell brand={brand} categories={categories} {...props}>
      <main>page</main>
    </AppShell>,
  );
}

describe("the side rail at rest", () => {
  it("is one closed strip with the three lines, Home and Library, and no Admin for a member", () => {
    const html = draw();
    expect(html.match(/<nav [^>]*aria-label="Menu"/g)).toHaveLength(1);
    expect(html).toContain('data-rail="closed"');
    expect(html).toContain('aria-label="Open the menu"');
    expect(html).toMatch(/>Home</);
    expect(html).toMatch(/>Library</);
    expect(html).not.toMatch(/>Admin</);
    expect(html).not.toContain('href="/admin"');
  });

  it("shows Admin to an office admin, leading to the admin overview", () => {
    const html = draw({ showAdmin: true });
    expect(html).toMatch(/>Admin</);
    expect(html).toContain('href="/admin"');
  });

  it("leaves the categories, the admin pages, the logo beside the three lines and Powered by for the open menu", () => {
    const html = draw({ showAdmin: true });
    expect(html).not.toContain('href="/library/spine"');
    expect(html).not.toContain("Orthopedic Surgery");
    expect(html).not.toContain('href="/admin/billing"');
    expect(html).not.toContain("Powered by");
  });

  it("marks Home as the current page on the library home", () => {
    path = "/library";
    expect(draw()).toMatch(/aria-current="page"[^>]*href="\/library"|href="\/library"[^>]*aria-current="page"/);
  });

  it("has no Library button at the foot any more: Library is one of the three headings, and the person's picture is at the foot", () => {
    const html = draw({ showAdmin: true });
    expect(html.match(/>Library</g)).toHaveLength(1);
    expect(html).toContain("data-avatar");
  });

  it("keeps a 64px margin for the strip from a tablet up, so opening it over the page moves nothing", () => {
    const html = draw();
    expect(html).toMatch(/class="min-w-0 flex-1 md:pl-16"><main>page<\/main>/);
    expect(html).toMatch(/<nav [^>]*class="[^"]*fixed inset-y-0 left-0/);
  });

  it("carries the setup clock for an admin whose setup is under way", () => {
    const html = draw({ showAdmin: true, setup: { title: "Finish setup", href: "/onboarding/setup/branding", doneCount: 1, total: 4 } });
    expect(html).toContain('aria-label="Finish setup, 1 of 4 done"');
    expect(html).toContain('href="/onboarding/setup/branding"');
  });

  it("draws the phone's row (the admin pills) only when it is handed one", () => {
    expect(draw()).not.toContain("data-phone-row");
    expect(draw({ phoneNav: <span data-phone-row /> })).toContain("data-phone-row");
  });
});
