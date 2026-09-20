import { ClinicStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { clinicIsOpen, inGrace } from "./clinic-status";

/**
 * The one rule for whether a clinic may use the app. Pure, no database.
 * ACTIVE is open; PAST_DUE is open until the exact moment its grace period
 * ends; everything else is closed.
 */
describe("clinicIsOpen", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const later = new Date(now.getTime() + 60_000);

  it("lets ACTIVE clinics in, whatever the grace column holds", () => {
    expect(clinicIsOpen({ status: "ACTIVE", graceEndsAt: null }, now)).toBe(true);
    expect(clinicIsOpen({ status: "ACTIVE", graceEndsAt: new Date(0) }, now)).toBe(true);
  });

  it("keeps PENDING, PAUSED and CANCELED out, even with a grace deadline in the future", () => {
    const closed = Object.values(ClinicStatus).filter((status) => status !== "ACTIVE" && status !== "PAST_DUE");
    expect(closed).toEqual(["PENDING", "PAUSED", "CANCELED"]);
    for (const status of closed) {
      expect(clinicIsOpen({ status, graceEndsAt: null }, now)).toBe(false);
      expect(clinicIsOpen({ status, graceEndsAt: later }, now)).toBe(false);
    }
  });

  it("keeps a PAST_DUE clinic open one millisecond before the deadline, and closes it at the deadline itself and after", () => {
    const deadline = new Date("2026-10-15T00:00:00.000Z");
    const clinic = { status: "PAST_DUE" as const, graceEndsAt: deadline };
    expect(clinicIsOpen(clinic, new Date(deadline.getTime() - 1))).toBe(true);
    expect(clinicIsOpen(clinic, deadline)).toBe(false);
    expect(clinicIsOpen(clinic, new Date(deadline.getTime() + 1))).toBe(false);
  });

  it("treats a missing or unreadable deadline as closed, never as unlimited", () => {
    expect(clinicIsOpen({ status: "PAST_DUE", graceEndsAt: null }, now)).toBe(false);
    expect(clinicIsOpen({ status: "PAST_DUE", graceEndsAt: new Date("not a date") }, now)).toBe(false);
    expect(inGrace(undefined as unknown as Date, now)).toBe(false);
    expect(inGrace("2099-01-01" as unknown as Date, now)).toBe(false);
  });
});
