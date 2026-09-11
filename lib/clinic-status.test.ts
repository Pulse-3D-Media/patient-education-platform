import { ClinicStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { clinicIsOpen } from "./clinic-status";

/**
 * The one rule for whether a clinic may use the app. Pure, no database.
 * If billing later opens a status (a grace period for PAST_DUE, say), the
 * expected list here changes with it.
 */
describe("clinicIsOpen", () => {
  it("lets only ACTIVE clinics in", () => {
    expect(clinicIsOpen("ACTIVE")).toBe(true);
  });

  it("keeps every other status out, including a brand-new PENDING clinic", () => {
    const closed = Object.values(ClinicStatus).filter((status) => status !== "ACTIVE");
    expect(closed).toContain("PENDING");
    for (const status of closed) {
      expect(clinicIsOpen(status)).toBe(false);
    }
  });
});
