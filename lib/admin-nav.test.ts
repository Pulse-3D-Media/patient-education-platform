import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, activeAdminSection } from "./admin-nav";

/** The rule that marks the current section in the admin navigation. Pure, no database. */
describe("activeAdminSection", () => {
  it("matches the overview on its exact address only", () => {
    expect(activeAdminSection("/admin")).toBe("/admin");
    expect(activeAdminSection("/admin/")).toBeNull();
  });

  it("matches a section on its address and everything under it", () => {
    expect(activeAdminSection("/admin/links")).toBe("/admin/links");
    expect(activeAdminSection("/admin/people")).toBe("/admin/people");
    expect(activeAdminSection("/admin/people/anything")).toBe("/admin/people");
    expect(activeAdminSection("/admin/billing")).toBe("/admin/billing");
    expect(activeAdminSection("/admin/reports")).toBe("/admin/reports");
  });

  it("counts the QR picture and the pamphlet as Shared links", () => {
    expect(activeAdminSection("/admin/print/k7m2xq")).toBe("/admin/links");
    expect(activeAdminSection("/admin/qr/k7m2xq")).toBe("/admin/links");
  });

  it("does not confuse a longer name for a section", () => {
    expect(activeAdminSection("/admin/peoples")).toBeNull();
    expect(activeAdminSection("/library")).toBeNull();
  });

  it("lists every section with an address under /admin", () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.href.startsWith("/admin")).toBe(true);
      expect(activeAdminSection(section.href)).toBe(section.href);
    }
  });
});
