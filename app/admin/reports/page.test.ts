import { describe, expect, it, vi } from "vitest";
import ReportsPage from "./page";

/**
 * /admin/reports. Clinics get no reports (Van, 2026-10-08), so the old
 * placeholder only sends a bookmark to the overview, which does its own
 * checks of who is asking. No database and no Clerk: the page reads nothing.
 */

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

describe("/admin/reports", () => {
  it("sends everyone to the overview and draws nothing of its own", () => {
    expect(() => ReportsPage()).toThrow("redirect:/admin");
  });
});
